import { replaceErrors } from '@opengsn/common/dist/ErrorReplacerJSON'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { PartialRelayInfo, RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { Address, PingFilter } from '@opengsn/common/dist/types/Aliases'
import { isInfoFromEvent, RelayInfoUrl } from '@opengsn/common/dist/types/GSNContractsDataTypes'

import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { GSNConfig } from './GSNConfigurator'
import { KnownRelaysManager } from './KnownRelaysManager'
import { isSameAddress } from '@opengsn/common'

interface RaceResult {
  winner?: PartialRelayInfo
  errors: Map<string, Error>
}

export class RelaySelectionManager {
  private readonly knownRelaysManager: KnownRelaysManager
  private readonly httpClient: HttpClient
  private readonly config: GSNConfig
  private readonly logger: LoggerInterface
  private readonly pingFilter: PingFilter
  private readonly gsnTransactionDetails: GsnTransactionDetails

  private remainingRelays: RelayInfoUrl[][] = []
  private isInitialized = false

  public errors: Map<string, Error> = new Map<string, Error>()

  constructor (gsnTransactionDetails: GsnTransactionDetails, knownRelaysManager: KnownRelaysManager, httpClient: HttpClient, pingFilter: PingFilter, logger: LoggerInterface, config: GSNConfig) {
    this.gsnTransactionDetails = gsnTransactionDetails
    this.knownRelaysManager = knownRelaysManager
    this.httpClient = httpClient
    this.pingFilter = pingFilter
    this.config = config
    this.logger = logger
  }

  /**
   * Ping those relays that were not pinged yet, and remove both the returned relay or relays re from {@link remainingRelays}
   * @returns the first relay to respond to a ping message. Note: will never return the same relay twice.
   */
  async selectNextRelay (relayHub: Address, paymaster?: Address): Promise<RelayInfo | undefined> {
    while (true) {
      const slice = this._getNextSlice()
      let relayInfo: RelayInfo | undefined
      if (slice.length > 0) {
        relayInfo = await this._nextRelayInternal(slice, relayHub, paymaster)
        if (relayInfo == null) {
          continue
        }
      }
      return relayInfo
    }
  }

  async _nextRelayInternal (relays: RelayInfoUrl[], relayHub: Address, paymaster?: Address): Promise<RelayInfo | undefined> {
    this.logger.info('nextRelay: find fastest relay from: ' + JSON.stringify(relays))
    const raceResult = await this._raceToSuccess(relays, relayHub, paymaster)
    this.logger.info(`race finished with a result: ${JSON.stringify(raceResult, replaceErrors)}`)
    this._handleRaceResults(raceResult)
    if (raceResult.winner != null) {
      if (isInfoFromEvent(raceResult.winner.relayInfo)) {
        return (raceResult.winner as RelayInfo)
      } else {
        const managerAddress = raceResult.winner.pingResponse.relayManagerAddress
        this.logger.debug(`finding relay register info for manager address: ${managerAddress}; known info: ${JSON.stringify(raceResult.winner.relayInfo)}`)
        const event = await this.knownRelaysManager.getRelayInfoForManager(managerAddress)
        if (event != null) {
          // as preferred relay URL is not guaranteed to match the advertised one for the same manager, preserve URL
          const relayInfo = { ...event }
          relayInfo.relayUrl = raceResult.winner.relayInfo.relayUrl
          return {
            pingResponse: raceResult.winner.pingResponse,
            relayInfo
          }
        } else {
          this.logger.error('Could not find registration info in the RelayRegistrar for the selected preferred relay')
          return undefined
        }
      }
    }
  }

  async init (): Promise<this> {
    this.remainingRelays = await this.knownRelaysManager.getRelaysSortedForTransaction(this.gsnTransactionDetails)
    this.isInitialized = true
    return this
  }

  // relays left to try
  // (note that some edge-cases (like duplicate urls) are not filtered out)
  relaysLeft (): RelayInfoUrl[] {
    return this.remainingRelays.flatMap(list => list)
  }

  _getNextSlice (): RelayInfoUrl[] {
    if (!this.isInitialized) { throw new Error('init() not called') }
    for (const relays of this.remainingRelays) {
      const bulkSize = Math.min(this.config.sliceSize, relays.length)
      const slice = relays.slice(0, bulkSize)
      if (slice.length === 0) {
        continue
      }
      return slice
    }
    return []
  }

  /**
   * @returns JSON response from the relay server, but adds the requested URL to it :'-(
   */
  async _getRelayAddressPing (relayInfo: RelayInfoUrl, relayHub: Address, paymaster?: Address): Promise<PartialRelayInfo> {
    this.logger.info(`getRelayAddressPing URL: ${relayInfo.relayUrl}`)
    const pingResponse = await this.httpClient.getPingResponse(relayInfo.relayUrl, paymaster)

    if (!pingResponse.ready) {
      throw new Error(`Relay not ready ${JSON.stringify(pingResponse)}`)
    }
    if (!isSameAddress(relayHub, pingResponse.relayHubAddress)) {
      throw new Error(`Client is using RelayHub ${relayHub} while the server responded with RelayHub address ${pingResponse.relayHubAddress}`)
    }
    this.pingFilter(relayHub, pingResponse, this.gsnTransactionDetails)
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
  async _raceToSuccess (relays: RelayInfoUrl[], relayHub: Address, paymaster?: Address): Promise<RaceResult> {
    const errors: Map<string, Error> = new Map<string, Error>()
    return await new Promise((resolve) => {
      relays.forEach((relay: RelayInfoUrl) => {
        this._getRelayAddressPing(relay, relayHub, paymaster)
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
    if (!this.isInitialized) { throw new Error('init() not called') }
    this.errors = new Map([...this.errors, ...raceResult.errors])
    this.remainingRelays = this.remainingRelays.map(relays =>
      relays
        .filter(eventInfo => eventInfo.relayUrl !== raceResult.winner?.relayInfo.relayUrl)
        .filter(eventInfo => !Array.from(raceResult.errors.keys()).includes(eventInfo.relayUrl))
    )
  }
}
