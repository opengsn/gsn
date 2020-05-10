import { PrefixedHexString, TransactionOptions } from 'ethereumjs-tx'

import * as ethers from 'ethers'
import RelayRequest from '../common/EIP712/RelayRequest'

import { calculateTransactionMaxPossibleGas, getRawTxOptions } from '../common/utils'
import replaceErrors from '../common/ErrorReplacerJSON'

import { Address, IntString } from './types/Aliases'
import { GSNConfig } from './GSNConfigurator'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { AsyncSendable, Filter, Provider, TransactionRequest } from 'ethers/providers'
import { IRelayRecipientFactory } from '../../types/ethers-contracts/IRelayRecipientFactory'
import { IRelayRecipient } from '../../types/ethers-contracts/IRelayRecipient'
import { IPaymasterFactory } from '../../types/ethers-contracts/IPaymasterFactory'
import { IPaymaster } from '../../types/ethers-contracts/IPaymaster'
import { IRelayHubFactory } from '../../types/ethers-contracts/IRelayHubFactory'
import { ITrustedForwarder } from '../../types/ethers-contracts/ITrustedForwarder'
import { IRelayHub } from '../../types/ethers-contracts/IRelayHub'
import { IStakeManagerFactory } from '../../types/ethers-contracts/IStakeManagerFactory'
import { IStakeManager } from '../../types/ethers-contracts/IStakeManager'
import { ITrustedForwarderFactory } from '../../types/ethers-contracts/ITrustedForwarderFactory'
import { TransactionResponse } from 'ethers/providers/abstract-provider'
import { ethersGetPastEvents, LogEvent } from './ethers_getPastEvent'
import { AddressZero } from 'ethers/constants'
import { Signer } from 'ethers'

// Truffle Contract typings seem to be completely out of their minds

type EventName = string

export const RelayServerRegistered: EventName = 'RelayServerRegistered'
export const StakeUnlocked: EventName = 'StakeUnlocked'
export const HubUnauthorized: EventName = 'HubUnauthorized'
export const StakePenalized: EventName = 'StakePenalized'

export default class ContractInteractor {
  private readonly provider: ethers.providers.JsonRpcProvider
  private readonly config: GSNConfig
  private rawTxOptions?: TransactionOptions

  constructor (provider: any, config: GSNConfig) {
    this.config = config
    this.provider = new ethers.providers.Web3Provider(provider as AsyncSendable)
  }

  async _init (): Promise<void> {
    const network = await this.provider.getNetwork()
    const chain = network.name
    if (chain === 'unknown') {
      // ethers@4 doesn't support eth_chainId: https://github.com/ethers-io/ethers.js/issues/827
      const chainId = await this.provider.send('eth_chainId', [])
      const networkId = network.chainId
      this.rawTxOptions = getRawTxOptions(chainId, networkId)
    } else {
      this.rawTxOptions = {
        chain,
        hardfork: 'istanbul'
      }
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
  async _createRecipient (address: Address): Promise<IRelayRecipient> {
    return IRelayRecipientFactory.connect(address, this.provider)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createPaymaster (address: Address): Promise<IPaymaster> {
    return IPaymasterFactory.connect(address, this.provider)
  }

  _providerOrSigner (from?: Address): Provider | Signer {
    return from != null ? this.provider.getSigner(from) : this.provider
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createRelayHub (address: Address, from?: Address): Promise<IRelayHub> {
    return IRelayHubFactory.connect(address, this._providerOrSigner(from))
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createForwarder (address: Address): Promise<ITrustedForwarder> {
    return ITrustedForwarderFactory.connect(address, this.provider)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createStakeManager (address: Address, from?: Address): Promise<IStakeManager> {
    return IStakeManagerFactory.connect(address, this._providerOrSigner(from))
  }

  async getForwarder (recipientAddress: Address): Promise<Address> {
    const recipient = await this._createRecipient(recipientAddress)
    return recipient.getTrustedForwarder()
  }

  async getSenderNonce (sender: Address, forwarderAddress: Address): Promise<IntString> {
    const forwarder = await this._createForwarder(forwarderAddress)
    const nonce = await forwarder.getNonce(sender)
    return nonce.toString()
  }

  // TODO: currently the name is incorrect, as we call to 'canRelay'
  //  but the plan is to remove 'canRelay' and move all decision-making to Paymaster and Forwarder
  //  Also, as ARC does not return a value, `reverted` flag is unnecessary. This will be addressed soon.
  async validateAcceptRelayCall (
    relayRequest: RelayRequest,
    signature: PrefixedHexString,
    approvalData: PrefixedHexString): Promise<{ success: boolean, returnValue: string, reverted: boolean }> {
    const paymaster = await this._createPaymaster(relayRequest.relayData.paymaster)
    const relayHub = await this._createRelayHub(this.config.relayHubAddress)
    const relayRequestAbiEncode = this.encodeABI(relayRequest, signature, approvalData)
    const calldataSize = relayRequestAbiEncode.length

    const gasLimits = await paymaster.getGasLimits()
    const hubOverhead = await relayHub.getHubOverhead()
    const maxPossibleGas = calculateTransactionMaxPossibleGas({
      gasLimits,
      hubOverhead: hubOverhead.toNumber(),
      relayCallGasLimit: relayRequest.gasData.gasLimit,
      calldataSize,
      gtxdatanonzero: this.config.gtxdatanonzero
    })
    let success: boolean
    let returnValue: string
    try {
      ({
        // @ts-ignore
        success,
        // @ts-ignore
        returnValue
      } = await relayHub.canRelay(
        relayRequest,
        maxPossibleGas,
        gasLimits.acceptRelayedCallGasLimit,
        signature,
        approvalData
      ))
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      return {
        success: false,
        reverted: true,
        returnValue: `canRelay reverted (should not happen): ${message}`
      }
    }
    return {
      success,
      returnValue,
      reverted: false
    }
  }

  encodeABI (relayRequest: RelayRequest, sig: PrefixedHexString, approvalData: PrefixedHexString): PrefixedHexString {
    // TODO: check this works as expected
    // @ts-ignore
    const relayHub = IRelayHubFactory.connect(AddressZero, this.provider)
    return relayHub.interface.functions.relayCall.encode([relayRequest, sig, approvalData])
  }

  topicsForManagers (relayManagers: Address[]): string[] {
    return Array.from(relayManagers.values(),
      (address: Address) => `0x${address.replace(/^0x/, '').padStart(64, '0').toLowerCase()}`
    )
  }

  async getPastEventsForHub (names: EventName[], extraTopics: string[], options: Filter): Promise<LogEvent[]> {
    const relayHub = await this._createRelayHub(this.config.relayHubAddress)
    return ethersGetPastEvents(relayHub, names, extraTopics, options)
  }

  async getPastEventsForStakeManager (names: EventName[], extraTopics: string[], options: Filter): Promise<LogEvent[]> {
    const stakeManager = await this._createStakeManager(this.config.stakeManagerAddress)
    return ethersGetPastEvents(stakeManager, names, extraTopics, options)
  }

  async getBalance (address: Address): Promise<string> {
    return (await this.provider.getBalance(address)).toString()
  }

  async getBlockNumber (): Promise<number> {
    return this.provider.getBlockNumber()
  }

  async sendSignedTransaction (rawTx: string): Promise<TransactionResponse> {
    return this.provider.sendTransaction(rawTx)
  }

  async sendTransaction (tx: TransactionRequest): Promise<TransactionResponse> {
    const { from, ...txWithoutFrom } = tx
    return this.provider.getSigner(await from)
      .sendTransaction(txWithoutFrom)
  }

  async estimateGas (gsnTransactionDetails: GsnTransactionDetails): Promise<number> {
    const tx: TransactionRequest = { ...gsnTransactionDetails, gasLimit: gsnTransactionDetails.gas }
    return await this.provider.estimateGas(tx) as unknown as number
  }

  async getGasPrice (): Promise<string> {
    return (await this.provider.getGasPrice()).toString()
  }

  async getTransactionCount (relayWorker: string): Promise<number> {
    return this.provider.getTransactionCount(relayWorker)
  }
}
