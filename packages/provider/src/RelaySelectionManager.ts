import { replaceErrors } from '@opengsn/common/dist/ErrorReplacerJSON'
import {
  Address,
  GSNConfig,
  GsnTransactionDetails,
  HttpClient,
  LoggerInterface,
  PartialRelayInfo,
  PingFilter,
  RelayInfo,
  RelayInfoUrl,
  RelaySelectionResult,
  WaitForSuccessResults,
  adjustRelayRequestForPingResponse,
  isInfoFromEvent,
  isSameAddress,
  pickRandomElementFromArray,
  waitForSuccess
} from '@opengsn/common'

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
  public priceErrors: Map<string, Error> = new Map<string, Error>()

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
  async selectNextRelay (relayHub: Address, paymaster?: Address): Promise<RelaySelectionResult | undefined> {
    while (true) {
      const slice = this._getNextSlice()
      let relayInfo: RelaySelectionResult | undefined
      if (slice.length > 0) {
        relayInfo = await this._nextRelayInternal(slice, relayHub, paymaster)
        if (relayInfo == null) {
          continue
        }
      }
      return relayInfo
    }
  }

  async _nextRelayInternal (
    relays: RelayInfoUrl[],
    relayHub: Address,
    paymaster?: Address): Promise<RelaySelectionResult | undefined> {
    this.logger.info('nextRelay: find fastest relay from: ' + JSON.stringify(relays))
    const allPingResults = await this._waitForSuccess(relays, relayHub, paymaster)
    this.logger.info(`race finished with a result: ${JSON.stringify(allPingResults, replaceErrors)}`)
    const { winner, skippedRelays } = this.selectWinnerFromResult(allPingResults)
    this._handleWaitForSuccessResults(allPingResults, skippedRelays, winner?.relayInfo)
    if (winner == null) {
      return
    }
    if (isInfoFromEvent(winner.relayInfo.relayInfo)) {
      return {
        relayInfo: (winner.relayInfo as RelayInfo),
        updatedGasFees: winner.updatedGasFees,
        maxDeltaPercent: winner.maxDeltaPercent
      }
    } else {
      const managerAddress = winner.relayInfo.pingResponse.relayManagerAddress
      this.logger.debug(`finding relay register info for manager address: ${managerAddress}; known info: ${JSON.stringify(winner.relayInfo)}`)
      const event = await this.knownRelaysManager.getRelayInfoForManager(managerAddress)
      if (event == null) {
        this.logger.error('Could not find registration info in the RelayRegistrar for the selected preferred relay')
        return undefined
      }
      // as preferred relay URL is not guaranteed to match the advertised one for the same manager, preserve URL
      const relayInfo = { ...event }
      relayInfo.relayUrl = winner.relayInfo.relayInfo.relayUrl
      return {
        relayInfo: {
          pingResponse: winner.relayInfo.pingResponse,
          relayInfo
        },
        updatedGasFees: winner.updatedGasFees,
        maxDeltaPercent: winner.maxDeltaPercent
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
    // go through a Map to remove duplicates
    const asMap = new Map<string, RelayInfoUrl>()
    relays.forEach(it => {
      asMap.set(it.relayUrl, it)
    })
    const asArray = Array.from(asMap.values())
    if (asArray.length !== relays.length) {
      this.logger.info(`waitForSuccess: Removed ${relays.length - asArray.length} duplicate Relay Server URLs from `)
    }
    const promises = asArray.map(async (relay: RelayInfoUrl) => {
      return await this._getRelayAddressPing(relay, relayHub, paymaster)
    })
    const errorKeys = asArray.map(it => { return it.relayUrl })
    return await waitForSuccess(promises, errorKeys, this.config.waitForSuccessPingGrace)
  }

  _handleWaitForSuccessResults (
    raceResult: WaitForSuccessResults<PartialRelayInfo>,
    skippedRelays: string[],
    winner?: PartialRelayInfo
  ): void {
    if (!this.isInitialized) { throw new Error('init() not called') }
    this.errors = new Map([...this.errors, ...raceResult.errors])
    const totalRemainingRelaysBefore = this.remainingRelays
      .map((relays) => {
        return relays.length
      })
      .reduce((a, b) => { return a + b }, 0)

    function notWinner (eventInfo: RelayInfoUrl): boolean {
      if (winner == null) {
        return true
      }
      const eventUrl = new URL(eventInfo.relayUrl).toString()
      const winnerUrl = new URL(winner.relayInfo.relayUrl).toString()
      return eventUrl !== winnerUrl
    }

    function notError (eventInfo: RelayInfoUrl): boolean {
      const urls = Array.from(raceResult.errors.keys()).map(it => new URL(it).toString())
      return !urls.includes(new URL(eventInfo.relayUrl).toString())
    }

    function notSkipped (eventInfo: RelayInfoUrl): boolean {
      // remove relays skipped (due to gas fees being wrong)
      return !skippedRelays
        .map(it => new URL(it).toString())
        .includes(new URL(eventInfo.relayUrl).toString())
    }

    this.remainingRelays = this.remainingRelays.map(relays =>
      relays
        .filter(notWinner)
        .filter(notError)
        .filter(notSkipped)
    )
    const totalRemainingRelaysAfter = this.remainingRelays
      .map((relays) => {
        return relays.length
      })
      .reduce((a, b) => { return a + b }, 0)
    const touched = raceResult.errors.size + (winner != null ? 1 : raceResult.results.length)
    this.logger.debug(`_handleWaitForSuccessResults info ${totalRemainingRelaysBefore} ${totalRemainingRelaysAfter} ${touched}`)
  }

  selectWinnerFromResult (
    allPingResults: WaitForSuccessResults<PartialRelayInfo>
  ): { winner?: RelaySelectionResult, skippedRelays: string[] } {
    if (allPingResults.results.length === 0) {
      return { skippedRelays: [] }
    }
    const winner = this.selectWinnerWithoutAdjustingFees(allPingResults)
    if (winner != null) {
      return { winner, skippedRelays: [] }
    }
    this.logger.debug('No relay with suitable gas fees found in current slice. Adjusting request...')
    return this.selectWinnerByAdjustingFees(allPingResults)
  }

  /**
   * Pick a random relay among those that satisfy the original client gas fees parameters.
   */
  selectWinnerWithoutAdjustingFees (
    allPingResults: WaitForSuccessResults<PartialRelayInfo>
  ): RelaySelectionResult | undefined {
    const relaysWithSatisfyingFees =
      allPingResults.results.filter(it => {
        return parseInt(it.pingResponse.maxMaxFeePerGas) >= parseInt(this.gsnTransactionDetails.maxFeePerGas) &&
          parseInt(it.pingResponse.minMaxFeePerGas) <= parseInt(this.gsnTransactionDetails.maxFeePerGas) &&
          parseInt(it.pingResponse.minMaxPriorityFeePerGas) <= parseInt(this.gsnTransactionDetails.maxPriorityFeePerGas)
      })

    this.logger.debug(`selectWinnerWithoutAdjustingFees: allPingResults length: (${allPingResults.results.length}) relaysWithSatisfyingFees length: (${relaysWithSatisfyingFees.length})`)

    if (relaysWithSatisfyingFees.length === 0) {
      return
    }
    return {
      relayInfo: pickRandomElementFromArray(relaysWithSatisfyingFees),
      updatedGasFees: this.gsnTransactionDetails,
      maxDeltaPercent: 0
    }
  }

  /**
   * Here we attempt to save the Relay Request attempt and avoid raising an exception in the client code.
   * As these Relay Servers did not agree to our suggested gas fees, we cannot rely on Random to pick a winner.
   * Pick Relay Servers deterministically with the closest gas fees instead.
   */
  selectWinnerByAdjustingFees (
    allPingResults: WaitForSuccessResults<PartialRelayInfo>
  ): { winner?: RelaySelectionResult, skippedRelays: string[] } {
    const skippedRelays: string[] = []
    const adjustedArray = allPingResults.results
      .map(it => {
        return adjustRelayRequestForPingResponse(this.gsnTransactionDetails, it, this.logger)
      })
      .filter(it => {
        const isGasPriceWithinSlack = it.maxDeltaPercent <= this.config.gasPriceSlackPercent
        if (!isGasPriceWithinSlack) {
          const skippedRelayUrl = it.relayInfo.relayInfo.relayUrl
          const tx = {
            maxFeePerGas: parseInt(this.gsnTransactionDetails.maxFeePerGas),
            maxPriorityFeePerGas: parseInt(this.gsnTransactionDetails.maxPriorityFeePerGas)
          }
          const ping = {
            minMaxFeePerGas: it.relayInfo.pingResponse.minMaxFeePerGas,
            maxMaxFeePerGas: it.relayInfo.pingResponse.minMaxPriorityFeePerGas
          }
          this.logger.debug(`
Skipping relay (${skippedRelayUrl}) due to gas fees being higher than allowed by ${it.maxDeltaPercent}%.
There are many reasons a Relay Server may want a higher price. See our FAQ page: https://docs.opengsn.org/faq/troubleshooting.html
TLDR: you can set 'gasPriceSlackPercent' to ${it.maxDeltaPercent} or more to make this relay acceptable for now.
Value currently configured is: ${this.config.gasPriceSlackPercent}%
TX=${JSON.stringify(tx)}
PING=${JSON.stringify(ping)}
`
          )
          this.priceErrors.set(skippedRelayUrl, new Error(`Skipped relay TX=${JSON.stringify(tx)} PING=${JSON.stringify(ping)} maxDeltaPercent=${it.maxDeltaPercent} gasPriceSlackPercent=${this.config.gasPriceSlackPercent}}`))
          skippedRelays.push(skippedRelayUrl)
        }
        return isGasPriceWithinSlack
      })
      .sort((a, b) => {
        return a.maxDeltaPercent - b.maxDeltaPercent
      })
    const winner = adjustedArray[0]
    if (winner != null) {
      this.logger.debug(`Adjusting RelayRequest to use Relay Server (${winner.relayInfo.relayInfo.relayUrl}) with fees ${JSON.stringify(winner.updatedGasFees)}`)
    }
    return {
      winner,
      skippedRelays
    }
  }
}
