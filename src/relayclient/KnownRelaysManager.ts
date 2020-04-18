import { event2topic } from '../common/utils'
import RelayRegisteredEventInfo from './types/RelayRegisteredEventInfo'
import { Address, RelayFilter } from './types/Aliases'
import { IRelayHubInstance } from '../../types/truffle-contracts'
import RelayFailureInfo from './types/RelayFailureInfo'
import ContractInteractor from './ContractInteractor'
import { GSNConfig } from './GSNConfigurator'

export const EmptyFilter: RelayFilter = (): boolean => {
  return true
}

export interface IKnownRelaysManager {
  refresh (): Promise<void>
  getRelaysSorted (): RelayRegisteredEventInfo[]
  saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void

}

export default class KnownRelaysManager implements IKnownRelaysManager {
  private readonly latestRelayFailures = new Map<string, RelayFailureInfo>()
  private readonly activeRelays = new Set<RelayRegisteredEventInfo>()
  private readonly contractInteractor: ContractInteractor
  private readonly config: GSNConfig
  private readonly relayFilter: RelayFilter

  private latestScannedBlock: number = 0

  constructor (contractInteractor: ContractInteractor, relayFilter: RelayFilter, config: GSNConfig) {
    this.config = config
    this.relayFilter = relayFilter
    this.contractInteractor = contractInteractor
  }

  compareRelayScores (r1: RelayRegisteredEventInfo, r2: RelayRegisteredEventInfo): number {
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
      const timeoutGrace = this.config.relayTimeoutGrace
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
    const relayHub = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)
    const relayManagers = await this._fetchRecentlyActiveRelayManagers(relayHub)
    const relayServerRegisteredTopic = event2topic(relayHub.contract, 'RelayServerRegistered')

    // found all addresses. 2nd round to get the RelayAdded event for each of those relays.
    // TODO: at least some of the found relays above was due to "RelayAdded" event,
    // we _could_ optimize for that, but since at least _some_ relays
    // were found by the TransactionRelayed event, we are forced to search them
    // for actual address.
    const relayServerRegisteredEvents: any[] = await relayHub.contract.getPastEvents('RelayServerRegistered', {
      fromBlock: 1,
      topics: [relayServerRegisteredTopic,
        Array.from(relayManagers.values(),
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
      activeRelays.set(args.relayManager, relay)
    })
    const origRelays = Array.from(activeRelays.values())
    const filteredRelays = origRelays.filter(this.relayFilter)
    filteredRelays.forEach(relay => this.activeRelays.add(relay))
  }

  async _fetchRecentlyActiveRelayManagers (relayHub: IRelayHubInstance): Promise<Set<Address>> {
    const fromBlock = this.latestScannedBlock
    const toBlock = await this.contractInteractor.getBlockNumber()
    const eventTopics = event2topic(relayHub.contract,
      ['RelayServerRegistered', 'TransactionRelayed', 'CanRelayFailed'])

    const relayEvents: any[] = await this.contractInteractor.getPastEventsForHub(this.config.relayHubAddress, 'allEvents', {
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

  saveRelayFailure (lastErrorTime: number, relayManager: Address, relayUrl: string): void {
    this.latestRelayFailures.set(relayUrl, {
      lastErrorTime,
      relayManager,
      relayUrl
    })
  }
}
