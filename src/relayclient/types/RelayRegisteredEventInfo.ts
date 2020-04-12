import { Address, IntString } from './Aliases'

export default interface RelayRegisteredEventInfo {
  relayManager: Address
  relayUrl: string
  baseRelayFee: IntString
  pctRelayFee: IntString
}
