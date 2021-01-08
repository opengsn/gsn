import { addresses2topics } from '../common/Utils'

import GsnTransactionDetails from '../common/types/GsnTransactionDetails'
import RelayFailureInfo from '../common/types/RelayFailureInfo'
import { Address, AsyncScoreCalculator, RelayFilter } from '../common/types/Aliases'
import { GSNConfig } from './GSNConfigurator'

import {
  HubUnauthorized,
  RelayInfoUrl,
  RelayRegisteredEventInfo,
  RelayServerRegistered,
  StakePenalized,
  StakeUnlocked,
  isInfoFromEvent
} from '../common/types/GSNContractsDataTypes'
import { LoggerInterface } from '../common/LoggerInterface'
import { EventData } from 'web3-eth-contract'
import ContractInteractor from '../common/ContractInteractor'

export const EmptyFilter: RelayFilter = (): boolean => {
  return true
}
/**
 * Basic score is reversed transaction fee, higher is better.
 * Relays that failed to respond recently will be downgraded for some period of time.
 */
export const DefaultRelayScore = async function (relay: RelayRegisteredEventInfo, txDetails: GsnTransactionDetails, failures: RelayFailureInfo[]): Promise<number> {
  const gasLimit = parseInt(txDetails.gas ?? '0')
  const gasPrice = parseInt(txDetails.gasPrice ?? '0')
  const pctFee = parseInt(relay.pctRelayFee)
  const baseFee = parseInt(relay.baseRelayFee)
  const transactionCost = baseFee + (gasLimit * gasPrice * (100 + pctFee)) / 100
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

  public relayLookupWindowParts: number
  public preferredRelayers: RelayInfoUrl[] = []
  public allRelayers: RelayInfoUrl[] = []

  constructor (contractInteractor: ContractInteractor, logger: LoggerInterface, config: GSNConfig, relayFilter?: RelayFilter, scoreCalculator?: AsyncScoreCalculator) {
    this.config = config
    this.logger = logger
    this.relayFilter = relayFilter ?? EmptyFilter
    this.scoreCalculator = scoreCalculator ?? DefaultRelayScore
    this.contractInteractor = contractInteractor
    this.relayLookupWindowParts = this.config.relayLookupWindowParts
  }

  async refresh (): Promise<void> {
    this._refreshFailures()
    const recentlyActiveRelayManagers = await this._fetchRecentlyActiveRelayManagers()
    this.preferredRelayers = this.config.preferredRelays.map(relayUrl => { return { relayUrl } })
    this.allRelayers = await this.getRelayInfoForManagers(recentlyActiveRelayManagers)
  }

  async getRelayInfoForManagers (relayManagers: Set<Address>): Promise<RelayRegisteredEventInfo[]> {
    // As 'topics' are used as 'filter', having an empty set results in querying all register events.
    if (relayManagers.size === 0) {
      return []
    }
    const topics = addresses2topics(Array.from(relayManagers))
    const relayServerRegisteredEvents = await this.contractInteractor.getPastEventsForHub(topics, { fromBlock: 1 }, [RelayServerRegistered])
    const relayManagerExitEvents = await this.contractInteractor.getPastEventsForStakeManager([StakeUnlocked, HubUnauthorized, StakePenalized], topics, { fromBlock: 1 })

    this.logger.info(`== fetchRelaysAdded: found ${relayServerRegisteredEvents.length} unique RelayAdded events`)

    const mergedEvents = [...relayManagerExitEvents, ...relayServerRegisteredEvents].sort((a, b) => {
      const blockNumberA = a.blockNumber
      const blockNumberB = b.blockNumber
      const transactionIndexA = a.transactionIndex
      const transactionIndexB = b.transactionIndex
      if (blockNumberA === blockNumberB) {
        return transactionIndexA - transactionIndexB
      }
      return blockNumberA - blockNumberB
    })
    const activeRelays = new Map<Address, RelayRegisteredEventInfo>()
    mergedEvents.forEach(event => {
      const args = event.returnValues
      if (event.event === RelayServerRegistered) {
        activeRelays.set(args.relayManager, args as RelayRegisteredEventInfo)
      } else {
        activeRelays.delete(args.relayManager)
      }
    })
    const origRelays = Array.from(activeRelays.values())
    return origRelays.filter(this.relayFilter)
  }

  splitRange (fromBlock: number, toBlock: number, splits: number): Array<{ fromBlock: number, toBlock: number }> {
    const totalBlocks = toBlock - fromBlock + 1
    const splitSize = Math.ceil(totalBlocks / splits)

    const ret: Array<{ fromBlock: number, toBlock: number }> = []
    let b
    for (b = fromBlock; b < toBlock; b += splitSize) {
      ret.push({ fromBlock: b, toBlock: Math.min(toBlock, b + splitSize - 1) })
    }
    return ret
  }

  // return events from hub. split requested range into "window parts", to avoid
  // fetching too many events at once.
  async getPastEventsForHub (fromBlock: number, toBlock: number): Promise<EventData[]> {
    let relayEventParts: any[]
    while (true) {
      const rangeParts = this.splitRange(fromBlock, toBlock, this.relayLookupWindowParts)
      try {
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        const getPastEventsPromises = rangeParts.map(({ fromBlock, toBlock }): Promise<any> =>
          this.contractInteractor.getPastEventsForHub([], {
            fromBlock,
            toBlock
          }))
        relayEventParts = await Promise.all(getPastEventsPromises)
        break
      } catch (e) {
        if (e.toString().match(/query returned more than/) != null &&
          this.config.relayLookupWindowBlocks > this.relayLookupWindowParts
        ) {
          if (this.relayLookupWindowParts >= 16) {
            throw new Error(`Too many events after splitting by ${this.relayLookupWindowParts}`)
          }
          this.relayLookupWindowParts *= 4
        } else {
          throw e
        }
      }
    }
    return relayEventParts.flat()
  }

  async _fetchRecentlyActiveRelayManagers (): Promise<Set<Address>> {
    const toBlock = await this.contractInteractor.getBlockNumber()
    const fromBlock = Math.max(0, toBlock - this.config.relayLookupWindowBlocks)

    const relayEvents: any[] = await this.getPastEventsForHub(fromBlock, toBlock)

    this.logger.info(`fetchRelaysAdded: found ${relayEvents.length} events`)
    const foundRelayManagers: Set<Address> = new Set()
    relayEvents.forEach((event: any) => {
      // TODO: remove relay managers who are not staked
      // if (event.event === 'RelayRemoved') {
      //   foundRelays.delete(event.returnValues.relay)
      // } else {
      foundRelayManagers.add(event.returnValues.relayManager)
    })

    this.logger.info(`fetchRelaysAdded: found unique relays: ${JSON.stringify(Array.from(foundRelayManagers.values()))}`)
    this.latestScannedBlock = toBlock
    return foundRelayManagers
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
