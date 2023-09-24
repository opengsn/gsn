import { type RelayData } from './RelayData'
import { type ForwardRequest } from './ForwardRequest'

export interface RelayRequest {
  request: ForwardRequest
  relayData: RelayData
}

export function cloneRelayRequest (relayRequest: RelayRequest): RelayRequest {
  return {
    request: { ...relayRequest.request },
    relayData: { ...relayRequest.relayData }
  }
}
