import BN from 'bn.js'
import Web3 from 'web3'
import { BlockTransactionString } from 'web3-eth'
import { EventData, PastEventOptions } from 'web3-eth-contract'
import { PrefixedHexString } from 'ethereumjs-util'
import { TxOptions } from '@ethereumjs/tx'
import { toBN, toHex } from 'web3-utils'
import { BlockNumber, Transaction, TransactionReceipt } from 'web3-core'

import abi from 'web3-eth-abi'
import { RelayRequest } from './EIP712/RelayRequest'
import paymasterAbi from './interfaces/IPaymaster.json'
import relayHubAbi from './interfaces/IRelayHub.json'
import forwarderAbi from './interfaces/IForwarder.json'
import stakeManagerAbi from './interfaces/IStakeManager.json'
import penalizerAbi from './interfaces/IPenalizer.json'
import gsnRecipientAbi from './interfaces/IRelayRecipient.json'
import versionRegistryAbi from './interfaces/IVersionRegistry.json'

import { VersionsManager } from './VersionsManager'
import { replaceErrors } from './ErrorReplacerJSON'
import { LoggerInterface } from './LoggerInterface'
import { address2topic, decodeRevertReason, event2topic } from './Utils'
import {
  BaseRelayRecipientInstance,
  IForwarderInstance,
  IPaymasterInstance,
  IPenalizerInstance,
  IRelayHubInstance,
  IRelayRecipientInstance,
  IStakeManagerInstance,
  IVersionRegistryInstance
} from '@opengsn/contracts/types/truffle-contracts'

import { Address, EventName, IntString, ObjectMap, SemVerString, Web3ProviderBaseInterface } from './types/Aliases'
import { GsnTransactionDetails } from './types/GsnTransactionDetails'

import { Contract, TruffleContract } from './LightTruffleContract'
import { gsnRequiredVersion, gsnRuntimeVersion } from './Version'
import Common from '@ethereumjs/common'
import { GSNContractsDeployment } from './GSNContractsDeployment'
import { ActiveManagerEvents, RelayWorkersAdded, StakeInfo } from './types/GSNContractsDataTypes'
import { sleep } from './Utils.js'
import TransactionDetails = Truffle.TransactionDetails

export interface ConstructorParams {
  provider: Web3ProviderBaseInterface
  logger: LoggerInterface
  versionManager?: VersionsManager
  deployment?: GSNContractsDeployment
  maxPageSize: number
}

export class ContractInteractor {
  private readonly IPaymasterContract: Contract<IPaymasterInstance>
  private readonly IRelayHubContract: Contract<IRelayHubInstance>
  private readonly IForwarderContract: Contract<IForwarderInstance>
  private readonly IStakeManager: Contract<IStakeManagerInstance>
  private readonly IPenalizer: Contract<IPenalizerInstance>
  private readonly IRelayRecipient: Contract<BaseRelayRecipientInstance>
  private readonly IVersionRegistry: Contract<IVersionRegistryInstance>

  private paymasterInstance!: IPaymasterInstance
  relayHubInstance!: IRelayHubInstance
  private forwarderInstance!: IForwarderInstance
  private stakeManagerInstance!: IStakeManagerInstance
  penalizerInstance!: IPenalizerInstance
  versionRegistry!: IVersionRegistryInstance
  private relayRecipientInstance?: BaseRelayRecipientInstance
  private readonly relayCallMethod: any

  readonly web3: Web3
  private readonly provider: Web3ProviderBaseInterface
  private deployment: GSNContractsDeployment
  private readonly versionManager: VersionsManager
  private readonly logger: LoggerInterface
  private readonly maxPageSize: number
  private lastBlockNumber: number

  private rawTxOptions?: TxOptions
  chainId!: number
  private networkId?: number
  private networkType?: string
  private paymasterVersion?: SemVerString

  constructor (
    {
      maxPageSize,
      provider,
      versionManager,
      logger,
      deployment = {}
    }: ConstructorParams) {
    this.maxPageSize = maxPageSize
    this.logger = logger
    this.versionManager = versionManager ?? new VersionsManager(gsnRuntimeVersion, gsnRequiredVersion)
    this.web3 = new Web3(provider as any)
    this.deployment = deployment
    this.provider = provider
    this.lastBlockNumber = 0
    // @ts-ignore
    this.IPaymasterContract = TruffleContract({
      contractName: 'IPaymaster',
      abi: paymasterAbi
    })
    // @ts-ignore
    this.IRelayHubContract = TruffleContract({
      contractName: 'IRelayHub',
      abi: relayHubAbi
    })
    // @ts-ignore
    this.IForwarderContract = TruffleContract({
      contractName: 'IForwarder',
      abi: forwarderAbi
    })
    // @ts-ignore
    this.IStakeManager = TruffleContract({
      contractName: 'IStakeManager',
      abi: stakeManagerAbi
    })
    // @ts-ignore
    this.IPenalizer = TruffleContract({
      contractName: 'IPenalizer',
      abi: penalizerAbi
    })
    // @ts-ignore
    this.IRelayRecipient = TruffleContract({
      contractName: 'IRelayRecipient',
      abi: gsnRecipientAbi
    })
    // @ts-ignore
    this.IVersionRegistry = TruffleContract({
      contractName: 'IVersionRegistry',
      abi: versionRegistryAbi
    })
    this.IStakeManager.setProvider(this.provider, undefined)
    this.IRelayHubContract.setProvider(this.provider, undefined)
    this.IPaymasterContract.setProvider(this.provider, undefined)
    this.IForwarderContract.setProvider(this.provider, undefined)
    this.IPenalizer.setProvider(this.provider, undefined)
    this.IRelayRecipient.setProvider(this.provider, undefined)
    this.IVersionRegistry.setProvider(this.provider, undefined)

    this.relayCallMethod = this.IRelayHubContract.createContract('').methods.relayCall
  }

  async init (): Promise<ContractInteractor> {
    this.logger.debug('interactor init start')
    if (this.rawTxOptions != null) {
      throw new Error('_init was already called')
    }
    await this._resolveDeployment()
    await this._initializeContracts()
    await this._validateCompatibility()
    await this._initializeNetworkParams()
    return this
  }

  async _initializeNetworkParams (): Promise<void> {
    this.chainId = await this.web3.eth.getChainId()
    this.networkId = await this.web3.eth.net.getId()
    this.networkType = await this.web3.eth.net.getNetworkType()
    // networkType === 'private' means we're on ganache, and ethereumjs-tx.Transaction doesn't support that chain type
    this.rawTxOptions = getRawTxOptions(this.chainId, this.networkId, this.networkType)
  }

  async _resolveDeployment (): Promise<void> {
    if (this.deployment.paymasterAddress != null && this.deployment.relayHubAddress != null) {
      this.logger.warn('Already resolved!')
      return
    }

    if (this.deployment.paymasterAddress != null) {
      await this._resolveDeploymentFromPaymaster(this.deployment.paymasterAddress)
    } else if (this.deployment.relayHubAddress != null) {
      // TODO: this branch shouldn't exist as it's only used by the Server and can lead to broken Client configuration
      await this._resolveDeploymentFromRelayHub(this.deployment.relayHubAddress)
    } else {
      this.logger.info(`Contract interactor cannot resolve a full deployment from the following input: ${JSON.stringify(this.deployment)}`)
    }
  }

  async _resolveDeploymentFromPaymaster (paymasterAddress: Address): Promise<void> {
    this.paymasterInstance = await this._createPaymaster(paymasterAddress)
    const [
      relayHubAddress, forwarderAddress, paymasterVersion
    ] = await Promise.all([
      this.paymasterInstance.getHubAddr().catch((e: Error) => { throw new Error(`Not a paymaster contract: ${e.message}`) }),
      this.paymasterInstance.trustedForwarder().catch((e: Error) => { throw new Error(`paymaster has no trustedForwarder(): ${e.message}`) }),
      this.paymasterInstance.versionPaymaster().catch((e: Error) => { throw new Error(`Not a paymaster contract: ${e.message}`) }).then((version: string) => {
        this._validateVersion(version)
        return version
      })
    ])
    this.deployment.relayHubAddress = relayHubAddress
    this.deployment.forwarderAddress = forwarderAddress
    this.paymasterVersion = paymasterVersion
    await this._resolveDeploymentFromRelayHub(relayHubAddress)
  }

  async _resolveDeploymentFromRelayHub (relayHubAddress: Address): Promise<void> {
    this.relayHubInstance = await this._createRelayHub(relayHubAddress)
    const [stakeManagerAddress, penalizerAddress] = await Promise.all([
      this._hubStakeManagerAddress(),
      this._hubPenalizerAddress()
    ])
    this.deployment.relayHubAddress = relayHubAddress
    this.deployment.stakeManagerAddress = stakeManagerAddress
    this.deployment.penalizerAddress = penalizerAddress
  }

  async _validateCompatibility (): Promise<void> {
    if (this.deployment == null || this.relayHubInstance == null) {
      return
    }
    const hub = this.relayHubInstance
    const version = await hub.versionHub()
    this._validateVersion(version)
  }

  _validateVersion (version: string): void {
    const versionSatisfied = this.versionManager.isRequiredVersionSatisfied(version)
    if (!versionSatisfied) {
      throw new Error(`Provided Hub version(${version}) does not satisfy the requirement(${this.versionManager.requiredVersionRange})`)
    }
  }

  async _initializeContracts (): Promise<void> {
    if (this.relayHubInstance == null && this.deployment.relayHubAddress != null) {
      this.relayHubInstance = await this._createRelayHub(this.deployment.relayHubAddress)
    }
    if (this.paymasterInstance == null && this.deployment.paymasterAddress != null) {
      this.paymasterInstance = await this._createPaymaster(this.deployment.paymasterAddress)
    }
    if (this.deployment.forwarderAddress != null) {
      this.forwarderInstance = await this._createForwarder(this.deployment.forwarderAddress)
    }
    if (this.deployment.stakeManagerAddress != null) {
      this.stakeManagerInstance = await this._createStakeManager(this.deployment.stakeManagerAddress)
    }
    if (this.deployment.penalizerAddress != null) {
      this.penalizerInstance = await this._createPenalizer(this.deployment.penalizerAddress)
    }
    if (this.deployment.versionRegistryAddress != null) {
      this.versionRegistry = await this._createVersionRegistry(this.deployment.versionRegistryAddress)
    }
  }

  // must use these options when creating Transaction object
  getRawTxOptions (): TxOptions {
    if (this.rawTxOptions == null) {
      throw new Error('_init not called')
    }
    return this.rawTxOptions
  }

  async _createRecipient (address: Address): Promise<IRelayRecipientInstance> {
    if (this.relayRecipientInstance != null && this.relayRecipientInstance.address.toLowerCase() === address.toLowerCase()) {
      return this.relayRecipientInstance
    }
    this.relayRecipientInstance = await this.IRelayRecipient.at(address)
    return this.relayRecipientInstance
  }

  async _createPaymaster (address: Address): Promise<IPaymasterInstance> {
    return await this.IPaymasterContract.at(address)
  }

  async _createRelayHub (address: Address): Promise<IRelayHubInstance> {
    return await this.IRelayHubContract.at(address)
  }

  async _createForwarder (address: Address): Promise<IForwarderInstance> {
    return await this.IForwarderContract.at(address)
  }

  async _createStakeManager (address: Address): Promise<IStakeManagerInstance> {
    return await this.IStakeManager.at(address)
  }

  async _createPenalizer (address: Address): Promise<IPenalizerInstance> {
    return await this.IPenalizer.at(address)
  }

  async _createVersionRegistry (address: Address): Promise<IVersionRegistryInstance> {
    return await this.IVersionRegistry.at(address)
  }

  async isTrustedForwarder (recipientAddress: Address, forwarder: Address): Promise<boolean> {
    const recipient = await this._createRecipient(recipientAddress)
    return await recipient.isTrustedForwarder(forwarder)
  }

  async getSenderNonce (sender: Address, forwarderAddress: Address): Promise<IntString> {
    const forwarder = await this._createForwarder(forwarderAddress)
    const nonce = await forwarder.getNonce(sender)
    return nonce.toString()
  }

  async _getBlockGasLimit (): Promise<number> {
    const latestBlock = await this.web3.eth.getBlock('latest')
    return latestBlock.gasLimit
  }

  /**
   * make a view call to relayCall(), just like the way it will be called by the relayer.
   * returns:
   * - paymasterAccepted - true if accepted
   * - reverted - true if relayCall was reverted.
   * - returnValue - if either reverted or paymaster NOT accepted, then this is the reason string.
   */
  async validateRelayCall (
    maxAcceptanceBudget: number,
    relayRequest: RelayRequest,
    signature: PrefixedHexString,
    approvalData: PrefixedHexString,
    maxViewableGasLimit?: number): Promise<{ paymasterAccepted: boolean, returnValue: string, reverted: boolean }> {
    const relayHub = this.relayHubInstance
    try {
      const externalGasLimit = await this.getMaxViewableGasLimit(relayRequest, maxViewableGasLimit)
      const encodedRelayCall = relayHub.contract.methods.relayCall(
        maxAcceptanceBudget,
        relayRequest,
        signature,
        approvalData,
        externalGasLimit
      ).encodeABI()
      const res: string = await new Promise((resolve, reject) => {
        // @ts-ignore
        this.web3.currentProvider.send({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [
            {
              from: relayRequest.relayData.relayWorker,
              to: relayHub.address,
              gasPrice: toHex(relayRequest.relayData.gasPrice),
              gas: toHex(externalGasLimit),
              data: encodedRelayCall
            },
            'latest'
          ]
        }, (err: any, res: { result: string }) => {
          const revertMsg = this._decodeRevertFromResponse(err, res)
          if (revertMsg != null) {
            reject(new Error(revertMsg))
          } else if (err !== null) {
            reject(err)
          } else {
            resolve(res.result)
          }
        })
      })
      this.logger.debug('relayCall res=' + res)

      // @ts-ignore
      const decoded = abi.decodeParameters(['bool', 'bytes'], res)
      const paymasterAccepted: boolean = decoded[0]
      let returnValue: string
      if (paymasterAccepted) {
        returnValue = decoded[1]
      } else {
        returnValue = this._decodeRevertFromResponse({}, { result: decoded[1] }) ?? decoded[1]
      }
      return {
        returnValue: returnValue,
        paymasterAccepted: paymasterAccepted,
        reverted: false
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        paymasterAccepted: false,
        reverted: true,
        returnValue: `view call to 'relayCall' reverted in client: ${message}`
      }
    }
  }

  async getMaxViewableGasLimit (relayRequest: RelayRequest, maxViewableGasLimit?: number): Promise<BN> {
    const blockGasLimit = toBN(maxViewableGasLimit ?? await this._getBlockGasLimit())
    const workerBalance = toBN(await this.getBalance(relayRequest.relayData.relayWorker))
    const workerGasLimit = workerBalance.div(toBN(
      relayRequest.relayData.gasPrice === '0' ? 1 : relayRequest.relayData.gasPrice))
    return BN.min(blockGasLimit, workerGasLimit)
  }

  /**
   * decode revert from rpc response.
   * called from the callback of the provider "eth_call" call.
   * check if response is revert, and extract revert reason from it.
   * support kovan, geth, ganache error formats..
   * @param err - provider err value
   * @param res - provider res value
   */
  // decode revert from rpc response.
  //
  _decodeRevertFromResponse (err?: { message?: string, data?: any }, res?: { error?: any, result?: string }): string | null {
    let matchGanache = err?.data?.message?.toString().match(/: revert(?:ed)? (.*)/)
    if (matchGanache == null) {
      matchGanache = res?.error?.message?.toString().match(/: revert(?:ed)? (.*)/)
    }
    if (matchGanache != null) {
      return matchGanache[1]
    }
    const errorData = err?.data ?? res?.error?.data
    const m = errorData?.toString().match(/(0x08c379a0\S*)/)
    if (m != null) {
      return decodeRevertReason(m[1])
    }

    const result = res?.result ?? ''
    if (result.startsWith('0x08c379a0')) {
      return decodeRevertReason(result)
    }
    return null
  }

  encodeABI (maxAcceptanceBudget: number, relayRequest: RelayRequest, sig: PrefixedHexString, approvalData: PrefixedHexString, externalGasLimit: IntString): PrefixedHexString {
    return this.relayCallMethod(maxAcceptanceBudget, relayRequest, sig, approvalData, externalGasLimit).encodeABI()
  }

  async getPastEventsForHub (extraTopics: string[], options: PastEventOptions, names: EventName[] = ActiveManagerEvents): Promise<EventData[]> {
    return await this._getPastEventsPaginated(this.relayHubInstance.contract, names, extraTopics, options)
  }

  async getPastEventsForStakeManager (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    const stakeManager = await this.stakeManagerInstance
    return await this._getPastEventsPaginated(stakeManager.contract, names, extraTopics, options)
  }

  async getPastEventsForPenalizer (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    return await this._getPastEventsPaginated(this.penalizerInstance.contract, names, extraTopics, options)
  }

  async getPastEventsForVersionRegistry (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    return await this._getPastEventsPaginated(this.versionRegistry.contract, names, extraTopics, options)
  }

  getLogsPagesForRange (fromBlock: BlockNumber = 1, toBlock?: BlockNumber): number {
    // save 'getBlockNumber' roundtrip for a known max value
    if (this.maxPageSize === Number.MAX_SAFE_INTEGER) {
      return 1
    }
    // noinspection SuspiciousTypeOfGuard - known false positive
    if (typeof fromBlock !== 'number' || typeof toBlock !== 'number') {
      throw new Error(`ContractInteractor:getLogsPagesForRange: [${fromBlock.toString()}..${toBlock?.toString()}]: only numbers supported when using pagination`)
    }
    const rangeSize = toBlock - fromBlock + 1
    const pagesForRange = Math.max(Math.ceil(rangeSize / this.maxPageSize), 1)
    if (pagesForRange > 1) {
      this.logger.info(`Splitting request for ${rangeSize} blocks into ${pagesForRange} smaller paginated requests!`)
    }
    return pagesForRange
  }

  splitRange (fromBlock: BlockNumber, toBlock: BlockNumber, parts: number): Array<{ fromBlock: BlockNumber, toBlock: BlockNumber }> {
    if (parts === 1) {
      return [{ fromBlock, toBlock }]
    }
    // noinspection SuspiciousTypeOfGuard - known false positive
    if (typeof fromBlock !== 'number' || typeof toBlock !== 'number') {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`ContractInteractor:splitRange: only number supported for block range when using pagination, ${fromBlock} ${toBlock} ${parts}`)
    }
    const rangeSize = toBlock - fromBlock + 1
    const splitSize = Math.ceil(rangeSize / parts)

    const ret: Array<{ fromBlock: number, toBlock: number }> = []
    for (let b = fromBlock; b <= toBlock; b += splitSize) {
      ret.push({ fromBlock: b, toBlock: Math.min(toBlock, b + splitSize - 1) })
    }
    return ret
  }

  /**
   * Splits requested range into pages to avoid fetching too many blocks at once.
   * In case 'getLogs' returned with a common error message of "more than X events" dynamically decrease page size.
   */
  async _getPastEventsPaginated (contract: any, names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    const delay = this.getNetworkType() === 'private' ? 0 : 300
    if (options.toBlock == null) {
      // this is to avoid '!' for TypeScript
      options.toBlock = 'latest'
    }
    if (options.fromBlock == null) {
      options.fromBlock = 1
    }
    // save 'getBlockNumber' roundtrip for a known max value (must match check in getLogsPagesForRange)
    if (this.maxPageSize !== Number.MAX_SAFE_INTEGER && options.toBlock === 'latest') {
      options.toBlock = await this.getBlockNumber()
      if (options.fromBlock > options.toBlock) {
        options.toBlock = options.fromBlock
      }
    }
    if (options.fromBlock > options.toBlock) {
      const message = `fromBlock(${options.fromBlock.toString()}) >  
              toBlock(${options.toBlock.toString()})`
      this.logger.error(message)
      throw new Error(message)
    }
    let pagesCurrent: number = await this.getLogsPagesForRange(options.fromBlock, options.toBlock)
    const relayEventParts: EventData[][] = []
    while (true) {
      const rangeParts = await this.splitRange(options.fromBlock, options.toBlock, pagesCurrent)
      try {
        // eslint-disable-next-line
        for (const { fromBlock, toBlock } of rangeParts) {
          // this.logger.debug('Getting events from block ' + fromBlock.toString() + ' to ' + toBlock.toString())
          let attempts = 0
          while (true) {
            try {
              const pastEvents = await this._getPastEvents(contract, names, extraTopics, Object.assign({}, options, { fromBlock, toBlock }))
              relayEventParts.push(pastEvents)
              break
            } catch (e) {
              /* eslint-disable */
              this.logger.error(`error in getPastEvents. 
              fromBlock: ${fromBlock.toString()} 
              toBlock: ${toBlock.toString()} 
              attempts: ${attempts.toString()}
              names: ${names.toString()}
              extraTopics: ${extraTopics.toString()}
              options: ${JSON.stringify(options)}
              \n${e.toString()}`)
              /* eslint-enable */
              attempts++
              if (attempts >= 100) {
                this.logger.error('Too many attempts. throwing ')
                throw e
              }
              await sleep(delay)
            }
          }
        }
        break
      } catch (e) {
        // dynamically adjust query size fo some RPC providers
        if (e.toString().match(/query returned more than/) != null) {
          this.logger.warn('Received "query returned more than X events" error from server, will try to split the request into smaller chunks')
          if (pagesCurrent > 16) {
            throw new Error(`Too many events after splitting by ${pagesCurrent}`)
          }
          pagesCurrent *= 4
        } else {
          throw e
        }
      }
    }
    return relayEventParts.flat()
  }

  async _getPastEvents (contract: any, names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    const topics: string[][] = []
    const eventTopic = event2topic(contract, names)
    topics.push(eventTopic)
    // TODO: AFAIK this means only the first parameter of the event is supported
    if (extraTopics.length > 0) {
      topics.push(extraTopics)
    }
    return contract.getPastEvents('allEvents', Object.assign({}, options, { topics }))
  }

  async getBalance (address: Address, defaultBlock: BlockNumber = 'latest'): Promise<string> {
    return await this.web3.eth.getBalance(address, defaultBlock)
  }

  async getBlockNumber (): Promise<number> {
    let blockNumber = -1
    let attempts = 0
    const delay = this.getNetworkType() === 'private' ? 0 : 1000
    while (blockNumber < this.lastBlockNumber && attempts <= 10) {
      try {
        blockNumber = await this.web3.eth.getBlockNumber()
      } catch (e) {
        this.logger.error(`getBlockNumber: ${(e as Error).message}`)
      }
      if (blockNumber >= this.lastBlockNumber) {
        break
      }
      await sleep(delay)
      attempts++
    }
    if (blockNumber < this.lastBlockNumber) {
      throw new Error(`couldn't retrieve latest blockNumber from node. last block: ${this.lastBlockNumber}, got block: ${blockNumber}`)
    }
    this.lastBlockNumber = blockNumber
    return blockNumber
  }

  async sendSignedTransaction (rawTx: string): Promise<TransactionReceipt> {
    // noinspection ES6RedundantAwait - PromiEvent makes lint less happy about this line
    return await this.web3.eth.sendSignedTransaction(rawTx)
  }

  async estimateGas (gsnTransactionDetails: GsnTransactionDetails): Promise<number> {
    return await this.web3.eth.estimateGas(gsnTransactionDetails)
  }

  // TODO: cache response for some time to optimize. It doesn't make sense to optimize these requests in calling code.
  async getGasPrice (): Promise<string> {
    return await this.web3.eth.getGasPrice()
  }

  async getTransactionCount (address: string, defaultBlock?: BlockNumber): Promise<number> {
    // @ts-ignore (web3 does not define 'defaultBlock' as optional)
    return await this.web3.eth.getTransactionCount(address, defaultBlock)
  }

  async getTransaction (transactionHash: string): Promise<Transaction> {
    return await this.web3.eth.getTransaction(transactionHash)
  }

  async getBlock (blockHashOrBlockNumber: BlockNumber): Promise<BlockTransactionString> {
    return await this.web3.eth.getBlock(blockHashOrBlockNumber)
  }

  validateAddress (address: string, exceptionTitle = 'invalid address:'): void {
    if (!this.web3.utils.isAddress(address)) { throw new Error(exceptionTitle + ' ' + address) }
  }

  async getCode (address: string): Promise<string> {
    return await this.web3.eth.getCode(address)
  }

  getNetworkId (): number {
    if (this.networkId == null) {
      throw new Error('_init not called')
    }
    return this.networkId
  }

  getNetworkType (): string {
    if (this.networkType == null) {
      throw new Error('_init not called')
    }
    return this.networkType
  }

  async isContractDeployed (address: Address): Promise<boolean> {
    const code = await this.web3.eth.getCode(address)
    return code !== '0x'
  }

  async getStakeInfo (managerAddress: Address): Promise<{
    stake: BN
    unstakeDelay: BN
    withdrawBlock: BN
    owner: string
  }> {
    const stakeManager = await this.stakeManagerInstance
    return await stakeManager.getStakeInfo(managerAddress)
  }

  async workerToManager (worker: Address): Promise<string> {
    return await this.relayHubInstance.workerToManager(worker)
  }

  /**
   * Gets balance of an address on the current RelayHub.
   * @param address - can be a Paymaster or a Relay Manger
   */
  async hubBalanceOf (address: Address): Promise<BN> {
    return await this.relayHubInstance.balanceOf(address)
  }

  /**
   * Gets stake of an address on the current StakeManager.
   * @param address - must be a Relay Manger
   */
  async stakeManagerStakeInfo (address: Address): Promise<StakeInfo> {
    return await this.stakeManagerInstance.getStakeInfo(address)
  }

  async isRelayManagerStakedOnHub (relayManager: Address): Promise<boolean> {
    return await this.relayHubInstance.isRelayManagerStaked(relayManager)
  }

  async isRelayManagerStakedOnSM (relayManager: Address, minAmount: number, minUnstakeDelay: number): Promise<boolean> {
    return await this.stakeManagerInstance.isRelayManagerStaked(relayManager, this.relayHubInstance.address, minAmount, minUnstakeDelay)
  }

  async initDeployment (deployment: GSNContractsDeployment): Promise<void> {
    this.deployment = deployment
    await this._initializeContracts()
  }

  getDeployment (): GSNContractsDeployment {
    if (this.deployment == null) {
      throw new Error('Contracts deployment is not initialized for Contract Interactor!')
    }
    return this.deployment
  }

  async withdrawHubBalanceEstimateGas (amount: BN, destination: Address, managerAddress: Address, gasPrice: IntString): Promise<{
    gasCost: BN
    gasLimit: number
    method: any
  }> {
    const hub = this.relayHubInstance
    const method = hub.contract.methods.withdraw(amount.toString(), destination)
    const withdrawTxGasLimit = await method.estimateGas(
      {
        from: managerAddress
      })
    const gasCost = toBN(withdrawTxGasLimit).mul(toBN(gasPrice))
    return {
      gasLimit: parseInt(withdrawTxGasLimit),
      gasCost,
      method
    }
  }

  // TODO: a way to make a relay hub transaction with a specified nonce without exposing the 'method' abstraction
  async getRegisterRelayMethod (baseRelayFee: IntString, pctRelayFee: number, url: string): Promise<any> {
    const hub = this.relayHubInstance
    return hub.contract.methods.registerRelayServer(baseRelayFee, pctRelayFee, url)
  }

  async getAddRelayWorkersMethod (workers: Address[]): Promise<any> {
    const hub = this.relayHubInstance
    return hub.contract.methods.addRelayWorkers(workers)
  }

  async getSetRelayManagerMethod (owner: Address): Promise<any> {
    const sm = this.stakeManagerInstance
    return sm.contract.methods.setRelayManagerOwner(owner)
  }

  /**
   * Web3.js as of 1.2.6 (see web3-core-method::_confirmTransaction) does not allow
   * broadcasting of a transaction without waiting for it to be mined.
   * This method sends the RPC call directly
   * @param signedTransaction - the raw signed transaction to broadcast
   */
  async broadcastTransaction (signedTransaction: PrefixedHexString): Promise<PrefixedHexString> {
    return await new Promise((resolve, reject) => {
      if (this.provider == null) {
        throw new Error('provider is not set')
      }
      this.provider.send({
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: [
          signedTransaction
        ],
        id: Date.now()
      }, (e: Error | null, r: any) => {
        if (e != null) {
          reject(e)
        } else if (r.error != null) {
          reject(r.error)
        } else {
          resolve(r.result)
        }
      })
    })
  }

  async hubDepositFor (paymaster: Address, transactionDetails: TransactionDetails): Promise<any> {
    return await this.relayHubInstance.depositFor(paymaster, transactionDetails)
  }

  async resolveDeploymentVersions (): Promise<ObjectMap<PrefixedHexString>> {
    const versionsMap: ObjectMap<PrefixedHexString> = {}
    if (this.deployment.relayHubAddress != null) {
      versionsMap[this.deployment.relayHubAddress] = await this.relayHubInstance.versionHub()
    }
    if (this.deployment.penalizerAddress != null) {
      versionsMap[this.deployment.penalizerAddress] = await this.penalizerInstance.versionPenalizer()
    }
    if (this.deployment.stakeManagerAddress != null) {
      versionsMap[this.deployment.stakeManagerAddress] = await this.stakeManagerInstance.versionSM()
    }
    return versionsMap
  }

  async queryDeploymentBalances (): Promise<ObjectMap<IntString>> {
    const balances: ObjectMap<IntString> = {}
    if (this.deployment.relayHubAddress != null) {
      balances[this.deployment.relayHubAddress] = await this.getBalance(this.deployment.relayHubAddress)
    }
    if (this.deployment.penalizerAddress != null) {
      balances[this.deployment.penalizerAddress] = await this.getBalance(this.deployment.penalizerAddress)
    }
    if (this.deployment.stakeManagerAddress != null) {
      balances[this.deployment.stakeManagerAddress] = await this.getBalance(this.deployment.stakeManagerAddress)
    }
    return balances
  }

  private async _hubStakeManagerAddress (): Promise<Address> {
    return await this.relayHubInstance.stakeManager()
  }

  stakeManagerAddress (): Address {
    return this.stakeManagerInstance.address
  }

  private async _hubPenalizerAddress (): Promise<Address> {
    return await this.relayHubInstance.penalizer()
  }

  penalizerAddress (): Address {
    return this.penalizerInstance.address
  }

  async getRegisteredWorkers (managerAddress: Address): Promise<Address[]> {
    const topics = address2topic(managerAddress)
    const workersAddedEvents = await this.getPastEventsForHub([topics], { fromBlock: 1 }, [RelayWorkersAdded])
    return workersAddedEvents.map(it => it.returnValues.newRelayWorkers).flat()
  }

  /* Version Registry methods */

  async addVersionInVersionRegistry (id: string, version: string, value: string, transactionDetails: TransactionDetails): Promise<void> {
    await this.versionRegistry.addVersion(id, version, value, transactionDetails)
  }

  async cancelVersionInVersionRegistry (id: string, version: string, cancelReason: string, transactionDetails: TransactionDetails): Promise<void> {
    await this.versionRegistry.cancelVersion(id, version, cancelReason, transactionDetails)
  }
}

/**
 * Ganache does not seem to enforce EIP-155 signature. Buidler does, though.
 * This is how {@link Transaction} constructor allows support for custom and private network.
 * @param chainId
 * @param networkId
 * @param chain
 * @return {{common: Common}}
 */
export function getRawTxOptions (chainId: number, networkId: number, chain?: string): TxOptions {
  if (chain == null || chain === 'main' || chain === 'private') {
    chain = 'mainnet'
  }
  return {
    common: Common.forCustomChain(
      chain,
      {
        chainId,
        networkId
      }, 'istanbul')
  }
}
