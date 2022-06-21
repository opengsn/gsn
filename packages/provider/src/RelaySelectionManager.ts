import BN from 'bn.js'
import { toBN } from 'web3-utils'

import { replaceErrors } from '@opengsn/common/dist/ErrorReplacerJSON'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { Address, PingFilter } from '@opengsn/common/dist/types/Aliases'

import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { GSNConfig } from './GSNConfigurator'
import { randomInRangeBN } from './KnownRelaysManager'
import { AsyncScoreCalculator, ContractInteractor, isSameAddress, PingResponse, RelayFilter } from '@opengsn/common'
import { RelayInfo } from './RelayInfo'

/**
 * @param promises - all promises to run with a timeout
 * @param timeoutTime - how long to wait before timing out the promises
 * @param timeoutVal - the result for any promise that timed out
 */
const raceAll = function <T> (promises: Array<Promise<T>>, timeoutTime: number, timeoutVal: T): Promise<T[]> {
  return Promise.all(promises.map(p => {
    return Promise.race([p, delay(timeoutTime, timeoutVal)])
  }))
}

// info + url -> ping -> error
//
// url -> info -> ping -> error
//
// info + url -> error
//
// url -> error

export class RelaySelectionManager {
  transactionDetails?: GsnTransactionDetails
  // remember the last successful relay and try using it first before restarting the lookup
  currentChampion?: RelayInfo
  // once all relays have failed, we can increment this value to try some failed relays again
  maxFailureCount: number = 0
  // relays specified as 'preferred' in configuration
  preferredRelays!: RelayInfo[]

  // relays queried from the RelayRegistrar smart contract
  registrarRelays!: RelayInfo[]

  private isInitialized = false

  constructor (
    preferredRelays: string[],
    readonly contractInteractor: ContractInteractor,
    readonly scoreCalculator: AsyncScoreCalculator,
    readonly relayFilter: RelayFilter,
    readonly httpClient: HttpClient,
    readonly pingFilter: PingFilter,
    readonly logger: LoggerInterface,
    readonly config: GSNConfig) {
    this.preferredRelays = preferredRelays.map(it =>
      RelayInfo.fromUrl(it, this.httpClient, this.contractInteractor, this.scoreCalculator)
    )
  }

  /**
   * Ping those relays that were not pinged yet.
   * @returns the first relay to respond to a ping message. Note: will never return the same relay twice.
   */
  async selectNextRelay (relayHub: Address, paymaster?: Address): Promise<RelayInfo | undefined> {

    if (this.currentChampion != null) {
      //  TODO: refresh ping info
      const success = await this.currentChampion.ping(relayHub, paymaster)
      if (success) {
        return this.currentChampion
      }
    }

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

  // the idea is to ping multiple relays with some timeout, and pick the best one of those responding
  async _nextRelayInternal (relays: RelayInfo[], relayHub: Address, paymaster?: Address): Promise<RelayInfo | undefined> {
    this.logger.info('nextRelay: find fastest relay from: ' + JSON.stringify(relays))
    const pingMultipleResult = await this._pingMultipleRelays(relays, relayHub, paymaster)
    this.logger.info(`ping finished with a result: ${JSON.stringify(pingMultipleResult, replaceErrors)}`)
    const sortedByScore = pingMultipleResult
      // .map(this.getRegisteredRelayInfo)
      .filter(it => it != null)
      .map(it => it as RelayInfo)
      .sort((a, b) => a.score!.cmp(b.score!))
    return sortedByScore[0]
  }

  // getRegisteredRelayInfo ({ relayUrl, pingResponse }: Ping): RelayInfo | undefined {
  //   if (pingResponse == null) {
  //     throw new Error('NOOOOO')
  //   }
  //   const info = this.registrarRelays.find(info => isSameAddress(info.relayManager, pingResponse.relayManagerAddress))
  //
  //   if (info == null) {
  //     this.logger.error('Could not find registration info in the RelayRegistrar for the selected preferred relay')
  //     return undefined
  //   }
  //   // as preferred relay URL is not guaranteed to match the advertised one for the same manager, preserve URL
  //   // TODO: actually, if we ban this explicitly the code gets much simpler and we don't need it
  //   return Object.assign({}, info, { relayUrl })
  // }

  async init (): Promise<this> {
    const registrarRelays = await this.contractInteractor.getRegisteredRelaysFromRegistrar()
    this.registrarRelays = registrarRelays.map(
      it => { return RelayInfo.fromReg(it, this.httpClient, this.contractInteractor, this.scoreCalculator)})
    this.isInitialized = true
    return this
  }

  /**
   * Only the relay score and ping filtering are affected by the transaction details.
   * @param transactionDetails - new transaction details to calculate relay scores for.
   */
  async updateTransactionDetails (transactionDetails: GsnTransactionDetails) {
    this.transactionDetails = transactionDetails
    this.registrarRelays.forEach(it => {
      it.calculateScore(transactionDetails)
    })
  }

  // (note that some edge-cases (like duplicate urls) are not filtered out)
  registrarRelaysCount (): number {
    return this.registrarRelays.length
  }

  _getRelaysFilteredByFailureCount () {

  }

  _getNextSlice (): RelayInfo[] {
    if (!this.isInitialized) { throw new Error('init() not called') }
    const preferred = this
      .preferredRelays
      .filter(it => {
        return !it.hasFailed(this.config.maxPingFailuresCount, this.config.relayTimeoutGrace)
      })
      .slice(0, this.config.sliceSize)
    if (preferred.length !== 0) {
      return preferred
    }
    return this._pickRandomRelaysByWeightedScores(this.registrarRelays, this.config.sliceSize)
  }

  // Using weighted random selection algorithm to pick relays.
  // TODO: this should remove the selected relay
  _pickRandomRelaysByWeightedScores (relays: RelayInfo[], count: number): RelayInfo[] {
    const totalSum = relays[relays.length - 1].score?.subn(1)
    if (totalSum == null) {
      throw new Error('AsyncScoreCalculator did not assign the "score" field correctly')
    }

    let selection: RelayInfo[] = []
    for (let i = 0; i < count; i++) {
      const rand = randomInRangeBN(toBN(0), totalSum)
      const values = relays.map(it => it.score!)
      const index = upperBoundBN(values, rand)
      selection.push(relays[index])
    }
    return selection
  }

  /**
   * @returns JSON response from the relay server, but adds the requested URL to it :'-(
   */
  // async _getRelayAddressPing (relayUrl: string, relayHub: Address, paymaster?: Address): Promise<Ping> {
  //   if (this.transactionDetails == null) {
  //     throw new Error('Transaction Details not initialized')
  //   }
  //   this.logger.info(`getRelayAddressPing URL: ${relayUrl}`)
  //   const pingResponse = await this.httpClient.getPingResponse(relayUrl, paymaster)
  //
  //   if (!pingResponse.ready) {
  //     throw new Error(`Relay not ready ${JSON.stringify(pingResponse)}`)
  //   }
  //   if (!isSameAddress(relayHub, pingResponse.relayHubAddress)) {
  //     throw new Error(`Client is using RelayHub ${relayHub} while the server responded with RelayHub address ${pingResponse.relayHubAddress}`)
  //   }
  //   if (
  //     this.transactionDetails.maxPriorityFeePerGas != null &&
  //     parseInt(pingResponse.minMaxPriorityFeePerGas) > parseInt(this.transactionDetails.maxPriorityFeePerGas)
  //   ) {
  //     throw new Error(`Proposed priority gas fee: ${parseInt(this.transactionDetails.maxPriorityFeePerGas)}; relay's minMaxPriorityFeePerGas: ${pingResponse.minMaxPriorityFeePerGas}`)
  //   }
  //   this.pingFilter(pingResponse, this.transactionDetails)
  //   return {
  //     pingResponse,
  //     relayUrl
  //   }
  // }

  /**
   * Accepts an array of {@link RelayInfo} and tries refreshing a ping on all of them with a timeout.
   */
  async _pingMultipleRelays (relays: RelayInfo[], relayHub: Address, paymaster?: Address): Promise<RelayInfo[]> {
    const promises = relays.map(
      relayUrl => {
        return relayUrl.ping(relayHub, paymaster)
        // return this._getRelayAddressPing(relayUrl, relayHub, paymaster)
        //   .catch(error => {
        //     const ping: Ping = { relayUrl, error }
        //     return ping
        //   })
      }
    )

    // const results = await raceAll(promises, 0, null)
    // I don't need to time-out all pings together as each ping has its own timeout!
    const results = await Promise.all(promises)
    let responded = []
    for (let i = 0; i < promises.length; i++) {
      // const result =
      // if (result.error != null) {
      //   this.savePingFailure(relays[i], result?.error.toString() ?? 'TIMED OUT')
      // } else {
      if (results[i]) {
        responded.push(relays[i])
      }
      // }
    }
    return responded
  }

  async filterRelaysFromRegistrar () {
    const originalSize = this.registrarRelays.length
    this.logger.info(`filterRelaysFromRegistrar: had ${originalSize} relays`)

    this.registrarRelays = this.registrarRelays.filter((info: RelayInfo) => {
      const isHostBlacklisted = this.config.blacklistedRelays.find(relay => info.usedRelayUrl.toLowerCase().includes(relay.toLowerCase())) != null
      const isManagerBlacklisted = this.config.blacklistedRelays.find(relay => isSameAddress(info.registrarInfo!.relayManager, relay)) != null
      return !(isHostBlacklisted || isManagerBlacklisted)
    })
    this.registrarRelays = this.registrarRelays.filter(it => { return it.registrarInfo != null && this.relayFilter(it.registrarInfo)})
    if (this.registrarRelays.length !== originalSize) {
      this.logger.warn(`RelayFilter: removing ${originalSize - this.registrarRelays.length} relays from results`)
    }
  }

  getAuditors (excludeUrls: string[]): string[] {
    if (this.config.auditorsCount === 0) {
      this.logger.debug('skipping audit step as "auditorsCount" config parameter is set to 0')
      return []
    }
    const indexes: number[] = []
    const auditors: string[] = []
    const flatRelayers =
      this.registrarRelays
        .map(it => it.usedRelayUrl)
        .filter(it => !excludeUrls.includes(it))
        .filter((value, index, self) => {
          return self.indexOf(value) === index
        })
    if (flatRelayers.length <= this.config.auditorsCount) {
      if (flatRelayers.length < this.config.auditorsCount) {
        this.logger.warn(`Not enough auditors: request ${this.config.auditorsCount} but only have ${flatRelayers.length}`)
      }
      return flatRelayers
    }
    do {
      const index = Math.floor(Math.random() * flatRelayers.length)
      if (!indexes.includes(index)) {
        auditors.push(flatRelayers[index])
        indexes.push(index)
      }
    } while (auditors.length < this.config.auditorsCount)
    return auditors
  }

  /**
   * Relays that failed to respond to ping may be tried again for a next transaction.
   */
  // savePingFailure (relayUrl: Address, message: string) {
  //   // TODO: what do I do when a preferred relay fails?
  //   const relay = this.registrarRelays.find(it => isSameAddress(it.relayManager, relayManager))
  //   if (relay == null) {
  //     throw new Error('NOOOO')
  //   }
  //   relay.pingFailures?.push(message)
  // }

  /**
   * Relays that failed to send a transaction will not be retried.
   * The error messages are only kept for debugging.
   */
  // saveRelayFailure (relayManager: Address, message: string): void {
  //   // TODO: if failed is 'currentChampion', remove it
  //   const relay = this.registrarRelays.find(it => isSameAddress(it.relayManager, relayManager))
  //   if (relay == null) {
  //     throw new Error('NOOOO')
  //   }
  //   relay.relayFailures?.push(message)
  // }
}

function upperBoundBN (a: BN[], k: BN): number {
  let low = 0
  let high = a.length - 1

  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2)
    if (a[mid].lte(k)) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return low
}
