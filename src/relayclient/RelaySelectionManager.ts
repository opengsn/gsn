import { IKnownRelaysManager } from './KnownRelaysManager'
import HttpClient from './HttpClient'
import { isInfoFromEvent, RelayInfoUrl } from './types/RelayRegisteredEventInfo'
import { PingFilter } from './types/Aliases'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import replaceErrors from '../common/ErrorReplacerJSON'
import { GSNConfig } from './GSNConfigurator'
import { PartialRelayInfo, RelayInfo } from './types/RelayInfo'

interface RaceResult {
  winner?: PartialRelayInfo
  errors: Map<string, Error>
}

export default class RelaySelectionManager {
  private readonly knownRelaysManager: IKnownRelaysManager
  private readonly httpClient: HttpClient
  private readonly config: GSNConfig
  private readonly pingFilter: PingFilter
  private readonly gsnTransactionDetails: GsnTransactionDetails

  private remainingRelays: RelayInfoUrl[][] = []
  private isInitialized = false

  public errors: Map<string, Error> = new Map<string, Error>()

  constructor (gsnTransactionDetails: GsnTransactionDetails, knownRelaysManager: IKnownRelaysManager, httpClient: HttpClient, pingFilter: PingFilter, config: GSNConfig) {
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
  async selectNextRelay (txDetails: GsnTransactionDetails): Promise<RelayInfo | undefined> {
    while (true) {
      const slice = await this._getNextSlice(txDetails)
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

  async _nextRelayInternal (relays: RelayInfoUrl[]): Promise<RelayInfo | undefined> {
    if (this.config.verbose) {
      console.log('nextRelay: find fastest relay from: ' + JSON.stringify(relays))
    }
    const raceResult = await this._raceToSuccess(relays)
    if (this.config.verbose) {
      console.log(`race finished with a result: ${JSON.stringify(raceResult, replaceErrors)}`)
    }
    this._handleRaceResults(raceResult)
    if (raceResult.winner != null) {
      if (isInfoFromEvent(raceResult.winner.relayInfo)) {
        return (raceResult.winner as RelayInfo)
      } else {
        const events = await this.knownRelaysManager.getRelayInfoForManagers(new Set([raceResult.winner.pingResponse.RelayServerAddress]))
        if (events.length === 1) {
          return {
            pingResponse: raceResult.winner.pingResponse,
            relayInfo: events[0]
          }
        } else {
          throw new Error('Could not find register event for the winning preferred relay')
        }
      }
    }
  }

  async _getNextSlice (txDetails: GsnTransactionDetails): Promise<RelayInfoUrl[]> {
    if (!this.isInitialized) {
      this.remainingRelays = await this.knownRelaysManager.getRelaysSortedForTransaction(txDetails)
      this.isInitialized = true
    }
    for (const relays of this.remainingRelays) {
      const bulkSize = Math.min(this.config.sliceSize, relays.length)
      const slice = relays.slice(0, bulkSize)
      if (slice.length === 0) {
        continue
      }
      // we must verify uniqueness of URLs as they are used as keys in maps
      // https://stackoverflow.com/a/45125209
      slice.filter((e1, i) =>
        slice.findIndex((e2) => e1.relayUrl === e2.relayUrl) === i
      )
      return slice
    }
    return []
  }

  /**
   * @returns JSON response from the relay server, but adds the requested URL to it :'-(
   */
  async _getRelayAddressPing (relayInfo: RelayInfoUrl): Promise<PartialRelayInfo> {
    if (this.config.verbose) {
      console.log(`getRelayAddressPing URL: ${relayInfo.relayUrl}`)
    }
    const pingResponse = await this.httpClient.getPingResponse(relayInfo.relayUrl)

    if (!pingResponse.Ready) {
      throw new Error(`Relay not ready ${JSON.stringify(pingResponse)}`)
    }
    this.pingFilter(pingResponse, this.gsnTransactionDetails)
    return {
      pingResponse,
      relayInfo
    }
  }

  /**
   * From https://stackoverflow.com/a/37235207 (added types, modified to catch exceptions)
   * Accepts an array of promises.
   * Resolves once any promise resolves, ignores the rest. Exceptions returned separately.
   */
  async _raceToSuccess (relays: RelayInfoUrl[]): Promise<RaceResult> {
    const errors: Map<string, Error> = new Map<string, Error>()
    return new Promise((resolve) => {
      relays.forEach((relay: RelayInfoUrl) => {
        this._getRelayAddressPing(relay)
          .then((winner: PartialRelayInfo) => {
            resolve({
              winner,
              errors
            })
          })
          .catch((err: Error) => {
            errors.set(relay.relayUrl, err)
            if (errors.size === relays.length) {
              resolve({ errors })
            }
          })
      })
    })
  }

  _handleRaceResults (raceResult: RaceResult): void {
    this.errors = new Map([...this.errors, ...raceResult.errors])
    this.remainingRelays = this.remainingRelays.map(relays =>
      relays
        .filter(eventInfo => eventInfo.relayUrl !== raceResult.winner?.relayInfo.relayUrl)
        .filter(eventInfo => !Array.from(raceResult.errors.keys()).includes(eventInfo.relayUrl))
    )
  }
}
