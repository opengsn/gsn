import RelayData from './RelayData'
import ForwardRequest from './ForwardRequest'

export default interface RelayRequest {
  request: ForwardRequest
  relayData: RelayData
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
      forwarder: relayRequest.relayData.forwarder,
      relayWorker: relayRequest.relayData.relayWorker
    }
  }
}
