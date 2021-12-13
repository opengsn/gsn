import { addresses2topics } from '@opengsn/common/dist/Utils'

import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayFailureInfo } from '@opengsn/common/dist/types/RelayFailureInfo'
import { Address, AsyncScoreCalculator, RelayFilter } from '@opengsn/common/dist/types/Aliases'
import { GSNConfig } from './GSNConfigurator'

import {
  HubUnauthorized,
  RelayInfoUrl,
  RelayRegisteredEventInfo,
  RelayServerRegistered,
  StakePenalized,
  StakeUnlocked,
  isInfoFromEvent
} from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { MAX_INTEGER } from 'ethereumjs-util'
import { toBN } from 'web3-utils'
import BN from 'bn.js'

export const DefaultRelayFilter: RelayFilter = function (registeredEventInfo: RelayRegisteredEventInfo): boolean {
  const maxPctRelayFee = 100
  const maxBaseRelayFee = 1e17
  if (
    parseInt(registeredEventInfo.pctRelayFee) > maxPctRelayFee ||
    parseInt(registeredEventInfo.baseRelayFee) > maxBaseRelayFee
  ) {
    return false
  }
  return true
}
/**
 * Basic score is reversed transaction fee, higher is better.
 * Relays that failed to respond recently will be downgraded for some period of time.
 */
export const DefaultRelayScore: AsyncScoreCalculator = async function (relay: RelayRegisteredEventInfo, txDetails: GsnTransactionDetails, failures: RelayFailureInfo[]): Promise<BN> {
  const gasLimit = toBN(txDetails.gas ?? '0')
  const gasPrice = toBN(txDetails.gasPrice ?? '0')
  const pctFee = toBN(relay.pctRelayFee)
  const baseFee = toBN(relay.baseRelayFee)
  const transactionCost = baseFee.add(gasLimit.mul(gasPrice).muln((100 + pctFee.toNumber()) / 100)
  )
  let score = MAX_INTEGER.sub(transactionCost)
  score = score.muln(Math.pow(0.9, failures.length))
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
  public allRelayers: RelayInfoUrl[] = []

  constructor (contractInteractor: ContractInteractor, logger: LoggerInterface, config: GSNConfig, relayFilter?: RelayFilter, scoreCalculator?: AsyncScoreCalculator) {
    this.config = config
    this.logger = logger
    this.relayFilter = relayFilter ?? DefaultRelayFilter
    this.scoreCalculator = scoreCalculator ?? DefaultRelayScore
    this.contractInteractor = contractInteractor
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
    const toBlock = await this.contractInteractor.getBlockNumber()
    const fromBlock = Math.max(0, toBlock - this.config.relayRegistrationLookupBlocks)

    const topics = addresses2topics(Array.from(relayManagers))
    const relayServerRegisteredEvents = await this.contractInteractor.getPastEventsForHub(topics, { fromBlock }, [RelayServerRegistered])
    const relayManagerExitEvents = await this.contractInteractor.getPastEventsForStakeManager([StakeUnlocked, HubUnauthorized, StakePenalized], topics, { fromBlock })

    this.logger.info(`== getRelayInfoForManagers: found ${relayServerRegisteredEvents.length} unique RelayServerRegistered events`)
    if (relayServerRegisteredEvents.length === 0) {
      this.logger.error(`Did not find any RelayServerRegistered Event for any of ${relayManagers.size} relay managers! {fromBlock: ${fromBlock}, toBlock: ${toBlock}}`)
    }

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

  async _fetchRecentlyActiveRelayManagers (): Promise<Set<Address>> {
    const toBlock = await this.contractInteractor.getBlockNumber()
    const fromBlock = Math.max(0, toBlock - this.config.relayLookupWindowBlocks)

    const relayEvents: any[] = await this.contractInteractor.getPastEventsForHub([], {
      fromBlock,
      toBlock
    }, undefined)

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
    const scores = new Map<string, BN>()
    for (const activeRelay of activeRelays) {
      let score = toBN(0)
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
        const aScore = scores.get(a.relayManager) ?? toBN(0)
        const bScore = scores.get(b.relayManager) ?? toBN(0)
        return bScore.cmp(aScore)
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
