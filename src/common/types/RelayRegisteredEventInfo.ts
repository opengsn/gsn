import { Address, IntString } from './Aliases'

export interface RelayInfoUrl {
  relayUrl: string
}

export interface RelayRegisteredEventInfo extends RelayInfoUrl {
  relayManager: Address
  baseRelayFee: IntString
  pctRelayFee: IntString
}

export function isInfoFromEvent (info: RelayInfoUrl): boolean {
  return 'relayManager' in info && 'baseRelayFee' in info && 'pctRelayFee' in info
}
