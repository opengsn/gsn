import Web3 from 'web3'
import { BlockNumber, Log, PastLogsOptions, provider, Transaction, TransactionReceipt } from 'web3-core'
import { EventData, PastEventOptions } from 'web3-eth-contract'
import { PrefixedHexString, TransactionOptions } from 'ethereumjs-tx'

import RelayRequest from '../common/EIP712/RelayRequest'
import paymasterAbi from '../common/interfaces/IPaymaster.json'
import relayHubAbi from '../common/interfaces/IRelayHub.json'
import forwarderAbi from '../common/interfaces/IForwarder.json'
import stakeManagerAbi from '../common/interfaces/IStakeManager.json'
import gsnRecipientAbi from '../common/interfaces/IRelayRecipient.json'
import knowForwarderAddressAbi from '../common/interfaces/IKnowForwarderAddress.json'

import { event2topic } from '../common/Utils'
import { constants } from '../common/Constants'
import replaceErrors from '../common/ErrorReplacerJSON'
import VersionsManager from '../common/VersionsManager'
import {
  BaseRelayRecipientInstance,
  IKnowForwarderAddressInstance,
  IPaymasterInstance,
  IRelayHubInstance,
  IRelayRecipientInstance,
  IStakeManagerInstance,
  IForwarderInstance
} from '../../types/truffle-contracts'

import { Address, IntString } from './types/Aliases'
import { GSNConfig } from './GSNConfigurator'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { BlockTransactionString } from 'web3-eth'
import Common from 'ethereumjs-common'

// Truffle Contract typings seem to be completely out of their minds
import TruffleContract = require('@truffle/contract')
import Contract = Truffle.Contract

type EventName = string

export const RelayServerRegistered: EventName = 'RelayServerRegistered'
export const StakeUnlocked: EventName = 'StakeUnlocked'
export const HubUnauthorized: EventName = 'HubUnauthorized'
export const StakePenalized: EventName = 'StakePenalized'

export default class ContractInteractor {
  private readonly VERSION = '2.0.0-beta.1'

  private readonly IPaymasterContract: Contract<IPaymasterInstance>
  private readonly IRelayHubContract: Contract<IRelayHubInstance>
  private readonly IForwarderContract: Contract<IForwarderInstance>
  private readonly IStakeManager: Contract<IStakeManagerInstance>
  private readonly IRelayRecipient: Contract<BaseRelayRecipientInstance>
  private readonly IKnowForwarderAddress: Contract<IKnowForwarderAddressInstance>

  private readonly web3: Web3
  private readonly provider: provider
  private readonly config: GSNConfig
  private readonly versionManager: VersionsManager

  private rawTxOptions?: TransactionOptions
  private chainId?: number
  private networkId?: number
  private networkType?: string

  constructor (provider: provider, config: GSNConfig) {
    this.versionManager = new VersionsManager(this.VERSION)
    this.web3 = new Web3(provider)
    this.config = config
    this.provider = provider
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
    this.IRelayRecipient = TruffleContract({
      contractName: 'IRelayRecipient',
      abi: gsnRecipientAbi
    })
    // @ts-ignore
    this.IKnowForwarderAddress = TruffleContract({
      contractName: 'IKnowForwarderAddress',
      abi: knowForwarderAddressAbi
    })
    this.IStakeManager.setProvider(this.provider, undefined)
    this.IRelayHubContract.setProvider(this.provider, undefined)
    this.IPaymasterContract.setProvider(this.provider, undefined)
    this.IForwarderContract.setProvider(this.provider, undefined)
    this.IRelayRecipient.setProvider(this.provider, undefined)
    this.IKnowForwarderAddress.setProvider(this.provider, undefined)
  }

  getProvider (): provider { return this.provider }

  getWeb3 (): Web3 { return this.web3 }

  async _init (): Promise<void> {
    await this._validateCompatibility()
    const chain = await this.web3.eth.net.getNetworkType()
    this.chainId = await this.web3.eth.getChainId()
    this.networkId = await this.web3.eth.net.getId()
    this.networkType = await this.web3.eth.net.getNetworkType()
    // chain === 'private' means we're on ganache, and ethereumjs-tx.Transaction doesn't support that chain type
    this.rawTxOptions = getRawTxOptions(this.chainId, this.networkId, chain)
  }

  async _validateCompatibility (): Promise<void> {
    if (this.config.relayHubAddress === constants.ZERO_ADDRESS) {
      return
    }
    const hub = await this._createRelayHub(this.config.relayHubAddress)
    const version = await hub.versionHub()
    const isNewer = this.versionManager.isMinorSameOrNewer(version)
    if (!isNewer) {
      throw new Error(`Provided Hub version(${version}) is not supported by the current interactor(${this.VERSION})`)
    }
  }

  // must use these options when creating Transaction object
  getRawTxOptions (): TransactionOptions {
    if (this.rawTxOptions == null) {
      throw new Error('_init not called')
    }
    return this.rawTxOptions
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createKnowsForwarder (address: Address): Promise<IKnowForwarderAddressInstance> {
    return await this.IKnowForwarderAddress.at(address)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createRecipient (address: Address): Promise<IRelayRecipientInstance> {
    return await this.IRelayRecipient.at(address)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createPaymaster (address: Address): Promise<IPaymasterInstance> {
    return await this.IPaymasterContract.at(address)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createRelayHub (address: Address): Promise<IRelayHubInstance> {
    return await this.IRelayHubContract.at(address)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createForwarder (address: Address): Promise<IForwarderInstance> {
    return await this.IForwarderContract.at(address)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createStakeManager (address: Address): Promise<IStakeManagerInstance> {
    return await this.IStakeManager.at(address)
  }

  async getForwarder (recipientAddress: Address): Promise<Address> {
    const recipient = await this._createKnowsForwarder(recipientAddress)
    return await recipient.getTrustedForwarder()
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

  async validateAcceptRelayCall (
    relayRequest: RelayRequest,
    signature: PrefixedHexString,
    approvalData: PrefixedHexString): Promise<{ paymasterAccepted: boolean, returnValue: string, reverted: boolean }> {
    const relayHub = await this._createRelayHub(this.config.relayHubAddress)
    try {
      const externalGasLimit = await this._getBlockGasLimit()

      const res = await relayHub.contract.methods.relayCall(
        relayRequest,
        signature,
        approvalData,
        externalGasLimit
      )
        .call({
          from: relayRequest.relayData.relayWorker,
          gasPrice: relayRequest.relayData.gasPrice,
          gas: externalGasLimit
        })
      if (this.config.verbose) {
        console.log(res)
      }
      return {
        returnValue: res.returnValue,
        paymasterAccepted: res.paymasterAccepted,
        reverted: false
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        paymasterAccepted: false,
        reverted: true,
        returnValue: `view call to 'relayCall' reverted in client (should not happen): ${message}`
      }
    }
  }

  encodeABI (relayRequest: RelayRequest, sig: PrefixedHexString, approvalData: PrefixedHexString, externalGasLimit: IntString): PrefixedHexString {
    // TODO: check this works as expected
    // @ts-ignore
    const relayHub = new this.IRelayHubContract('')
    return relayHub.contract.methods.relayCall(relayRequest, sig, approvalData, externalGasLimit).encodeABI()
  }

  topicsForManagers (relayManagers: Address[]): string[] {
    return Array.from(relayManagers.values(),
      (address: Address) => `0x${address.replace(/^0x/, '').padStart(64, '0').toLowerCase()}`
    )
  }

  async getPastEventsForHub (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    const relayHub = await this._createRelayHub(this.config.relayHubAddress)
    return await this._getPastEvents(relayHub.contract, names, extraTopics, options)
  }

  async getPastEventsForStakeManager (names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    const stakeManager = await this._createStakeManager(this.config.stakeManagerAddress)
    return await this._getPastEvents(stakeManager.contract, names, extraTopics, options)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _getPastEvents (contract: any, names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<EventData[]> {
    const topics: string[][] = []
    const eventTopic = event2topic(contract, names)
    topics.push(eventTopic)
    if (extraTopics.length > 0) {
      topics.push(extraTopics)
    }
    return contract.getPastEvents('allEvents', Object.assign({}, options, { topics }))
  }

  async getPastLogs (options: PastLogsOptions): Promise<Log[]> {
    return await this.web3.eth.getPastLogs(options)
  }

  async getBalance (address: Address): Promise<string> {
    return await this.web3.eth.getBalance(address)
  }

  async getBlockNumber (): Promise<number> {
    return await this.web3.eth.getBlockNumber()
  }

  async sendSignedTransaction (rawTx: string): Promise<TransactionReceipt> {
    return await this.web3.eth.sendSignedTransaction(rawTx)
  }

  async estimateGas (gsnTransactionDetails: GsnTransactionDetails): Promise<number> {
    return await this.web3.eth.estimateGas(gsnTransactionDetails)
  }

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

  async getCode (address: string): Promise<string> {
    return await this.web3.eth.getCode(address)
  }

  getChainId (): number {
    if (this.chainId == null) {
      throw new Error('_init not called')
    }
    return this.chainId
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
}

/**
 * Ganache does not seem to enforce EIP-155 signature. Buidler does, though.
 * This is how {@link Transaction} constructor allows support for custom and private network.
 * @param chainId
 * @param networkId
 * @param chain
 * @return {{common: Common}}
 */
export function getRawTxOptions (chainId: number, networkId: number, chain?: string): TransactionOptions {
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
