import ContractInteractor, { RelayServerRegistered } from '../relayclient/ContractInteractor'
import HttpClient from '../relayclient/HttpClient'
import PingResponse from '../common/PingResponse'
import { RelayRegisteredEventInfo } from '../relayclient/types/RelayRegisteredEventInfo'
import { Address } from '../relayclient/types/Aliases'

interface StatusConfig {
  blockHistoryCount: number
  getAddressTimeout: number
  relayHubAddress: Address
}

interface PingAttempt {
  pingResponse?: PingResponse
  error?: Error
}

interface Statistics {
  totalStakesByRelays: string
  relayRegisteredEvents: RelayRegisteredEventInfo[]
  relayPings: Map<string, PingAttempt>
  balances: Map<Address, string>
}

export default class StatusLogic {
  private readonly contractInteractor: ContractInteractor
  private readonly httpClient: HttpClient
  private readonly config: StatusConfig

  constructor (contractInteractor: ContractInteractor, httpClient: HttpClient, config: StatusConfig) {
    this.contractInteractor = contractInteractor
    this.httpClient = httpClient
    this.config = config
  }

  async gatherStatistics (): Promise<Statistics> {
    const curBlockNumber = await this.contractInteractor.getBlockNumber()
    const fromBlock = Math.max(1, curBlockNumber - this.config.blockHistoryCount)

    const r = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)
    const stakeManager = await r.stakeManager()
    const totalStakesByRelays = await this.contractInteractor.getBalance(stakeManager)

    const relayRegisteredEventsData =
      await this.contractInteractor.getPastEventsForHub([RelayServerRegistered], [], { fromBlock })
    const relayRegisteredEvents = relayRegisteredEventsData.map(e => e.returnValues as RelayRegisteredEventInfo)

    const relayPings = new Map<string, PingAttempt>()
    const balances = new Map<string, string>()
    for (const registerEvent of relayRegisteredEvents) {
      const url = registerEvent.relayUrl
      const relayManager = registerEvent.relayManager
      try {
        const pingResponse = await this.httpClient.getPingResponse(url)
        relayPings.set(url, { pingResponse })
      } catch (error) {
        relayPings.set(url, { error })
      }
      const managerBalance = await this.contractInteractor.getBalance(relayManager)
      balances.set(relayManager, managerBalance)
    }

    return {
      totalStakesByRelays,
      relayRegisteredEvents,
      relayPings,
      balances
    }
  }
}
