import { RelayData } from './RelayData'
import { ForwardRequest } from './ForwardRequest'

export interface RelayRequest {
  request: ForwardRequest
  relayData: RelayData
}

// https://stackoverflow.com/a/51365037
type RecursivePartial<T> = {
  [P in keyof T]?:
  // eslint-disable-next-line @typescript-eslint/array-type
  T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    T[P] extends object ? RecursivePartial<T[P]> :
      T[P]
}

export function cloneRelayRequest (relayRequest: RelayRequest, overrides: RecursivePartial<RelayRequest> = {}): RelayRequest {
  return {
    request: Object.assign({}, relayRequest.request, overrides.request),
    relayData: Object.assign({}, relayRequest.relayData, overrides.relayData)
  }
}
