import RelayData from './RelayData'
import ForwardRequest from './ForwardRequest'
import ExtraData from './ExtraData'

export default interface RelayRequest {
  request: ForwardRequest
  relayData: RelayData
  extraData: ExtraData
}

export function cloneRelayRequest (relayRequest: RelayRequest): RelayRequest {
  return {
    request: {
      to: relayRequest.request.to,
      data: relayRequest.request.data,
      from: relayRequest.request.from,
      nonce: relayRequest.request.nonce,
      gas: relayRequest.request.gas
    },
    relayData: {
      gasPrice: relayRequest.relayData.gasPrice,
      pctRelayFee: relayRequest.relayData.pctRelayFee,
      baseRelayFee: relayRequest.relayData.baseRelayFee,
      paymaster: relayRequest.relayData.paymaster,
      relayWorker: relayRequest.relayData.relayWorker
    },
    extraData: {
      forwarder: relayRequest.extraData.forwarder,
      domainSeparator: relayRequest.extraData.domainSeparator
    }
  }
}
