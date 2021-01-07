import { Address, IntString, ObjectMap, SemVerString } from '../common/types/Aliases'
import {
  GNSContractsEvent, HubAuthorizedEventInfo, HubUnauthorizedEventInfo,
  RelayRegisteredEventInfo,
  StakeAddedEventInfo, StakeInfo, StakePenalizedEventInfo,
  StakeUnlockedEventInfo, StakeWithdrawnEventInfo, TransactionRejectedByPaymasterEventInfo, TransactionRelayedEventInfo
} from '../common/types/GSNContractsDataTypes'
import PingResponse from '../common/PingResponse'
import { GSNContractsDeployment } from '../common/GSNContractsDeployment'
import { EventData } from 'web3-eth-contract'

export interface PingResult {
  pingResponse?: PingResponse
  error?: Error
}

/**
 * Simplified structure derived from 'EventData' for better types support and user-visible output.
 */
export interface EventTransactionInfo<T extends GNSContractsEvent> {
  explorerURL?: string
  eventData: EventData
  // TODO: is it useful? There are untyped 'returnValues' in eventData anyways
  returnValues: T
}

export enum RelayServerRegistrationStatus {
  /** only staked, but never registered on currently selected RelayHub */
  STAKED,
  /** staked and registered on currently selected RelayHub */
  REGISTERED,
  /** stake unlocked but not yet withdrawn */
  UNLOCKED,
  /** stake withdrawn */
  WITHDRAWN,
  /** stake has been penalized */
  PENALIZED
}

export interface RelaysByStakeStatus {
  allCurrentlyStakedRelays: Set<Address>
  allCurrentlyUnlockedRelays: Set<Address>
  allCurrentlyWithdrawnRelays: Set<Address>
  allCurrentlyPenalizedRelays: Set<Address>
}

export interface RelayHubEvents {
  relayRegisteredEvents: Array<EventTransactionInfo<RelayRegisteredEventInfo>>
  transactionRelayedEvents: Array<EventTransactionInfo<TransactionRelayedEventInfo>>
  transactionRejectedEvents: Array<EventTransactionInfo<TransactionRejectedByPaymasterEventInfo>>
}

export interface StakeMangerEvents {
  allEvents: EventData[]
  stakeAddedEvents: Array<EventTransactionInfo<StakeAddedEventInfo>>
  stakeUnlockedEvents: Array<EventTransactionInfo<StakeUnlockedEventInfo>>
  stakeWithdrawnEvents: Array<EventTransactionInfo<StakeWithdrawnEventInfo>>
  stakePenalizedEvents: Array<EventTransactionInfo<StakePenalizedEventInfo>>
  hubAuthorizedEvents: Array<EventTransactionInfo<HubAuthorizedEventInfo>>
  hubUnauthorizedEvents: Array<EventTransactionInfo<HubUnauthorizedEventInfo>>
}

export interface RelayServerRegistrationInfo {
  lastRegisteredUrl: string
  lastRegisteredBaseFee: IntString
  lastRegisteredPctFee: IntString
  pingResult: PingResult
  registeredWorkers: Address[]
  workerBalances: ObjectMap<IntString>
}

export interface PaymasterInfo {
  address: Address
  relayHubBalance: IntString
  acceptedTransactionsCount: number
  rejectedTransactionsCount: number
}

export interface RecipientInfo {
  address: Address
  transactionCount: number
}

export interface SenderInfo {
  address: Address
  transactionCount: number
}

export interface RelayHubConstructorParams {
  maxWorkerCount: IntString
  gasReserve: IntString
  postOverhead: IntString
  gasOverhead: IntString
  maximumRecipientDeposit: IntString
  minimumUnstakeDelay: IntString
  minimumStake: IntString
}

export interface RelayServerInfo {
  /**
   * Only when {@link currentStatus} is {@link RelayServerRegistrationStatus.REGISTERED}
   * this object will contain {@link RelayServerRegistrationInfo}
   * */
  stakeInfo: StakeInfo
  ownerBalance: IntString
  currentStatus: RelayServerRegistrationStatus
  managerAddress: Address
  managerBalance: IntString
  /** maps address to queried version */
  authorizedHubs: ObjectMap<SemVerString>
  relayHubEarningsBalance: IntString
  /** these fields is currently not fully used but can be used to show a graph of activity/fee change in the future */
  stakeManagerEvents: StakeMangerEvents
  relayHubEvents: RelayHubEvents
  registrationInfo?: RelayServerRegistrationInfo
}

export interface GSNStatistics {
  blockNumber: number
  relayHubConstructorParams: RelayHubConstructorParams
  runtimeVersion: SemVerString
  chainId: number
  /** all events ever */
  stakeManagerEvents: StakeMangerEvents
  relayHubEvents: RelayHubEvents
  contractsDeployment: GSNContractsDeployment
  deploymentVersions: ObjectMap<SemVerString>
  deploymentBalances: ObjectMap<IntString>
  senders: SenderInfo[]
  paymasters: PaymasterInfo[]
  recipients: RecipientInfo[]
  relayServers: RelayServerInfo[]
  totalGasPaidViaGSN: IntString
  totalStakesByRelays: IntString
}
