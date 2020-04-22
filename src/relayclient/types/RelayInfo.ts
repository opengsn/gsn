import PingResponse from '../../common/PingResponse'
import { RelayInfoUrl, RelayRegisteredEventInfo } from './RelayRegisteredEventInfo'

// Well, I still don't like it
// Some info is known from the event, some from ping
export interface PartialRelayInfo {
  relayInfo: RelayInfoUrl
  pingResponse: PingResponse
}

export interface RelayInfo {
  pingResponse: PingResponse
  relayInfo: RelayRegisteredEventInfo
}
