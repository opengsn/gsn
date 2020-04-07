import RelayRequest from '../common/EIP712/RelayRequest'
import paymasterAbi from '../common/interfaces/IPaymaster'
import relayHubAbi from '../common/interfaces/IRelayHub'
import forwarderAbi from '../common/interfaces/ITrustedForwarder'
import {
  BasePaymasterInstance,
  IRelayHubInstance,
  ITrustedForwarderInstance
} from '../../types/truffle-contracts'

import { calculateTransactionMaxPossibleGas } from '../common/utils'
import { provider } from 'web3-core'
import { Address, IntString } from './types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

// Truffle Contract typings seem to be completely out of their minds
import TruffleContract = require('@truffle/contract')

let IPaymasterContract: any
let IRelayHubContract: any
let IForwarderContract: any

export interface ContractInteractorConfig {
  gtxdatanonzero: number
  verbose: boolean
}

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
    const IRelayHubContract = TruffleContract({
      contractName: 'IRelayHub',
      abi: relayHubAbi
    })
    // @ts-ignore
    const IForwarderContract = TruffleContract({
      contractName: 'ITrustedForwarder',
      abi: forwarderAbi
    })
    IRelayHubContract.setProvider(this.provider)
    IPaymasterContract.setProvider(this.provider)
    IForwarderContract.setProvider(this.provider)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async _createPaymaster (address: Address): Promise<BasePaymasterInstance> {
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

  // async _createRelayHubFromPaymaster (paymasterAddress: string): Promise<IRelayHubInstance> {
  //   const relayRecipient = await this._createPaymaster(paymasterAddress)
  //
  //   let relayHubAddress: string
  //   try {
  //     relayHubAddress = await relayRecipient.getHubAddr()
  //   } catch (err) {
  //     throw new Error(
  //       // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  //       `Could not get relay hub address from paymaster at ${paymasterAddress} (${err.message}). Make sure it is a valid paymaster contract.`)
  //   }
  //
  //   if (relayHubAddress === null || isZeroAddress(relayHubAddress)) {
  //     throw new Error(
  //       `The relay hub address is set to zero in paymaster at ${paymasterAddress}. Make sure it is a valid paymaster contract.`)
  //   }
  //
  //   const relayHub = await this._createRelayHub(relayHubAddress)
  //
  //   let hubVersion: string
  //   try {
  //     hubVersion = await relayHub.getVersion()
  //   } catch (err) {
  //     throw new Error(
  //       // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  //       `Could not query relay hub version at ${relayHubAddress} (${err.message}). Make sure the address corresponds to a relay hub.`)
  //   }
  //
  //   if (!hubVersion.startsWith('1')) {
  //     throw new Error(`Unsupported relay hub version '${hubVersion}'.`)
  //   }
  //
  //   return relayHub
  // }

  /**
   * check the balance of the given target contract.
   * the method will fail if the target is not a RelayRecipient.
   * (not strictly a client operation, but without a balance, the target contract can't accept calls)
   */
  // async balanceOf (target: string): Promise<BN> {
  //   const relayHub = await this._createRelayHubFromPaymaster(target)
  //   // note that the returned value is a promise too, returning BigNumber
  //   return relayHub.balanceOf(target)
  // }

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
      ([success, returnValue] = await relayHub.canRelay(
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
    const relayHub = new IRelayHubContract('')
    return relayHub.methods.relayCall(relayRequestOrig, sig, approvalData).encodeABI()
  }
}
