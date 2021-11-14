import { RelayData } from './RelayData'
import { ForwardRequest } from './ForwardRequest'

export interface BaseRelayRequest {
  request: ForwardRequest
}

export interface RelayRequest extends BaseRelayRequest {
  relayData: RelayData
}

export function cloneRelayRequest (relayRequest: RelayRequest): RelayRequest {
  return {
    request: { ...relayRequest.request },
    relayData: { ...relayRequest.relayData }
  }
}
