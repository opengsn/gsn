export default class RelayFailureInfo {
  public lastErrorTime: number
  public relayManager: string
  public relayUrl: string

  constructor (lastErrorTime: number, relayManager: any, relayUrl: any) {
    this.lastErrorTime = lastErrorTime
    this.relayManager = relayManager
    this.relayUrl = relayUrl
  }
}
