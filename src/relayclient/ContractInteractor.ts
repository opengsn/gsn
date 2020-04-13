import Web3 from 'web3'
import { provider, TransactionReceipt } from 'web3-core'
import { EventData, PastEventOptions } from 'web3-eth-contract'
import { PrefixedHexString } from 'ethereumjs-tx'

import RelayRequest from '../common/EIP712/RelayRequest'
import paymasterAbi from '../common/interfaces/IPaymaster'
import relayHubAbi from '../common/interfaces/IRelayHub'
import forwarderAbi from '../common/interfaces/ITrustedForwarder'
import { calculateTransactionMaxPossibleGas } from '../common/utils'
import replaceErrors from '../common/ErrorReplacerJSON'
import {
  IPaymasterInstance,
  IRelayHubInstance,
  ITrustedForwarderInstance
} from '../../types/truffle-contracts'

import { Address, IntString } from './types/Aliases'
import { ContractInteractorConfig } from './GSNConfigurator'

// Truffle Contract typings seem to be completely out of their minds
import TruffleContract = require('@truffle/contract')
import Contract = Truffle.Contract
import GsnTransactionDetails from './types/GsnTransactionDetails'

let IPaymasterContract: Contract<IPaymasterInstance>
let IRelayHubContract: Contract<IRelayHubInstance>
let IForwarderContract: Contract<ITrustedForwarderInstance>

export default class ContractInteractor {
  private readonly web3: Web3
  private readonly provider: provider
  private readonly config: ContractInteractorConfig

  constructor (provider: provider, config: ContractInteractorConfig) {
    this.web3 = new Web3(provider)
    this.config = config
    this.provider = provider
    // @ts-ignore
    IPaymasterContract = TruffleContract({
      contractName: 'IPaymaster',
      abi: paymasterAbi
    })
    // @ts-ignore
    IRelayHubContract = TruffleContract({
      contractName: 'IRelayHub',
      abi: relayHubAbi
    })
    // @ts-ignore
    IForwarderContract = TruffleContract({
      contractName: 'ITrustedForwarder',
      abi: forwarderAbi
    })
    IRelayHubContract.setProvider(this.provider, undefined)
    IPaymasterContract.setProvider(this.provider, undefined)
    IForwarderContract.setProvider(this.provider, undefined)
  }

  async _createPaymaster (address: Address): Promise<IPaymasterInstance> {
    return IPaymasterContract.at(address)
  }

  async _createRelayHub (address: Address): Promise<IRelayHubInstance> {
    return IRelayHubContract.at(address)
  }

  async _createForwarder (address: Address): Promise<ITrustedForwarderInstance> {
    return IForwarderContract.at(address)
  }

  async getSenderNonce (sender: Address, forwarderAddress: Address): Promise<IntString> {
    const forwarder = await this._createForwarder(forwarderAddress) // TODO: this is temoporary, add Forwarder API
    const nonce = await forwarder.getNonce(sender)
    return nonce.toString()
  }

  // TODO: currently the name is incorrect, as we call to 'canRelay'
  //  but the plan is to remove 'canRelay' and move all decision-making to Paymaster and Forwarder
  //  Also, as ARC does not return a value, `reverted` flag is unnecessary. This will be addressed soon.
  async validateAcceptRelayCall (
    relayRequest: RelayRequest,
    signature: PrefixedHexString,
    approvalData: PrefixedHexString,
    relayHubAddress: Address): Promise<{ success: boolean, returnValue: string, reverted: boolean }> {
    const paymaster = await this._createPaymaster(relayRequest.relayData.paymaster)
    const relayHub = await this._createRelayHub(relayHubAddress)
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
      // @ts-ignore
      ({ success, returnValue } = await relayHub.canRelay(
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
    const relayHub = new IRelayHubContract('')
    return relayHub.contract.methods.relayCall(relayRequest, sig, approvalData).encodeABI()
  }

  async getPastEventsForHub (relayHubAddress: Address, event: string | 'allEvents', options: PastEventOptions): Promise<EventData[]> {
    const relayHub = await this._createRelayHub(relayHubAddress)
    return relayHub.contract.getPastEvents(event, options)
  }

  async getBlockNumber (): Promise<number> {
    return this.web3.eth.getBlockNumber()
  }

  async sendSignedTransaction (rawTx: string): Promise<TransactionReceipt> {
    return this.web3.eth.sendSignedTransaction(rawTx)
  }

  async estimateGas (gsnTransactionDetails: GsnTransactionDetails): Promise<number> {
    return this.web3.eth.estimateGas(gsnTransactionDetails)
  }

  async getGasPrice (): Promise<string> {
    return this.web3.eth.getGasPrice()
  }

  async getTransactionCount (relayWorker: string): Promise<number> {
    return this.web3.eth.getTransactionCount(relayWorker)
  }
}
