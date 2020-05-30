import { PrefixedHexString } from 'ethereumjs-tx'
import { Address } from '../../relayclient/types/Aliases'
import GasData from './GasData'
import RelayData from './RelayData'

export default interface RelayRequest {
  target: Address
  encodedFunction: PrefixedHexString
  gasData: GasData
  relayData: RelayData
}

export function cloneRelayRequest (relayRequest: RelayRequest): RelayRequest {
  return {
    target: relayRequest.target,
    encodedFunction: relayRequest.encodedFunction,
    gasData: {
      gasLimit: relayRequest.gasData.gasLimit,
      gasPrice: relayRequest.gasData.gasPrice,
      pctRelayFee: relayRequest.gasData.pctRelayFee,
      baseRelayFee: relayRequest.gasData.baseRelayFee
    },
    relayData: {
      paymaster: relayRequest.relayData.paymaster,
      forwarder: relayRequest.relayData.forwarder,
      senderAddress: relayRequest.relayData.senderAddress,
      senderNonce: relayRequest.relayData.senderNonce,
      relayWorker: relayRequest.relayData.relayWorker
    }
  }
}
