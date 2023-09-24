import { type PingResponse } from '../PingResponse'
import { type RelayInfoUrl } from './GSNContractsDataTypes'

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
  lastSeenBlockNumber: number
  lastSeenTimestamp: number
  firstSeenBlockNumber: number
  firstSeenTimestamp: number
  relayUrl: string
  relayManager: string
}
