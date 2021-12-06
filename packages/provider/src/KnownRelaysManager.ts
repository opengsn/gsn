import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayFailureInfo } from '@opengsn/common/dist/types/RelayFailureInfo'
import { Address, AsyncScoreCalculator, RelayFilter } from '@opengsn/common/dist/types/Aliases'
import { GSNConfig } from './GSNConfigurator'

import {
  RelayInfoUrl,
  RelayRegisteredEventInfo,
  isInfoFromEvent
} from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { isSameAddress } from '@opengsn/common'

export const EmptyFilter: RelayFilter = (): boolean => {
  return true
}
/**
 * Basic score is reversed transaction fee, higher is better.
 * Relays that failed to respond recently will be downgraded for some period of time.
 */
export const DefaultRelayScore = async function (relay: RelayRegisteredEventInfo, txDetails: GsnTransactionDetails, failures: RelayFailureInfo[]): Promise<number> {
  const gasLimit = parseInt(txDetails.gas ?? '0')
  const maxPriorityFeePerGas = parseInt(txDetails.maxPriorityFeePerGas ?? '0')
  const pctFee = parseInt(relay.pctRelayFee)
  const baseFee = parseInt(relay.baseRelayFee)
  const transactionCost = baseFee + (gasLimit * maxPriorityFeePerGas * (100 + pctFee)) / 100
  let score = Math.max(Number.MAX_SAFE_INTEGER - transactionCost, 0)
  score = score * Math.pow(0.9, failures.length)
  return score
}

export class KnownRelaysManager {
  private readonly contractInteractor: ContractInteractor
  private readonly logger: LoggerInterface
  private readonly config: GSNConfig
  private readonly relayFilter: RelayFilter
  private readonly scoreCalculator: AsyncScoreCalculator

  private latestScannedBlock: number = 0
  private relayFailures = new Map<string, RelayFailureInfo[]>()

  public preferredRelayers: RelayInfoUrl[] = []
  public allRelayers: RelayRegisteredEventInfo[] = []

  constructor (contractInteractor: ContractInteractor, logger: LoggerInterface, config: GSNConfig, relayFilter?: RelayFilter, scoreCalculator?: AsyncScoreCalculator) {
    this.config = config
    this.logger = logger
    this.relayFilter = relayFilter ?? EmptyFilter
    this.scoreCalculator = scoreCalculator ?? DefaultRelayScore
    this.contractInteractor = contractInteractor
  }

  async refresh (): Promise<void> {
    this._refreshFailures()
    this.preferredRelayers = this.config.preferredRelays.map(relayUrl => {
      return { relayUrl }
    })
    this.allRelayers = await this.getRelayInfoForManagers()
  }

  getRelayInfoForManager (address: string): RelayRegisteredEventInfo|undefined {
    return this.allRelayers.find(info => isSameAddress(info.relayManager, address))
  }

  async getRelayInfoForManagers (): Promise<RelayRegisteredEventInfo[]> {
    const toBlock = await this.contractInteractor.getBlockNumber()
    const fromBlock = Math.max(0, toBlock - this.config.relayLookupWindowBlocks)

    const relayInfos = await this.contractInteractor.getRegisteredRelays(undefined, fromBlock)

    this.logger.info(`fetchRelaysAdded: found ${relayInfos.length} relays`)

    this.latestScannedBlock = toBlock
    return relayInfos.filter(this.relayFilter)
  }

  _refreshFailures (): void {
    const newMap = new Map<string, RelayFailureInfo[]>()
    this.relayFailures.forEach((value: RelayFailureInfo[], key: string) => {
      newMap.set(key, value.filter(failure => {
        const elapsed = (new Date().getTime() - failure.lastErrorTime) / 1000
        return elapsed < this.config.relayTimeoutGrace
      }))
    })
    this.relayFailures = newMap
  }

  async getRelaysSortedForTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayInfoUrl[][]> {
    const sortedRelays: RelayInfoUrl[][] = []
    // preferred relays are copied as-is, unsorted (we don't have any info about them anyway to sort)
    sortedRelays[0] = Array.from(this.preferredRelayers)
    sortedRelays[1] = await this._sortRelaysInternal(gsnTransactionDetails, this.allRelayers)
    return sortedRelays
  }

  getAuditors (excludeUrls: string[]): string[] {
    const indexes: number[] = []
    const auditors: string[] = []
    const flatRelayers =
      [...this.preferredRelayers, ...this.allRelayers]
        .map(it => it.relayUrl)
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

  async _sortRelaysInternal (gsnTransactionDetails: GsnTransactionDetails, activeRelays: RelayInfoUrl[]): Promise<RelayInfoUrl[]> {
    const scores = new Map<string, number>()
    for (const activeRelay of activeRelays) {
      let score = 0
      if (isInfoFromEvent(activeRelay)) {
        const eventInfo = activeRelay as RelayRegisteredEventInfo
        score = await this.scoreCalculator(eventInfo, gsnTransactionDetails, this.relayFailures.get(activeRelay.relayUrl) ?? [])
        scores.set(eventInfo.relayManager, score)
      }
    }
    return Array
      .from(activeRelays.values())
      .filter(isInfoFromEvent)
      .map(value => (value as RelayRegisteredEventInfo))
      .sort((a, b) => {
        const aScore = scores.get(a.relayManager) ?? 0
        const bScore = scores.get(b.relayManager) ?? 0
        return bScore - aScore
      })
  }

  saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void {
    const relayFailures = this.relayFailures.get(relayUrl)
    const newFailureInfo = {
      lastErrorTime,
      relayManager,
      relayUrl
    }
    if (relayFailures == null) {
      this.relayFailures.set(relayUrl, [newFailureInfo])
    } else {
      relayFailures.push(newFailureInfo)
    }
  }
}
