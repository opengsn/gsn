import PingResponse from '../../common/PingResponse'
import RelayRegisteredEventInfo from './RelayRegisteredEventInfo'

// Well, I still don't like it
// Some info is known from the event, some from ping
export default interface RelayInfo {
  pingResponse: PingResponse
  eventInfo: RelayRegisteredEventInfo
}
