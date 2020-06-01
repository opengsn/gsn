import { PrefixedHexString } from 'ethereumjs-tx'
import { Address, IntString } from '../../relayclient/types/Aliases'
import GasData from './GasData'
import RelayData from './RelayData'

export default interface RelayRequest {
  target: Address
  encodedFunction: PrefixedHexString
  senderAddress: Address
  senderNonce: IntString
  gasLimit: IntString
  forwarder: Address
  gasData: GasData
  relayData: RelayData
}

export function cloneRelayRequest (relayRequest: RelayRequest): RelayRequest {
  return {
    target: relayRequest.target,
    encodedFunction: relayRequest.encodedFunction,
    senderAddress: relayRequest.senderAddress,
    senderNonce: relayRequest.senderNonce,
    gasLimit: relayRequest.gasLimit,
    forwarder: relayRequest.forwarder,
    gasData: {
      gasPrice: relayRequest.gasData.gasPrice,
      pctRelayFee: relayRequest.gasData.pctRelayFee,
      baseRelayFee: relayRequest.gasData.baseRelayFee
    },
    relayData: {
      paymaster: relayRequest.relayData.paymaster,
      relayWorker: relayRequest.relayData.relayWorker
    }
  }
}
