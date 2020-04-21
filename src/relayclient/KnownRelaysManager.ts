import RelayRegisteredEventInfo from './types/RelayRegisteredEventInfo'
import { Address, AsyncScoreCalculator, RelayFilter } from './types/Aliases'
import RelayFailureInfo from './types/RelayFailureInfo'
import ContractInteractor, {
  HubUnauthorized,
  RelayServerRegistered,
  StakePenalized,
  StakeUnlocked
} from './ContractInteractor'
import { GSNConfig } from './GSNConfigurator'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import HttpClient from './HttpClient'

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
  return Promise.resolve(score)
}

const activeManagerEvents = ['RelayServerRegistered', 'TransactionRelayed', 'CanRelayFailed', 'RelayWorkersAdded']

export interface IKnownRelaysManager {
  refresh (): Promise<void>

  saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void

  getRelaysSortedForTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayRegisteredEventInfo[][]>
}

export default class KnownRelaysManager implements IKnownRelaysManager {
  private readonly contractInteractor: ContractInteractor
  private readonly config: GSNConfig
  private readonly relayFilter: RelayFilter
  private readonly scoreCalculator: AsyncScoreCalculator
  private readonly httpClient: HttpClient

  private latestScannedBlock: number = 0
  private relayFailures = new Map<string, RelayFailureInfo[]>()

  public readonly knownRelays: RelayRegisteredEventInfo[][] = []

  constructor (contractInteractor: ContractInteractor, httpClient: HttpClient, config: GSNConfig, relayFilter?: RelayFilter, scoreCalculator?: AsyncScoreCalculator) {
    this.config = config
    this.httpClient = httpClient
    this.relayFilter = relayFilter ?? EmptyFilter
    this.scoreCalculator = scoreCalculator ?? DefaultRelayScore
    this.contractInteractor = contractInteractor
  }

  /**
   * Pings all preferred arrays to discover their manager, fee information.
   * Then, iterates through all relevant logs emitted by GSN contracts.
   * These two lists form a two-dimensional array of {@link knownRelays}
   * Note: duplicates across 'levels' will be cleared by {@link RelaySelectionManager._handleRaceResults}
   */
  async refresh (): Promise<void> {
    this._refreshFailures()
    const preferredRelayManagers = await this._fetchPreferredRelayManagers()
    const recentlyActiveRelayManagers = await this._fetchRecentlyActiveRelayManagers()
    this.knownRelays[0] = await this._getRelayInfoForManagers(preferredRelayManagers)
    this.knownRelays[1] = await this._getRelayInfoForManagers(recentlyActiveRelayManagers)
  }

  async _getRelayInfoForManagers (relayManagers: Set<Address>): Promise<RelayRegisteredEventInfo[]> {
    // As 'topics' are used as 'filter', having an empty set results in querying all register events.
    if (relayManagers.size === 0) {
      return []
    }
    const topics = this.contractInteractor.topicsForManagers(Array.from(relayManagers))
    const relayServerRegisteredEvents = await this.contractInteractor.getPastEventsForHub([RelayServerRegistered], topics, { fromBlock: 1 })
    const relayManagerExitEvents = await this.contractInteractor.getPastEventsForStakeManager([StakeUnlocked, HubUnauthorized, StakePenalized], topics, { fromBlock: 1 })

    if (this.config.verbose) {
      console.log(`== fetchRelaysAdded: found ${relayServerRegisteredEvents.length} unique RelayAdded events (should have at least as unique relays, above)`)
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
        const relay = {
          relayManager: args.relayManager,
          relayUrl: args.url,
          baseRelayFee: args.baseRelayFee,
          pctRelayFee: args.pctRelayFee
        }
        activeRelays.set(args.relayManager, relay)
      } else {
        activeRelays.delete(args.relayManager)
      }
    })
    const origRelays = Array.from(activeRelays.values())
    return origRelays.filter(this.relayFilter)
  }

  async _fetchPreferredRelayManagers (): Promise<Set<Address>> {
    const managerAddresses = new Set<Address>()
    for (const relayUrl of this.config.preferredRelays) {
      try {
        const pingInfo = await this.httpClient.getPingResponse(relayUrl)
        managerAddresses.add(pingInfo.RelayServerAddress) // TODO!!!: manager address!
      } catch (e) {
        console.log(`Failed to ping preconfigured relay URL ${relayUrl}`, e.message)
      }
    }
    return managerAddresses
  }

  async _fetchRecentlyActiveRelayManagers (): Promise<Set<Address>> {
    const toBlock = await this.contractInteractor.getBlockNumber()
    const fromBlock = Math.max(0, toBlock - this.config.relayLookupWindowBlocks)

    const relayEvents: any[] = await this.contractInteractor.getPastEventsForHub(activeManagerEvents, [], {
      fromBlock,
      toBlock
    })

    if (this.config.verbose) {
      console.log('fetchRelaysAdded: found ', `${relayEvents.length} events`)
    }
    const foundRelayManagers: Set<Address> = new Set()
    relayEvents.forEach((event: any) => {
      // TODO: remove relay managers who are not staked
      // if (event.event === 'RelayRemoved') {
      //   foundRelays.delete(event.returnValues.relay)
      // } else {
      foundRelayManagers.add(event.returnValues.relayManager)
    })

    if (this.config.verbose) {
      console.log('fetchRelaysAdded: found', Object.keys(foundRelayManagers).length, 'unique relays')
    }
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

  async getRelaysSortedForTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayRegisteredEventInfo[][]> {
    const sortedRelays: RelayRegisteredEventInfo[][] = []
    for (let i = 0; i < this.knownRelays.length; i++) {
      sortedRelays[i] = await this._sortRelaysInternal(gsnTransactionDetails, this.knownRelays[i])
    }
    return sortedRelays
  }

  async _sortRelaysInternal (gsnTransactionDetails: GsnTransactionDetails, activeRelays: RelayRegisteredEventInfo[]): Promise<RelayRegisteredEventInfo[]> {
    const scores = new Map<string, number>()
    for (const activeRelay of activeRelays) {
      const score = await this.scoreCalculator(activeRelay, gsnTransactionDetails, this.relayFailures.get(activeRelay.relayUrl) ?? [])
      scores.set(activeRelay.relayUrl, score)
    }
    return Array.from(activeRelays.values()).sort((a, b) => {
      const aScore = scores.get(a.relayUrl) ?? 0
      const bScore = scores.get(b.relayUrl) ?? 0
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
