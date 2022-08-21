import { EventData } from 'web3-eth-contract'

import { ContractInteractor } from '../ContractInteractor'
import { HttpClient } from '../HttpClient'
import { Address, EventName, ObjectMap, SemVerString } from '../types/Aliases'
import { eventsComparator, isSameAddress } from '../Utils'

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
  RelayServerStakeStatus,
  SenderInfo,
  StakeMangerEvents
} from '../types/GSNStatistics'

import { gsnRuntimeVersion } from '../Version'
import { LoggerInterface } from '../LoggerInterface'

export class StatisticsManager {
  private readonly contractInteractor: ContractInteractor
  private readonly httpClient: HttpClient
  private readonly logger: LoggerInterface

  private allStakeManagerEvents!: StakeMangerEvents
  private allRelayHubEvents!: RelayHubEvents

  constructor (
    contractInteractor: ContractInteractor,
    httpClient: HttpClient,
    logger: LoggerInterface) {
    this.contractInteractor = contractInteractor
    this.httpClient = httpClient
    this.logger = logger
  }

  async gatherStatistics (): Promise<GSNStatistics> {
    const chainId = this.contractInteractor.chainId
    const blockNumber = await this.contractInteractor.getBlockNumber()
    const relayHubConstructorParams = await this.getRelayHubConstructorParams()

    const stakeManagerAddress = this.contractInteractor.stakeManagerAddress()
    const totalStakesByRelays = await this.contractInteractor.getBalance(stakeManagerAddress)
    await this.fetchStakeManagerEvents()
    await this.fetchRelayHubEvents()

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
      relayHubEvents: this.allRelayHubEvents,
      stakeManagerEvents: this.allStakeManagerEvents,
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

  async fetchRelayHubEvents (): Promise<void> {
    const transactionDepositedEventsData =
      await this.contractInteractor.getPastEventsForHub([], { fromBlock: 1 }, [Deposited])
    const depositedEvents = this.extractTransactionInfos<DepositedEventInfo>(transactionDepositedEventsData, Deposited)

    const relayRegisteredEventsData =
      await this.contractInteractor.getPastEventsForRegistrar([], { fromBlock: 1 }, [RelayServerRegistered])
    const relayRegisteredEvents = this.extractTransactionInfos<RelayRegisteredEventInfo>(relayRegisteredEventsData, RelayServerRegistered)

    const transactionRelayedEventsData =
      await this.contractInteractor.getPastEventsForHub([], { fromBlock: 1 }, [TransactionRelayed])
    const transactionRelayedEvents = this.extractTransactionInfos<TransactionRelayedEventInfo>(transactionRelayedEventsData, TransactionRelayed)

    const transactionRejectedEventsData =
      await this.contractInteractor.getPastEventsForHub([], { fromBlock: 1 }, [TransactionRejectedByPaymaster])
    const transactionRejectedEvents = this.extractTransactionInfos<TransactionRejectedByPaymasterEventInfo>(transactionRejectedEventsData, TransactionRejectedByPaymaster)

    this.allRelayHubEvents = {
      depositedEvents,
      relayRegisteredEvents,
      transactionRelayedEvents,
      transactionRejectedEvents
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
    for (const depositedEventInfo of this.allRelayHubEvents.depositedEvents ?? []) {
      paymasters.add(depositedEventInfo.returnValues.paymaster)
    }
    const paymasterInfos: PaymasterInfo[] = []
    for (const address of paymasters) {
      const relayHubBalance = (await this.contractInteractor.hubBalanceOf(address)).toString()
      const acceptedTransactionsCount = this.allRelayHubEvents.transactionRelayedEvents.filter(it => isSameAddress(it.returnValues.paymaster, address)).length
      const rejectedTransactionsCount = this.allRelayHubEvents.transactionRejectedEvents.filter(it => isSameAddress(it.returnValues.paymaster, address)).length
      paymasterInfos.push({
        address,
        relayHubBalance,
        acceptedTransactionsCount,
        rejectedTransactionsCount
      })
    }
    return paymasterInfos
  }

  extractUnique (events: Array<EventTransactionInfo<StakeChangeEvent>>): Address[] {
    const set = new Set<Address>()
    events.forEach(it => {
      set.add(it.returnValues.relayManager)
    })
    return Array.from(set)
  }

  getRelaysStakeStatus (): Array<{ address: Address, status: RelayServerStakeStatus }> {
    const allEverStakedRelays = this.extractUnique(this.allStakeManagerEvents.stakeAddedEvents)
    const allEverUnlockedRelays = this.extractUnique(this.allStakeManagerEvents.stakeUnlockedEvents)
    const allCurrentlyWithdrawnRelays = this.extractUnique(this.allStakeManagerEvents.stakeWithdrawnEvents)
    const allCurrentlyPenalizedRelays = this.extractUnique(this.allStakeManagerEvents.stakePenalizedEvents)
    const allCurrentlyUnlockedRelays = new Set(
      [...allEverUnlockedRelays]
        .filter(it => !allCurrentlyWithdrawnRelays.includes(it))
        .filter(it => !allCurrentlyPenalizedRelays.includes(it))
    )
    const allCurrentlyStakedRelays = new Set(
      [...allEverStakedRelays]
        .filter(it => !allEverUnlockedRelays.includes(it))
        .filter(it => !allCurrentlyPenalizedRelays.includes(it))
    )
    return [
      ...Array.from(allCurrentlyStakedRelays).map(address => {
        return {
          address,
          status: RelayServerStakeStatus.STAKE_LOCKED
        }
      }),
      ...Array.from(allCurrentlyUnlockedRelays).map(address => {
        return {
          address,
          status: RelayServerStakeStatus.STAKE_UNLOCKED
        }
      }),
      ...Array.from(allCurrentlyWithdrawnRelays).map(address => {
        return {
          address,
          status: RelayServerStakeStatus.STAKE_WITHDRAWN
        }
      }),
      ...Array.from(allCurrentlyPenalizedRelays).map(address => {
        return {
          address,
          status: RelayServerStakeStatus.STAKE_PENALIZED
        }
      })
    ]
  }

  async getRelayServersInfo (): Promise<RelayServerInfo[]> {
    const relayServersInfo: Array<Promise<RelayServerInfo>> = []
    const relaysByStatus = this.getRelaysStakeStatus()
    for (const relay of relaysByStatus) {
      relayServersInfo.push(this.gatherRelayInfo(relay.address, relay.status))
    }
    return await Promise.all(relayServersInfo)
  }

  async gatherRelayInfo (managerAddress: Address, stakeStatus: RelayServerStakeStatus): Promise<RelayServerInfo> {
    let registrationInfo: RelayServerRegistrationInfo | undefined
    const stakeManagerEvents = await this.getStakeManagerEvents(managerAddress)
    const authorizedHubs = await this.getAuthorizedHubsAndVersions(stakeManagerEvents)

    const relayRegisteredEvents =
      this.allRelayHubEvents.relayRegisteredEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const transactionRelayedEvents =
      this.allRelayHubEvents.transactionRelayedEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const transactionRejectedEvents =
      this.allRelayHubEvents.transactionRejectedEvents.filter(it => it.returnValues.relayManager === managerAddress)

    const relayHubEvents: RelayHubEvents = {
      relayRegisteredEvents,
      transactionRelayedEvents,
      transactionRejectedEvents
    }

    // const isRegistered = stakeStatus === RelayServerStakeStatus.STAKE_LOCKED && relayRegisteredEvents.length !== 0
    const relayHubEarningsBalance = (await this.contractInteractor.hubBalanceOf(managerAddress)).toString()
    const stakeInfo = await this.contractInteractor.getStakeInfo(managerAddress)
    const ownerBalance = await this.contractInteractor.getBalance(stakeInfo.owner)
    const managerBalance = await this.contractInteractor.getBalance(managerAddress)
    // if (isRegistered) {
    //   const lastRegisteredUrl = relayRegisteredEvents[relayRegisteredEvents.length - 1].returnValues.relayUrl
    //   const pingResult = await this.attemptPing(lastRegisteredUrl)
    //   const registeredWorkers: Address[] = await this.contractInteractor.getRegisteredWorkers(managerAddress)
    //   const workerBalances: ObjectMap<IntString> = {}
    //   for (const worker of registeredWorkers) {
    //     workerBalances[worker] = await this.contractInteractor.getBalance(worker)
    //   }
    //   registrationInfo = {
    //     pingResult,
    //     workerBalances,
    //     lastRegisteredUrl,
    //     registeredWorkers
    //   }
    // }
    return {
      ownerBalance,
      managerBalance,
      stakeStatus,
      isRegistered: false,
      authorizedHubs,
      managerAddress,
      stakeInfo,
      relayHubEarningsBalance,
      relayHubEvents,
      registrationInfo,
      stakeManagerEvents
    }
  }

  getStakeManagerEvents (managerAddress?: Address): StakeMangerEvents {
    const stakeAddedEvents =
      this.allStakeManagerEvents.stakeAddedEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const stakeUnlockedEvents =
      this.allStakeManagerEvents.stakeUnlockedEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const stakeWithdrawnEvents =
      this.allStakeManagerEvents.stakeWithdrawnEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const stakePenalizedEvents =
      this.allStakeManagerEvents.stakePenalizedEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const hubAuthorizedEvents =
      this.allStakeManagerEvents.hubAuthorizedEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const hubUnauthorizedEvents =
      this.allStakeManagerEvents.hubUnauthorizedEvents.filter(it => it.returnValues.relayManager === managerAddress)
    const allEvents =
      this.allStakeManagerEvents.allEvents.filter(it => it.returnValues.relayManager === managerAddress)
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

  async fetchStakeManagerEvents (): Promise<void> {
    const allEvents = await this.contractInteractor.getPastEventsForStakeManager(allStakeManagerEvents, [], { fromBlock: 1 })

    const stakeAddedEvents = this.extractTransactionInfos<StakeAddedEventInfo>(allEvents, StakeAdded)
    const stakeUnlockedEvents = this.extractTransactionInfos<StakeUnlockedEventInfo>(allEvents, StakeUnlocked)
    const stakeWithdrawnEvents = this.extractTransactionInfos<StakeWithdrawnEventInfo>(allEvents, StakeWithdrawn)
    const stakePenalizedEvents = this.extractTransactionInfos<StakePenalizedEventInfo>(allEvents, StakePenalized)
    const hubAuthorizedEvents = this.extractTransactionInfos<HubAuthorizedEventInfo>(allEvents, HubAuthorized)
    const hubUnauthorizedEvents = this.extractTransactionInfos<HubUnauthorizedEventInfo>(allEvents, HubUnauthorized)

    this.allStakeManagerEvents = {
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
    } catch (error: any) {
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
            returnValues: eventData.returnValues as T
          }
        }
      )
  }

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
    const hubConfig = await this.contractInteractor.relayHubInstance.getConfiguration()
    return {
      maxWorkerCount: hubConfig.maxWorkerCount.toString(),
      gasReserve: hubConfig.gasReserve.toString(),
      postOverhead: hubConfig.postOverhead.toString(),
      gasOverhead: hubConfig.gasOverhead.toString(),
      minimumUnstakeDelay: hubConfig.minimumUnstakeDelay.toString()
    }
  }
}
