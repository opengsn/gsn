import { PingResponse } from '../PingResponse'
import { RelayInfoUrl } from './GSNContractsDataTypes'

// Well, I still don't like it
// Some info is known from the event, some from ping
export interface PartialRelayInfo {
  relayInfo: RelayInfoUrl
  pingResponse: PingResponse
}

export interface RelayInfo {
  pingResponse: PingResponse
  relayInfo: RegistrarRelayInfo
}

export interface RegistrarRelayInfo {
  lastSeenBlockNumber: BN
  lastSeenTimestamp: BN
  firstSeenBlockNumber: BN
  firstSeenTimestamp: BN
  relayUrl: string
  relayManager: string
}
