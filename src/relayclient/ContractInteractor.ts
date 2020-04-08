import { provider } from 'web3-core'
import { PrefixedHexString } from 'ethereumjs-tx'

import RelayRequest from '../common/EIP712/RelayRequest'
import paymasterAbi from '../common/interfaces/IPaymaster'
import relayHubAbi from '../common/interfaces/IRelayHub'
import forwarderAbi from '../common/interfaces/ITrustedForwarder'
import {
  IPaymasterInstance,
  IRelayHubInstance,
  ITrustedForwarderInstance
} from '../../types/truffle-contracts'

import { calculateTransactionMaxPossibleGas } from '../common/utils'
import { Address, IntString } from './types/Aliases'
import { ContractInteractorConfig } from './GSNConfigurator'
import { EventData, PastEventOptions } from 'web3-eth-contract'

// Truffle Contract typings seem to be completely out of their minds
import TruffleContract = require('@truffle/contract')
import Contract = Truffle.Contract

let IPaymasterContract: Contract<IPaymasterInstance>
let IRelayHubContract: Contract<IRelayHubInstance>
let IForwarderContract: Contract<ITrustedForwarderInstance>

export default class ContractInteractor {
  private readonly provider: provider
  private readonly config: ContractInteractorConfig

  constructor (provider: provider, config: ContractInteractorConfig) {
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createPaymaster (address: Address): Promise<IPaymasterInstance> {
    return IPaymasterContract.at(address)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createRelayHub (address: Address): Promise<IRelayHubInstance> {
    return IRelayHubContract.at(address)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
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
  async validateAcceptRelayCall (
    relayRequest: RelayRequest,
    signature: PrefixedHexString,
    approvalData: PrefixedHexString,
    relayHubAddress: Address): Promise<{ success: boolean, returnValue: string }> {
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
      const message = e instanceof Error ? e.message : JSON.stringify(e)
      throw new Error(`canRelay reverted (should not happen): ${message}`)
    }
    return {
      success,
      returnValue
    }
  }

  encodeABI (relayRequestOrig: RelayRequest, sig: PrefixedHexString, approvalData: PrefixedHexString): PrefixedHexString {
    // TODO: check this works as expected
    // @ts-ignore
    const relayHub = new IRelayHubContract('')
    return relayHub.contract.methods.relayCall(relayRequestOrig, sig, approvalData).encodeABI()
  }

  async getPastEventsForHub (relayHubAddress: Address, event: string | 'allEvents', options: PastEventOptions): Promise<EventData[]> {
    const relayHub = await this._createRelayHub(relayHubAddress)
    return relayHub.contract.getPastEvents(event, options)
  }
}
