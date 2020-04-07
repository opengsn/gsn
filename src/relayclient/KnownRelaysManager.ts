import { event2topic } from '../common/utils'
import RelayRegisteredEventInfo from './types/RelayRegisteredEventInfo'
import { Address, RelayFilter } from './types/Aliases'
import { IRelayHubInstance } from '../../types/truffle-contracts'
import RelayFailureInfo from './types/RelayFailureInfo'
import ContractInteractor from './ContractInteractor'

const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 60 * 30

export interface KnownRelaysManagerConfig {
  verbose: boolean
  relayTimeoutGrace?: number
}

export function createEmptyFilter (): RelayFilter {
  return (): boolean => {
    return true
  }
}

export default class KnownRelaysManager {
  private readonly latestRelayFailures = new Map<string, RelayFailureInfo>()
  private readonly activeRelays = new Set<RelayRegisteredEventInfo>()
  private readonly contractInteractor: ContractInteractor
  private readonly config: KnownRelaysManagerConfig
  private readonly relayFilter: RelayFilter
  private readonly relayHubAddress: Address

  private latestScannedBlock: number = 0

  constructor (relayHubAddress: Address, contractInteractor: ContractInteractor, relayFilter: RelayFilter, config: KnownRelaysManagerConfig) {
    this.relayHubAddress = relayHubAddress
    this.config = config
    this.relayFilter = relayFilter
    this.contractInteractor = contractInteractor
  }

  compareRelayScores (r1: RelayRegisteredEventInfo, r2: RelayRegisteredEventInfo): number {
    // TODO: get score from cache mapping. do not put score into object, this data is external to RelayInfo
    return this.calculateRelayScore(r2) - this.calculateRelayScore(r1)
  }

  /**
   * Basic score is transaction fee(%), higher is better.
   * Relays that failed to respond recently will be downgraded for some period of time.
   */
  calculateRelayScore (relay: RelayRegisteredEventInfo): number {
    let score = 1000 - parseInt(relay.pctRelayFee)

    const latestRelayFailure = this.latestRelayFailures.get(relay.relayUrl)
    if (latestRelayFailure != null) {
      const elapsed = (new Date().getTime() - latestRelayFailure.lastErrorTime) / 1000
      // relay failed to answer lately and it's score will be downgraded
      const timeoutGrace = this.config.relayTimeoutGrace ?? DEFAULT_RELAY_TIMEOUT_GRACE_SEC
      if (elapsed < timeoutGrace) {
        score -= 10
      } else {
        this.latestRelayFailures.delete(relay.relayUrl)
      }
    }
    return score
  }

  /**
   * Iterates through all relevant logs emitted by GSN contracts
   * initializes an array {@link activeRelays}
   */
  async refresh (): Promise<void> {
    const relayHub = await this.contractInteractor._createRelayHub(this.relayHubAddress)
    const relayManagers = await this._fetchRecentlyActiveRelayManagers(relayHub)
    const relayServerRegisteredTopic = event2topic(relayHub, 'RelayServerRegistered')

    // found all addresses. 2nd round to get the RelayAdded event for each of those relays.
    // TODO: at least some of the found relays above was due to "RelayAdded" event,
    // we _could_ optimize for that, but since at least _some_ relays
    // were found by the TransactionRelayed event, we are forced to search them
    // for actual address.
    const relayServerRegisteredEvents: any[] = await relayHub.contract.getPastEvents('RelayServerRegistered', {
      fromBlock: 1,
      topics: [relayServerRegisteredTopic,
        Array.from(relayManagers,
          (address: Address) => `0x${address.replace(/^0x/, '').padStart(64, '0').toLowerCase()}`
        )]
    })

    if (this.config.verbose) {
      console.log(`== fetchRelaysAdded: found ${relayServerRegisteredEvents.length} unique RelayAdded events (should have at least as unique relays, above)`)
    }

    const activeRelays = new Map<Address, RelayRegisteredEventInfo>()
    relayServerRegisteredEvents.forEach(event => {
      const args = event.returnValues
      const relay = {
        relayManager: args.relayManager,
        relayUrl: args.url,
        baseRelayFee: args.baseRelayFee,
        pctRelayFee: args.pctRelayFee
      }
      // relay.score = this.calculateRelayScore(relay)
      activeRelays.set(args.relayManager, relay)
    })
    const origRelays = Object.values(activeRelays)
    const filteredRelays = origRelays.filter(this.relayFilter)
    filteredRelays.forEach(relay => this.activeRelays.add(relay))
  }

  async _fetchRecentlyActiveRelayManagers (relayHub: IRelayHubInstance): Promise<Set<Address>> {
    const fromBlock = this.latestScannedBlock
    const toBlock = await web3.eth.getBlockNumber()
    const eventTopics = event2topic(relayHub,
      ['RelayServerRegistered', 'TransactionRelayed', 'CanRelayFailed'])

    // @ts-ignore
    const relayEvents: any[] = await this.relayHub.contract.getPastEvents('allEvents', {
      fromBlock,
      toBlock,
      topics: [eventTopics]
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

  getRelaysSorted (): RelayRegisteredEventInfo[] {
    return Array.from(this.activeRelays.values()).sort(this.compareRelayScores.bind(this))
  }

  saveRelayFailure (relayFailureInfo: RelayFailureInfo): void {
    this.latestRelayFailures.set(relayFailureInfo.relayUrl, relayFailureInfo)
  }
}
