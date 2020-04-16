import RelayInfo from './types/RelayInfo'
import KnownRelaysManager from './KnownRelaysManager'
import HttpClient from './HttpClient'
import RelayRegisteredEventInfo from './types/RelayRegisteredEventInfo'
import { PingFilter } from './types/Aliases'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import replaceErrors from '../common/ErrorReplacerJSON'
import { RelaySelectionManagerConfig } from './GSNConfigurator'

interface RaceResult {
  winner?: RelayInfo
  errors: Map<string, Error>
}

export default class RelaySelectionManager {
  private readonly knownRelaysManager: KnownRelaysManager
  private readonly httpClient: HttpClient
  private readonly config: RelaySelectionManagerConfig
  private readonly pingFilter: PingFilter
  private readonly gsnTransactionDetails: GsnTransactionDetails

  private remainingRelays: RelayRegisteredEventInfo[] | undefined

  public errors: Map<string, Error> = new Map<string, Error>()

  constructor (gsnTransactionDetails: GsnTransactionDetails, knownRelaysManager: KnownRelaysManager, httpClient: HttpClient, pingFilter: PingFilter, config: RelaySelectionManagerConfig) {
    this.gsnTransactionDetails = gsnTransactionDetails
    this.knownRelaysManager = knownRelaysManager
    this.httpClient = httpClient
    this.pingFilter = pingFilter
    this.config = config
  }

  /**
   * Ping those relays that were not pinged yet, and remove both the returned relay or relays re from {@link remainingRelays}
   * @returns the first relay to respond to a ping message. Note: will never return the same relay twice.
   */
  async selectNextRelay (): Promise<RelayInfo | undefined> {
    while (true) {
      const slice = this._getNextSlice()
      let relayInfo: RelayInfo | undefined
      if (slice.length > 0) {
        relayInfo = await this._nextRelayInternal(slice)
        if (relayInfo == null) {
          continue
        }
      }
      return relayInfo
    }
  }

  async _nextRelayInternal (relays: RelayRegisteredEventInfo[]): Promise<RelayInfo | undefined> {
    if (this.config.verbose) {
      console.log('nextRelay: find fastest relay from: ' + JSON.stringify(relays))
    }
    const filterRelayPingPromises = relays
      .map((relayRegisteredEventInfo): { relayRegisteredEventInfo: RelayRegisteredEventInfo, promise: Promise<RelayInfo> } => {
        return {
          relayRegisteredEventInfo,
          promise: this._getRelayAddressPing(relayRegisteredEventInfo)
        }
      })
    const raceResult = await this._raceToSuccess(filterRelayPingPromises)
    if (this.config.verbose) {
      console.log(`race finished with a result: ${JSON.stringify(raceResult, replaceErrors)}`)
    }
    this._handleRaceResults(raceResult)
    return raceResult.winner
  }

  _getNextSlice (): RelayRegisteredEventInfo[] {
    if (this.remainingRelays == null) {
      this.remainingRelays = this.knownRelaysManager.getRelaysSorted()
    }
    const bulkSize = Math.min(this.config.sliceSize, this.remainingRelays.length)
    const slice = this.remainingRelays.slice(0, bulkSize)
    // we must verify uniqueness of URLs as they are used as keys in maps
    // https://stackoverflow.com/a/45125209
    slice.filter((e1, i) =>
      slice.findIndex((e2) => e1.relayUrl === e2.relayUrl) === i
    )
    return slice
  }

  /**
   * @returns JSON response from the relay server, but adds the requested URL to it :'-(
   */
  async _getRelayAddressPing (eventInfo: RelayRegisteredEventInfo): Promise<RelayInfo> {
    if (this.config.verbose) {
      console.log(`getRelayAddressPing URL: ${eventInfo.relayUrl}`)
    }
    const pingResponse = await this.httpClient.getPingResponse(eventInfo.relayUrl)

    if (!pingResponse.Ready) {
      throw new Error(`Relay not ready ${JSON.stringify(pingResponse)}`)
    }
    this.pingFilter(pingResponse, this.gsnTransactionDetails)
    return {
      pingResponse,
      eventInfo
    }
  }

  /**
   * From https://stackoverflow.com/a/37235207 (added types, modified to catch exceptions)
   * Accepts an array of promises.
   * Resolves once any promise resolves, ignores the rest. Exceptions returned separately.
   */
  async _raceToSuccess (promises: Array<{ relayRegisteredEventInfo: RelayRegisteredEventInfo, promise: Promise<RelayInfo> }>): Promise<RaceResult> {
    const errors: Map<string, Error> = new Map<string, Error>()
    return new Promise((resolve) => {
      promises.forEach((promise: { relayRegisteredEventInfo: RelayRegisteredEventInfo, promise: Promise<RelayInfo> }) => {
        promise.promise.then((winner: RelayInfo) => {
          resolve({
            winner,
            errors
          })
        }).catch((err: Error) => {
          errors.set(promise.relayRegisteredEventInfo.relayUrl, err)
          if (errors.size === promises.length) {
            resolve({ errors })
          }
        })
      })
    })
  }

  _handleRaceResults (raceResult: RaceResult): void {
    this.errors = new Map([...this.errors, ...raceResult.errors])
    this.remainingRelays = this.remainingRelays
      ?.filter(eventInfo => eventInfo.relayUrl !== raceResult.winner?.eventInfo.relayUrl)
      ?.filter(eventInfo => !Array.from(raceResult.errors.keys()).includes(eventInfo.relayUrl))
  }
}
