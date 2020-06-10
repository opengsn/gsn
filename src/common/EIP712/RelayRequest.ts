import GasData from './GasData'
import RelayData from './RelayData'
import ForwardRequest from './ForwardRequest'
import ExtraData from './ExtraData'

export default interface RelayRequest {
  request: ForwardRequest
  gasData: GasData
  relayData: RelayData
  extraData: ExtraData
}

export function cloneRelayRequest (relayRequest: RelayRequest): RelayRequest {
  return {
    request: {
      target: relayRequest.request.target,
      encodedFunction: relayRequest.request.encodedFunction,
      senderAddress: relayRequest.request.senderAddress,
      senderNonce: relayRequest.request.senderNonce,
      gasLimit: relayRequest.request.gasLimit
    },
    gasData: {
      gasPrice: relayRequest.gasData.gasPrice,
      pctRelayFee: relayRequest.gasData.pctRelayFee,
      baseRelayFee: relayRequest.gasData.baseRelayFee
    },
    relayData: {
      paymaster: relayRequest.relayData.paymaster,
      relayWorker: relayRequest.relayData.relayWorker
    },
    extraData: {
      forwarder: relayRequest.extraData.forwarder,
      domainSeparator: relayRequest.extraData.domainSeparator
    }
  }
}
