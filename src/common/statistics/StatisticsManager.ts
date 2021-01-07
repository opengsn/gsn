import { EventData } from 'web3-eth-contract'

import HttpClient from '../../relayclient/HttpClient'
import { Address, EventName, IntString, ObjectMap, SemVerString } from '../types/Aliases'
import ContractInteractor from '../ContractInteractor'
import { address2topic, eventsComparator, isSameAddress } from '../Utils'

import {
  Deposited,
  DepositedEventInfo,
  GNSContractsEvent,
  HubAuthorized,
  HubAuthorizedEventInfo,
  HubUnauthorized,
  HubUnauthorizedEventInfo,
  RelayRegisteredEventInfo,
  RelayServerRegistered,
  StakeAdded,
  StakeAddedEventInfo,
  StakeChangeEvent,
  StakePenalized,
  StakePenalizedEventInfo,
  StakeUnlocked,
  StakeUnlockedEventInfo,
  StakeWithdrawn,
  StakeWithdrawnEventInfo,
  TransactionRejectedByPaymaster,
  TransactionRejectedByPaymasterEventInfo,
  TransactionRelayed,
  TransactionRelayedEventInfo,
  allStakeManagerEvents
} from '../types/GSNContractsDataTypes'

import {
  EventTransactionInfo,
  GSNStatistics,
  PaymasterInfo,
  PingResult,
  RecipientInfo,
  RelayHubConstructorParams,
  RelayHubEvents,
  RelayServerInfo,
  RelayServerRegistrationInfo,
  RelayServerRegistrationStatus,
  RelaysByStakeStatus,
  SenderInfo,
  StakeMangerEvents
} from '../../cli/GSNStatistics'

import { gsnRuntimeVersion } from '../Version'

export default class StatisticsManager {
  private readonly contractInteractor: ContractInteractor
  private readonly httpClient: HttpClient
  private allStakeManagerEvents!: StakeMangerEvents

  // TODO: hub events object maybe?
  private depositedEvents!: Array<EventTransactionInfo<DepositedEventInfo>>
  private transactionRelayedEvents: Array<EventTransactionInfo<TransactionRelayedEventInfo>> = []
  private transactionRejectedEvents: Array<EventTransactionInfo<TransactionRejectedByPaymasterEventInfo>> = []

  constructor (contractInteractor: ContractInteractor, httpClient: HttpClient) {
    this.contractInteractor = contractInteractor
    this.httpClient = httpClient
  }

  async gatherStatistics (): Promise<GSNStatistics> {
    const chainId = this.contractInteractor.chainId
    const blockNumber = await this.contractInteractor.getBlockNumber()
    const relayHubConstructorParams = await this.getRelayHubConstructorParams()

    const stakeManagerAddress = this.contractInteractor.stakeManagerAddress()
    const totalStakesByRelays = await this.contractInteractor.getBalance(stakeManagerAddress)

    this.allStakeManagerEvents = await this.getStakeManagerEvents()

    // TODO: copy-pasted code from the 'getServersInfo', refactor!
    const transactionDepositedEventsData =
      await this.contractInteractor.getPastEventsForHub([], { fromBlock: 1 }, [Deposited])
    this.depositedEvents = this.extractTransactionInfos<DepositedEventInfo>(transactionDepositedEventsData, Deposited)

    const transactionRelayedEventsData =
      await this.contractInteractor.getPastEventsForHub([], { fromBlock: 1 }, [TransactionRelayed])
    this.transactionRelayedEvents = this.extractTransactionInfos<TransactionRelayedEventInfo>(transactionRelayedEventsData, TransactionRelayed)

    const transactionRejectedEventsData =
      await this.contractInteractor.getPastEventsForHub([], { fromBlock: 1 }, [TransactionRejectedByPaymaster])
    this.transactionRejectedEvents = this.extractTransactionInfos<TransactionRejectedByPaymasterEventInfo>(transactionRejectedEventsData, TransactionRejectedByPaymaster)

    const relayHubEvents: RelayHubEvents = {
      relayRegisteredEvents: [], // TODO
      transactionRelayedEvents: this.transactionRelayedEvents,
      transactionRejectedEvents: this.transactionRejectedEvents
    }
    // TODO
    const stakeManagerEvents: StakeMangerEvents = {
      allEvents: [],
      stakeAddedEvents: [],
      stakeUnlockedEvents: [],
      stakeWithdrawnEvents: [],
      stakePenalizedEvents: [],
      hubAuthorizedEvents: [],
      hubUnauthorizedEvents: []
    }

    const relayServers = await this.getRelayServersInfo()
    const paymasters = await this.getPaymastersInfo()
    const senders = await this.getSendersInfo()
    const recipients = await this.getRecipientsInfo()
    const totalGasPaidViaGSN = '0'

    const runtimeVersion = gsnRuntimeVersion
    const contractsDeployment = this.contractInteractor.getDeployment()
    const deploymentVersions = await this.contractInteractor.resolveDeploymentVersions()
    const deploymentBalances = await this.contractInteractor.queryDeploymentBalances()
    return {
      relayHubEvents,
      stakeManagerEvents,
      relayHubConstructorParams,
      deploymentBalances,
      chainId,
      runtimeVersion,
      deploymentVersions,
      contractsDeployment,
      blockNumber,
      totalStakesByRelays,
      paymasters,
      senders,
      recipients,
      relayServers,
      totalGasPaidViaGSN
    }
  }

  // TODO
  async getSendersInfo (): Promise<SenderInfo[]> {
    return []
  }

  // TODO
  async getRecipientsInfo (): Promise<RecipientInfo[]> {
    return []
  }

  async getPaymastersInfo (): Promise<PaymasterInfo[]> {
    const paymasters = new Set<Address>()
    for (const depositedEventInfo of this.depositedEvents) {
      paymasters.add(depositedEventInfo.returnValues.paymaster)
    }
    const paymasterInfos: PaymasterInfo[] = []
    for (const address of paymasters) {
      const relayHubBalance = (await this.contractInteractor.hubBalanceOf(address)).toString()
      const acceptedTransactionsCount = this.transactionRelayedEvents.filter(it => isSameAddress(it.returnValues.paymaster, address)).length
      const rejectedTransactionsCount = this.transactionRejectedEvents.filter(it => isSameAddress(it.returnValues.paymaster, address)).length
      paymasterInfos.push({
        address,
        relayHubBalance,
        acceptedTransactionsCount,
        rejectedTransactionsCount
      })
    }
    return paymasterInfos
  }

  extractUnique (events: Array<EventTransactionInfo<StakeChangeEvent>>): Set<Address> {
    const set = new Set<Address>()
    events.forEach(it => {
      set.add(it.returnValues.relayManager)
    })
    return set
  }

  // TODO: extract shared code
  async getRelaysByStakeStatus (): Promise<RelaysByStakeStatus> {
    const allEverStakedRelays = this.extractUnique(this.allStakeManagerEvents.stakeAddedEvents)
    const allEverUnlockedRelays = this.extractUnique(this.allStakeManagerEvents.stakeUnlockedEvents)
    const allCurrentlyWithdrawnRelays = this.extractUnique(this.allStakeManagerEvents.stakeWithdrawnEvents)
    const allCurrentlyPenalizedRelays = this.extractUnique(this.allStakeManagerEvents.stakePenalizedEvents)
    const allCurrentlyUnlockedRelays = new Set(
      [...allEverUnlockedRelays]
        .filter(it => !allCurrentlyWithdrawnRelays.has(it))
        .filter(it => !allCurrentlyPenalizedRelays.has(it))
    )
    const allCurrentlyStakedRelays = new Set(
      [...allEverStakedRelays]
        .filter(it => !allCurrentlyWithdrawnRelays.has(it))
        .filter(it => !allCurrentlyPenalizedRelays.has(it))
    )
    return {
      allCurrentlyStakedRelays,
      allCurrentlyUnlockedRelays,
      allCurrentlyWithdrawnRelays,
      allCurrentlyPenalizedRelays
    }
  }

  async getRelayServersInfo (): Promise<RelayServerInfo[]> {
    const relayServersInfo: RelayServerInfo[] = []
    const relaysByStatus = await this.getRelaysByStakeStatus()
    for (const inactiveRelayManager of relaysByStatus.allCurrentlyWithdrawnRelays) {
      relayServersInfo.push(await this.gatherRelayInfo(inactiveRelayManager, RelayServerRegistrationStatus.WITHDRAWN))
    }
    for (const inactiveRelayManager of relaysByStatus.allCurrentlyUnlockedRelays) {
      relayServersInfo.push(await this.gatherRelayInfo(inactiveRelayManager, RelayServerRegistrationStatus.UNLOCKED))
    }
    for (const inactiveRelayManager of relaysByStatus.allCurrentlyPenalizedRelays) {
      relayServersInfo.push(await this.gatherRelayInfo(inactiveRelayManager, RelayServerRegistrationStatus.PENALIZED))
    }
    for (const inactiveRelayManager of relaysByStatus.allCurrentlyStakedRelays) {
      relayServersInfo.push(await this.gatherRelayInfo(inactiveRelayManager, RelayServerRegistrationStatus.STAKED))
    }
    return relayServersInfo
  }

  async gatherRelayInfo (managerAddress: Address, relayServerRegistrationStatus: RelayServerRegistrationStatus): Promise<RelayServerInfo> {
    let registrationInfo: RelayServerRegistrationInfo | undefined
    let currentStatus = relayServerRegistrationStatus
    const stakeManagerEvents = await this.getStakeManagerEvents(managerAddress)
    const authorizedHubs = await this.getAuthorizedHubsAndVersions(stakeManagerEvents)

    // TODO: here we can use pre-queried all events for hub (may require pagination) instead of 2 RPC calls
    const relayRegisteredEventsData =
      await this.contractInteractor.getPastEventsForHub([address2topic(managerAddress)], { fromBlock: 1 }, [RelayServerRegistered])
    const relayRegisteredEvents = this.extractTransactionInfos<RelayRegisteredEventInfo>(relayRegisteredEventsData, RelayServerRegistered)
    const transactionRelayedEventsData =
      await this.contractInteractor.getPastEventsForHub([address2topic(managerAddress)], { fromBlock: 1 }, [TransactionRelayed, TransactionRejectedByPaymaster])
    const transactionRelayedEvents = this.extractTransactionInfos<TransactionRelayedEventInfo>(transactionRelayedEventsData, TransactionRelayed)
    const transactionRejectedEvents = this.extractTransactionInfos<TransactionRejectedByPaymasterEventInfo>(transactionRelayedEventsData, TransactionRejectedByPaymaster)

    const relayHubEvents: RelayHubEvents = {
      relayRegisteredEvents,
      transactionRelayedEvents,
      transactionRejectedEvents
    }

    const isServerRegistered = relayServerRegistrationStatus === RelayServerRegistrationStatus.STAKED && relayRegisteredEvents.length !== 0
    const relayHubEarningsBalance = (await this.contractInteractor.hubBalanceOf(managerAddress)).toString()
    const stakeInfo = await this.contractInteractor.stakeManagerStakeInfo(managerAddress)
    const ownerBalance = await this.contractInteractor.getBalance(stakeInfo.owner)
    const managerBalance = await this.contractInteractor.getBalance(managerAddress)
    if (isServerRegistered) {
      currentStatus = RelayServerRegistrationStatus.REGISTERED
      const lastRegisteredUrl = relayRegisteredEvents[relayRegisteredEvents.length - 1].returnValues.relayUrl
      const lastRegisteredBaseFee = relayRegisteredEvents[relayRegisteredEvents.length - 1].returnValues.baseRelayFee
      const lastRegisteredPctFee = relayRegisteredEvents[relayRegisteredEvents.length - 1].returnValues.pctRelayFee
      const pingResult = await this.attemptPing(lastRegisteredUrl)
      const registeredWorkers: Address[] = await this.contractInteractor.getRegisteredWorkers(managerAddress)
      const workerBalances: ObjectMap<IntString> = {}
      for (const worker of registeredWorkers) {
        workerBalances[worker] = await this.contractInteractor.getBalance(worker)
      }
      registrationInfo = {
        pingResult,
        workerBalances,
        lastRegisteredUrl,
        lastRegisteredBaseFee,
        lastRegisteredPctFee,
        registeredWorkers
      }
    }
    return {
      ownerBalance,
      managerBalance,
      currentStatus,
      authorizedHubs,
      managerAddress,
      stakeInfo,
      relayHubEarningsBalance,
      relayHubEvents,
      registrationInfo,
      stakeManagerEvents
    }
  }

  async getStakeManagerEvents (managerAddress?: Address): Promise<StakeMangerEvents> {
    const extraTopics = []
    if (managerAddress != null) {
      extraTopics.push(address2topic(managerAddress))
    }
    const allEvents = await this.contractInteractor.getPastEventsForStakeManager(allStakeManagerEvents, extraTopics, { fromBlock: 1 })

    const stakeAddedEvents = this.extractTransactionInfos<StakeAddedEventInfo>(allEvents, StakeAdded)
    const stakeUnlockedEvents = this.extractTransactionInfos<StakeUnlockedEventInfo>(allEvents, StakeUnlocked)
    const stakeWithdrawnEvents = this.extractTransactionInfos<StakeWithdrawnEventInfo>(allEvents, StakeWithdrawn)
    const stakePenalizedEvents = this.extractTransactionInfos<StakePenalizedEventInfo>(allEvents, StakePenalized)
    const hubAuthorizedEvents = this.extractTransactionInfos<HubAuthorizedEventInfo>(allEvents, HubAuthorized)
    const hubUnauthorizedEvents = this.extractTransactionInfos<HubUnauthorizedEventInfo>(allEvents, HubUnauthorized)

    return {
      allEvents,
      stakeAddedEvents,
      stakeUnlockedEvents,
      stakeWithdrawnEvents,
      stakePenalizedEvents,
      hubAuthorizedEvents,
      hubUnauthorizedEvents
    }
  }

  async attemptPing (url: string): Promise<PingResult> {
    let relayPing: PingResult
    try {
      const pingResponse = await this.httpClient.getPingResponse(url)
      relayPing = { pingResponse }
    } catch (error) {
      relayPing = { error }
    }
    return relayPing
  }

  extractTransactionInfos<T extends GNSContractsEvent> (eventsData: EventData[], eventName: EventName): Array<EventTransactionInfo<T>> {
    return eventsData
      .filter(eventData => eventData.event === eventName)
      .map(
        eventData => {
          return {
            eventData,
            explorerURL: 'TODO TODO',
            returnValues: eventData.returnValues as T
          }
        }
      )
  }

  // setListener (listener: (() => void)): void {
  //   listener()
  // }
  // TODO REFACTOR!!!
  async getAuthorizedHubsAndVersions (stakeManagerEvents: StakeMangerEvents): Promise<ObjectMap<SemVerString>> {
    const authorizedHubs = new Set<Address>()
    const orderedEvents =
      stakeManagerEvents.allEvents
        .filter(it => it.event === HubAuthorized || it.event === HubUnauthorized)
        .sort(eventsComparator)
    for (const eventData of orderedEvents) {
      if (eventData.event === HubAuthorized) {
        authorizedHubs.add(eventData.returnValues.relayHub)
      } else if (eventData.event === HubUnauthorized) {
        authorizedHubs.delete(eventData.returnValues.relayHub)
      }
    }
    const versionsMap: ObjectMap<SemVerString> = {}
    for (const hub of authorizedHubs) {
      try {
        const hubInstance = await this.contractInteractor._createRelayHub(hub)
        versionsMap[hub] = await hubInstance.versionHub()
      } catch (e) {
        versionsMap[hub] = 'Failed to query'
      }
    }
    return versionsMap
  }

  async getRelayHubConstructorParams (): Promise<RelayHubConstructorParams> {
    const maxWorkerCount = (await this.contractInteractor.relayHubInstance.maxWorkerCount()).toString()
    const gasReserve = (await this.contractInteractor.relayHubInstance.gasReserve()).toString()
    const postOverhead = (await this.contractInteractor.relayHubInstance.postOverhead()).toString()
    const gasOverhead = (await this.contractInteractor.relayHubInstance.gasOverhead()).toString()
    const maximumRecipientDeposit = (await this.contractInteractor.relayHubInstance.maximumRecipientDeposit()).toString()
    const minimumUnstakeDelay = (await this.contractInteractor.relayHubInstance.minimumUnstakeDelay()).toString()
    const minimumStake = (await this.contractInteractor.relayHubInstance.minimumStake()).toString()
    return {
      maxWorkerCount,
      gasReserve,
      postOverhead,
      gasOverhead,
      maximumRecipientDeposit,
      minimumUnstakeDelay,
      minimumStake
    }
  }
}
