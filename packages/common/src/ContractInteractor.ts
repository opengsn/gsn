import BN from 'bn.js'
import Web3 from 'web3'
import { BlockTransactionString, FeeHistoryResult } from 'web3-eth'
import { EventData, PastEventOptions } from 'web3-eth-contract'
import { PrefixedHexString, toBuffer } from 'ethereumjs-util'
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
import relayRegistrarAbi from './interfaces/IRelayRegistrar.json'
import iErc20TokenAbi from './interfaces/IERC20Token.json'

import { VersionsManager } from './VersionsManager'
import { replaceErrors } from './ErrorReplacerJSON'
import { LoggerInterface } from './LoggerInterface'
import {
  PaymasterGasAndDataLimits,
  address2topic,
  calculateCalldataBytesZeroNonzero,
  decodeRevertReason,
  errorAsBoolean,
  event2topic,
  formatTokenAmount
} from './Utils'
import {
  BaseRelayRecipientInstance,
  IERC20TokenInstance,
  IForwarderInstance,
  IPaymasterInstance,
  IPenalizerInstance,
  IRelayHubInstance,
  IRelayRecipientInstance,
  IRelayRegistrarInstance,
  IStakeManagerInstance
} from '@opengsn/contracts/types/truffle-contracts'

import { Address, EventName, IntString, ObjectMap, SemVerString, Web3ProviderBaseInterface } from './types/Aliases'
import { GsnTransactionDetails } from './types/GsnTransactionDetails'

import { Contract, TruffleContract } from './LightTruffleContract'
import { gsnRequiredVersion, gsnRuntimeVersion } from './Version'
import Common from '@ethereumjs/common'
import { GSNContractsDeployment } from './GSNContractsDeployment'
import {
  ActiveManagerEvents,
  HubUnauthorized,
  RelayRegisteredEventInfo,
  RelayServerRegistered,
  RelayWorkersAdded,
  StakeInfo,
  StakePenalized,
  StakeUnlocked
} from './types/GSNContractsDataTypes'
import { sleep } from './Utils.js'
import { Environment } from './Environments'
import { RelayHubConfiguration } from './types/RelayHubConfiguration'
import { RelayTransactionRequest } from './types/RelayTransactionRequest'
import { BigNumber } from 'bignumber.js'
import { TransactionType } from './types/TransactionType'
import TransactionDetails = Truffle.TransactionDetails

export interface ConstructorParams {
  provider: Web3ProviderBaseInterface
  logger: LoggerInterface
  versionManager?: VersionsManager
  deployment?: GSNContractsDeployment
  maxPageSize: number
  environment: Environment
}

export interface RelayCallABI {
  signature: PrefixedHexString
  relayRequest: RelayRequest
  approvalData: PrefixedHexString
  maxAcceptanceBudget: PrefixedHexString
}

export function asRelayCallAbi (r: RelayTransactionRequest): RelayCallABI {
  return {
    relayRequest: r.relayRequest,
    signature: r.metadata.signature,
    approvalData: r.metadata.approvalData,
    maxAcceptanceBudget: r.metadata.maxAcceptanceBudget
  }
}

interface ManagerStakeStatus {
  isStaked: boolean
  errorMessage: string | null
}

export interface ERC20TokenMetadata {
  tokenName: string
  tokenSymbol: string
  tokenDecimals: BN
}

export class ContractInteractor {
  private readonly IPaymasterContract: Contract<IPaymasterInstance>
  private readonly IRelayHubContract: Contract<IRelayHubInstance>
  private readonly IForwarderContract: Contract<IForwarderInstance>
  private readonly IStakeManager: Contract<IStakeManagerInstance>
  private readonly IPenalizer: Contract<IPenalizerInstance>
  private readonly IRelayRecipient: Contract<BaseRelayRecipientInstance>
  private readonly IRelayRegistrar: Contract<IRelayRegistrarInstance>
  private readonly IERC20Token: Contract<IERC20TokenInstance>

  private paymasterInstance!: IPaymasterInstance
  relayHubInstance!: IRelayHubInstance
  relayHubConfiguration!: RelayHubConfiguration
  private forwarderInstance!: IForwarderInstance
  private stakeManagerInstance!: IStakeManagerInstance
  penalizerInstance!: IPenalizerInstance
  private relayRecipientInstance?: BaseRelayRecipientInstance
  relayRegistrar!: IRelayRegistrarInstance
  erc20Token!: IERC20TokenInstance
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
  readonly environment: Environment
  transactionType: TransactionType = TransactionType.LEGACY

  constructor (
    {
      maxPageSize,
      provider,
      versionManager,
      logger,
      environment,
      deployment = {}
    }: ConstructorParams) {
    this.maxPageSize = maxPageSize
    this.logger = logger
    this.versionManager = versionManager ?? new VersionsManager(gsnRuntimeVersion, gsnRequiredVersion)
    this.web3 = new Web3(provider as any)
    this.deployment = deployment
    this.provider = provider
    this.lastBlockNumber = 0
    this.environment = environment
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
    this.IRelayRegistrar = TruffleContract({
      contractName: 'IRelayRegistrar',
      abi: relayRegistrarAbi
    })
    this.IERC20Token = TruffleContract({
      contractName: 'IERC20Token',
      abi: iErc20TokenAbi
    })
    this.IStakeManager.setProvider(this.provider, undefined)
    this.IRelayHubContract.setProvider(this.provider, undefined)
    this.IPaymasterContract.setProvider(this.provider, undefined)
    this.IForwarderContract.setProvider(this.provider, undefined)
    this.IPenalizer.setProvider(this.provider, undefined)
    this.IRelayRecipient.setProvider(this.provider, undefined)
    this.IRelayRegistrar.setProvider(this.provider, undefined)
    this.IERC20Token.setProvider(this.provider, undefined)

    this.relayCallMethod = this.IRelayHubContract.createContract('').methods.relayCall
  }

  async init (): Promise<ContractInteractor> {
    const initStartTimestamp = Date.now()
    this.logger.debug('interactor init start')
    if (this.rawTxOptions != null) {
      throw new Error('init was already called')
    }
    const block = await this.web3.eth.getBlock('latest').catch((e: Error) => { throw new Error(`getBlock('latest') failed: ${e.message}\nCheck your internet/ethereum node connection`) })
    if (block.baseFeePerGas != null) {
      this.transactionType = TransactionType.TYPE_TWO
    }
    await this._resolveDeployment()
    await this._initializeContracts()
    await this._validateCompatibility()
    await this._initializeNetworkParams()
    if (this.relayHubInstance != null) {
      this.relayHubConfiguration = await this.relayHubInstance.getConfiguration()
    }
    this.logger.debug(`client init finished in ${Date.now() - initStartTimestamp} ms`)
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
      this.paymasterInstance.getRelayHub().catch((e: Error) => { throw new Error(`Not a paymaster contract: ${e.message}`) }),
      this.paymasterInstance.getTrustedForwarder().catch(
        (e: Error) => { throw new Error(`paymaster has no trustedForwarder(): ${e.message}`) }),
      this.paymasterInstance.versionPaymaster().catch((e: Error) => { throw new Error(`Not a paymaster contract: ${e.message}`) }).then(
        (version: string) => {
          this._validateVersion(version, 'Paymaster')
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
    const [stakeManagerAddress, penalizerAddress, relayRegistrarAddress] = await Promise.all([
      this._hubStakeManagerAddress(),
      this._hubPenalizerAddress(),
      this._hubRelayRegistrarAddress()
    ])
    this.deployment.relayHubAddress = relayHubAddress
    this.deployment.stakeManagerAddress = stakeManagerAddress
    this.deployment.penalizerAddress = penalizerAddress
    this.deployment.relayRegistrarAddress = relayRegistrarAddress
  }

  async _validateCompatibility (): Promise<void> {
    if (this.deployment == null || this.relayHubInstance == null) {
      return
    }
    const hub = this.relayHubInstance
    const version = await hub.versionHub()
    this._validateVersion(version, 'RelayHub')
  }

  _validateVersion (version: string, contractName: string): void {
    const versionSatisfied = this.versionManager.isRequiredVersionSatisfied(version)
    if (!versionSatisfied) {
      throw new Error(
        `Provided ${contractName} version(${version}) does not satisfy the requirement(${this.versionManager.requiredVersionRange})`)
    }
  }

  async _initializeContracts (): Promise<void> {
    // TODO: do we need all this "differential" deployment ?
    // any sense NOT to initialize some components, or NOT to read them all from the PM and then RH ?
    if (this.relayHubInstance == null && this.deployment.relayHubAddress != null) {
      this.relayHubInstance = await this._createRelayHub(this.deployment.relayHubAddress)
    }
    if (this.relayRegistrar == null && this.deployment.relayRegistrarAddress != null) {
      this.relayRegistrar = await this._createRelayRegistrar(this.deployment.relayRegistrarAddress)
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
    if (this.deployment.managerStakeTokenAddress != null) {
      this.erc20Token = await this._createERC20(this.deployment.managerStakeTokenAddress)
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

  async _createRelayRegistrar (address: Address): Promise<IRelayRegistrarInstance> {
    return await this.IRelayRegistrar.at(address)
  }

  async _createERC20 (address: Address): Promise<IERC20TokenInstance> {
    return await this.IERC20Token.at(address)
  }

  /**
   * Queries the balance of the token and displays it in a human-readable format, taking 'decimals' into account.
   * Note: does not round up the fraction and truncates it.
   */
  async getTokenBalanceFormatted (address: Address): Promise<string> {
    const balance = await this.erc20Token.balanceOf(address)
    return await this.formatTokenAmount(balance)
  }

  async formatTokenAmount (balance: BN): Promise<string> {
    const { tokenSymbol, tokenDecimals } = await this.getErc20TokenMetadata()
    return formatTokenAmount(balance, tokenDecimals, tokenSymbol)
  }

  async getErc20TokenMetadata (): Promise<ERC20TokenMetadata> {
    let tokenName: string
    try {
      tokenName = await this.erc20Token.name()
    } catch (_) {
      tokenName = `ERC-20 token ${this.erc20Token.address}`
    }
    let tokenSymbol: string
    try {
      tokenSymbol = await this.erc20Token.symbol()
    } catch (_) {
      tokenSymbol = `ERC-20 token ${this.erc20Token.address}`
    }
    let tokenDecimals: BN
    try {
      tokenDecimals = await this.erc20Token.decimals()
    } catch (_) {
      tokenDecimals = toBN(0)
    }
    return { tokenName, tokenSymbol, tokenDecimals }
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

  _fixGasFees (relayRequest: RelayRequest): { gasPrice?: string, maxFeePerGas?: string, maxPriorityFeePerGas?: string } {
    if (this.transactionType === TransactionType.LEGACY) {
      return { gasPrice: toHex(relayRequest.relayData.maxFeePerGas) }
    } else {
      return {
        maxFeePerGas: toHex(relayRequest.relayData.maxFeePerGas),
        maxPriorityFeePerGas: toHex(relayRequest.relayData.maxPriorityFeePerGas)
      }
    }
  }

  /**
   * make a view call to relayCall(), just like the way it will be called by the relayer.
   * returns:
   * - paymasterAccepted - true if accepted
   * - reverted - true if relayCall was reverted.
   * - returnValue - if either reverted or paymaster NOT accepted, then this is the reason string.
   */
  async validateRelayCall (
    relayCallABIData: RelayCallABI,
    viewCallGasLimit: BN): Promise<{ paymasterAccepted: boolean, returnValue: string, reverted: boolean }> {
    if (viewCallGasLimit == null || relayCallABIData.relayRequest.relayData.maxFeePerGas == null || relayCallABIData.relayRequest.relayData.maxPriorityFeePerGas == null) {
      throw new Error('validateRelayCall: invalid input')
    }
    const relayHub = this.relayHubInstance
    try {
      const encodedRelayCall = this.encodeABI(relayCallABIData)
      const res: string = await new Promise((resolve, reject) => {
        const gasFees = this._fixGasFees(relayCallABIData.relayRequest)
        const rpcPayload = {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [
            {
              from: relayCallABIData.relayRequest.relayData.relayWorker,
              to: relayHub.address,
              gas: toHex(viewCallGasLimit),
              data: encodedRelayCall,
              ...gasFees
            },
            'latest'
          ]
        }
        this.logger.debug(`Sending in view mode: \n${JSON.stringify(rpcPayload)}\n encoded data: \n${JSON.stringify(relayCallABIData)}`)
        // @ts-ignore
        this.web3.currentProvider.send(rpcPayload, (err: any, res: { result: string, error: any }) => {
          if (res.error != null) {
            err = res.error
          }
          const revertMsg = this._decodeRevertFromResponse(err, res)
          if (revertMsg != null) {
            reject(new Error(revertMsg))
          } else if (errorAsBoolean(err)) {
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

  async getMaxViewableGasLimit (relayRequest: RelayRequest, maxViewableGasLimit: IntString): Promise<BN> {
    const maxViewableGasLimitBN = toBN(maxViewableGasLimit)
    const gasPrice = toBN(relayRequest.relayData.maxFeePerGas)
    if (gasPrice.eqn(0)) {
      return maxViewableGasLimitBN
    }
    const workerBalanceString = await this.getBalance(relayRequest.relayData.relayWorker)
    if (workerBalanceString == null) {
      this.logger.error('getMaxViewableGasLimit: failed to get relay worker balance')
      return maxViewableGasLimitBN
    }
    const workerBalance = toBN(workerBalanceString)
    const workerGasLimit = workerBalance.div(gasPrice)
    return BN.min(maxViewableGasLimitBN, workerGasLimit)
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
      // also cleaning up Hardhat Node's verbose revert errors
      return matchGanache[1].replace('with reason string ', '').replace(/^'|'$/g, '')
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

  encodeABI (
    _: RelayCallABI
  ): PrefixedHexString {
    return this.relayCallMethod(_.maxAcceptanceBudget, _.relayRequest, _.signature, _.approvalData).encodeABI()
  }

  async getPastEventsForHub (extraTopics: string[], options: PastEventOptions, names: EventName[] = ActiveManagerEvents): Promise<EventData[]> {
    return await this._getPastEventsPaginated(this.relayHubInstance.contract, names, extraTopics, options)
  }

  async getPastEventsForRegistrar (extraTopics: string[], options: PastEventOptions, names: EventName[] = [RelayServerRegistered]): Promise<EventData[]> {
    return await this._getPastEventsPaginated(this.relayRegistrar.contract, names, extraTopics, options)
  }

  async getPastEventsForStakeManager (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    const stakeManager = await this.stakeManagerInstance
    return await this._getPastEventsPaginated(stakeManager.contract, names, extraTopics, options)
  }

  async getPastEventsForPenalizer (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    return await this._getPastEventsPaginated(this.penalizerInstance.contract, names, extraTopics, options)
  }

  getLogsPagesForRange (fromBlock: BlockNumber = 1, toBlock?: BlockNumber): number {
    // save 'getBlockNumber' roundtrip for a known max value
    if (this.maxPageSize === Number.MAX_SAFE_INTEGER) {
      return 1
    }
    // noinspection SuspiciousTypeOfGuard - known false positive
    if (typeof fromBlock !== 'number' || typeof toBlock !== 'number') {
      throw new Error(
        `ContractInteractor:getLogsPagesForRange: [${fromBlock.toString()}..${toBlock?.toString()}]: only numbers supported when using pagination`)
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
              const pastEvents = await this._getPastEvents(contract, names, extraTopics, Object.assign({}, options, {
                fromBlock,
                toBlock
              }))
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
          this.logger.warn(
            'Received "query returned more than X events" error from server, will try to split the request into smaller chunks')
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
    const topics: Array<string | null | string[]> = []
    const eventTopic = event2topic(contract, names)
    topics.push(eventTopic)
    const isEmptyArray = (a: any): boolean => Array.isArray(a) && a.length === 0

    // TODO: AFAIK this means only the first parameter of the event is supported
    if (extraTopics.length > 0) {
      topics.push(extraTopics.map((topic: any) => isEmptyArray(topic) ? null : topic))
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

  async estimateGas (transactionDetails: TransactionConfig): Promise<number> {
    return await this.web3.eth.estimateGas(transactionDetails)
  }

  async estimateGasWithoutCalldata (gsnTransactionDetails: GsnTransactionDetails): Promise<number> {
    const originalGasEstimation = await this.estimateGas(gsnTransactionDetails)
    const calldataGasCost = this.calculateCalldataCost(gsnTransactionDetails.data)
    const adjustedEstimation = originalGasEstimation - calldataGasCost
    this.logger.debug(
      `estimateGasWithoutCalldata: original estimation: ${originalGasEstimation}; calldata cost: ${calldataGasCost}; adjusted estimation: ${adjustedEstimation}`)
    if (adjustedEstimation < 0) {
      throw new Error('estimateGasWithoutCalldata: calldataGasCost exceeded originalGasEstimation\n' +
        'your Environment configuration and Ethereum node you are connected to are not compatible')
    }
    return adjustedEstimation
  }

  /**
   * @returns result - maximum possible gas consumption by this relayed call
   * (calculated on chain by RelayHub.verifyGasAndDataLimits)
   */
  calculateTransactionMaxPossibleGas (
    _: {
      msgData: PrefixedHexString
      gasAndDataLimits: PaymasterGasAndDataLimits
      relayCallGasLimit: string
    }): number {
    const msgDataLength = toBuffer(_.msgData).length
    const msgDataGasCostInsideTransaction =
      toBN(this.environment.dataOnChainHandlingGasCostPerByte)
        .muln(msgDataLength)
        .toNumber()
    const calldataCost = this.calculateCalldataCost(_.msgData)
    const result = parseInt(this.relayHubConfiguration.gasOverhead.toString()) +
      msgDataGasCostInsideTransaction +
      calldataCost +
      parseInt(_.relayCallGasLimit) +
      parseInt(_.gasAndDataLimits.preRelayedCallGasLimit.toString()) +
      parseInt(_.gasAndDataLimits.postRelayedCallGasLimit.toString())
    this.logger.debug(`
input:\n${JSON.stringify(_)}
msgDataLength: ${msgDataLength}
calldataCost: ${calldataCost}
msgDataGasCostInsideTransaction: ${msgDataGasCostInsideTransaction}
environment: ${JSON.stringify(this.environment)}
relayHubConfiguration: ${JSON.stringify(this.relayHubConfiguration)}
calculateTransactionMaxPossibleGas: result: ${result}
`)
    return result
  }

  /**
   * @param relayRequestOriginal request input of the 'relayCall' method with some fields not yet initialized
   * @param variableFieldSizes configurable sizes of 'relayCall' parameters with variable size types
   * @return {PrefixedHexString} top boundary estimation of how much gas sending this data will consume
   */
  estimateCalldataCostForRequest (
    relayRequestOriginal: RelayRequest,
    variableFieldSizes: { maxApprovalDataLength: number, maxPaymasterDataLength: number }
  ): PrefixedHexString {
    // protecting the original object from temporary modifications done here
    const relayRequest: RelayRequest =
      Object.assign(
        {}, relayRequestOriginal,
        {
          relayData: Object.assign({}, relayRequestOriginal.relayData)
        })
    relayRequest.relayData.transactionCalldataGasUsed = '0xffffffffff'
    relayRequest.relayData.paymasterData = '0x' + 'ff'.repeat(variableFieldSizes.maxPaymasterDataLength)
    const maxAcceptanceBudget = '0xffffffffff'
    const signature = '0x' + 'ff'.repeat(65)
    const approvalData = '0x' + 'ff'.repeat(variableFieldSizes.maxApprovalDataLength)
    const encodedData = this.encodeABI({
      relayRequest,
      signature,
      approvalData,
      maxAcceptanceBudget
    })
    return `0x${this.calculateCalldataCost(encodedData).toString(16)}`
  }

  calculateCalldataCost (msgData: PrefixedHexString): number {
    const { calldataZeroBytes, calldataNonzeroBytes } = calculateCalldataBytesZeroNonzero(msgData)
    return calldataZeroBytes * this.environment.gtxdatazero +
      calldataNonzeroBytes * this.environment.gtxdatanonzero
  }

  // TODO: cache response for some time to optimize. It doesn't make sense to optimize these requests in calling code.
  async getGasPrice (): Promise<IntString> {
    const gasPriceFromNode = await this.web3.eth.getGasPrice()
    if (gasPriceFromNode == null) {
      throw new Error('getGasPrice: node returned null value')
    }
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!this.environment.getGasPriceFactor) {
      this.logger.warn('Environment not set')
      return gasPriceFromNode
    }
    const gasPriceActual =
      toBN(gasPriceFromNode)
        .muln(this.environment.getGasPriceFactor)
    return gasPriceActual.toString()
  }

  async getFeeHistory (blockCount: number | BigNumber | BN | string, lastBlock: number | BigNumber | BN | string, rewardPercentiles: number[]): Promise<FeeHistoryResult> {
    return await this.web3.eth.getFeeHistory(blockCount, lastBlock, rewardPercentiles)
  }

  async getMaxPriorityFee (): Promise<string> {
    const gasFees = await this.getGasFees()
    return gasFees.priorityFeePerGas
  }

  async getGasFees (): Promise<{ baseFeePerGas: string, priorityFeePerGas: string }> {
    if (this.transactionType === TransactionType.LEGACY) {
      const gasPrice = await this.getGasPrice()
      return { baseFeePerGas: gasPrice, priorityFeePerGas: gasPrice }
    }
    const networkHistoryFees = await this.getFeeHistory('0x1', 'latest', [0.5])
    const baseFeePerGas = networkHistoryFees.baseFeePerGas[0]
    const priorityFeePerGas = networkHistoryFees.reward[0][0]
    return { baseFeePerGas, priorityFeePerGas }
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

  async workerToManager (worker: Address): Promise<string> {
    return await this.relayHubInstance.getWorkerManager(worker)
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
   * @param managerAddress
   */
  async getStakeInfo (managerAddress: Address): Promise<StakeInfo> {
    const getStakeInfoResult = await this.stakeManagerInstance.getStakeInfo(managerAddress)
    // @ts-ignore - TypeChain generates incorrect type declarations for tuples
    return getStakeInfoResult[0]
  }

  async isRelayManagerStakedOnHub (relayManager: Address): Promise<ManagerStakeStatus> {
    const res: ManagerStakeStatus = await new Promise((resolve) => {
      const rpcPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: this.relayHubInstance.address,
            data: this.relayHubInstance.contract.methods.verifyRelayManagerStaked(relayManager).encodeABI()
          },
          'latest'
        ]
      }
      // @ts-ignore
      this.web3.currentProvider.send(rpcPayload, (err: any, res: { result: string, error: any }) => {
        if (res.error != null) {
          err = res.error
        }
        const errorMessage = this._decodeRevertFromResponse(err, res)
        resolve({
          isStaked: res.result === '0x',
          errorMessage
        })
      })
    })
    return res
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
    const registrar = this.relayRegistrar
    return registrar?.contract.methods.registerRelayServer(baseRelayFee, pctRelayFee, url)
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
        if (errorAsBoolean(e)) {
          reject(e)
        } else if (errorAsBoolean(r.error)) {
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
    return await this.relayHubInstance.getStakeManager()
  }

  stakeManagerAddress (): Address {
    return this.stakeManagerInstance.address
  }

  private async _hubPenalizerAddress (): Promise<Address> {
    return await this.relayHubInstance.getPenalizer()
  }

  private async _hubRelayRegistrarAddress (): Promise<Address> {
    return await this.relayHubInstance.getRelayRegistrar()
  }

  penalizerAddress (): Address {
    return this.penalizerInstance.address
  }

  /**
   * discover registered relays
   * @param subset if set, then filter only to these relays
   */
  async getRegisteredRelays (subset?: string[], fromBlock?: number): Promise<RelayRegisteredEventInfo[]> {
    const infoFromStorage = await this.getRegisteredRelaysFromRegistrar()
    if (infoFromStorage != null) {
      return infoFromStorage.filter(info => subset == null || subset.includes(info.relayManager))
    } else {
      return await this.getRegisteredRelaysFromEvents(subset, fromBlock)
    }
  }

  async getRegisteredRelaysFromEvents (subsetManagers?: string[], fromBlock?: number): Promise<RelayRegisteredEventInfo[]> {
    // each topic in getPastEvent is either a string or array-of-strings, to search for any.
    const extraTopics = subsetManagers == null ? [] : [subsetManagers?.map(address2topic)] as any
    const registerEvents = await this.getPastEventsForRegistrar(extraTopics,
      { fromBlock },
      [RelayServerRegistered])
    const unregisterEvents = await this.getPastEventsForStakeManager([HubUnauthorized, StakePenalized, StakeUnlocked], [extraTopics], { fromBlock })
    // we don't check event order: removed relayer can't be re-registered, so we simply ignore any "register" of a relayer that was ever removed/unauthorized/penalized
    const removed = new Set(unregisterEvents.map(event => event.returnValues.relayManager))
    const relaySet: { [relayManager: string]: RelayRegisteredEventInfo } = {}
    registerEvents
      .filter(event => !removed.has(event.returnValues.relayManager))
      .map(event => {
        const { relayManager, pctRelayFee, baseRelayFee, url } = event.returnValues
        const ret: RelayRegisteredEventInfo = {
          relayManager, pctRelayFee, baseRelayFee, relayUrl: url
        }
        return ret
      })
      .forEach(info => {
        relaySet[info.relayManager] = info
      })
    return Object.values(relaySet)
  }

  /**
   * get registered relayers from registrar
   * (output format matches event info)
   */
  async getRegisteredRelaysFromRegistrar (): Promise<null | RelayRegisteredEventInfo[]> {
    if (this.relayRegistrar == null) {
      return null
    }
    const ret = await this.relayRegistrar.readRelayInfos(0, 100)
    const relayInfos = ret[0]
    const filled = parseInt(ret[1].toString())
    if (filled === 0) {
      return null
    }

    const infos = relayInfos.slice(0, filled)
    return infos.map(info => {
      return {
        relayManager: info.relayManager,
        pctRelayFee: info.pctRelayFee.toString(),
        baseRelayFee: info.baseRelayFee.toString(),
        relayUrl: info.url
      }
    })
  }

  async getRegisteredWorkers (managerAddress: Address): Promise<Address[]> {
    const topics = address2topic(managerAddress)
    const workersAddedEvents = await this.getPastEventsForHub([topics], { fromBlock: 1 }, [RelayWorkersAdded])
    return workersAddedEvents.map(it => it.returnValues.newRelayWorkers).flat()
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
      }, 'london')
  }
}
