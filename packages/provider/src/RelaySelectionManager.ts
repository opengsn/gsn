import { replaceErrors } from '@opengsn/common/dist/ErrorReplacerJSON'
import {
  Address,
  GsnTransactionDetails,
  HttpClient,
  LoggerInterface,
  PartialRelayInfo,
  PingFilter,
  RelayInfo,
  RelayInfoUrl,
  WaitForSuccessResults,
  isInfoFromEvent,
  isSameAddress,
  waitForSuccess
} from '@opengsn/common'

import { GSNConfig } from './GSNConfigurator'
import { KnownRelaysManager } from './KnownRelaysManager'

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
    const raceResult = await this._waitForSuccess(relays, relayHub, paymaster)
    this.logger.info(`race finished with a result: ${JSON.stringify(raceResult, replaceErrors)}`)
    this._handleWaitForSuccessResults(raceResult)
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
    this.remainingRelays = await this.knownRelaysManager.getRelaysShuffledForTransaction()
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
      const bulkSize = Math.min(this.config.waitForSuccessSliceSize, relays.length)
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
    this.pingFilter(pingResponse, this.gsnTransactionDetails)
    return {
      pingResponse,
      relayInfo
    }
  }

  async _waitForSuccess (relays: RelayInfoUrl[], relayHub: Address, paymaster?: Address): Promise<WaitForSuccessResults<PartialRelayInfo>> {
    const promises = relays.map(async (relay: RelayInfoUrl) => {
      return await this._getRelayAddressPing(relay, relayHub, paymaster)
    })
    const errorKeys = relays.map(it => { return it.relayUrl })
    return await waitForSuccess(promises, errorKeys, this.config.waitForSuccessPingGrace)
  }

  _handleWaitForSuccessResults (raceResult: WaitForSuccessResults<PartialRelayInfo>): void {
    if (!this.isInitialized) { throw new Error('init() not called') }
    this.errors = new Map([...this.errors, ...raceResult.errors])
    this.remainingRelays = this.remainingRelays.map(relays =>
      relays
        .filter(eventInfo => eventInfo.relayUrl !== raceResult.winner?.relayInfo.relayUrl)
        .filter(eventInfo => !Array.from(raceResult.errors.keys()).includes(eventInfo.relayUrl))
    )
  }
}
