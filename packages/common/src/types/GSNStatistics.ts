import { Address, IntString, ObjectMap, SemVerString } from './Aliases'
import {
  DepositedEventInfo,
  GNSContractsEvent, HubAuthorizedEventInfo, HubUnauthorizedEventInfo,
  RelayRegisteredEventInfo,
  StakeAddedEventInfo, StakeInfo, StakePenalizedEventInfo,
  StakeUnlockedEventInfo, StakeWithdrawnEventInfo, TransactionRejectedByPaymasterEventInfo, TransactionRelayedEventInfo
} from './GSNContractsDataTypes'
import { PingResponse } from '../PingResponse'
import { GSNContractsDeployment } from '../GSNContractsDeployment'
type EventData = any

export interface PingResult {
  pingResponse?: PingResponse
  error?: Error
}

/**
 * Simplified structure derived from 'EventData' for better types support and user-visible output.
 */
export interface EventTransactionInfo<T extends GNSContractsEvent> {
  eventData: EventData
  // TODO: is it useful? There are untyped 'returnValues' in eventData anyways
  returnValues: T
}

export enum RelayServerStakeStatus {
  /** only staked, but never registered on currently selected RelayHub */
  STAKE_LOCKED,
  /** stake unlocked but not yet withdrawn */
  STAKE_UNLOCKED,
  /** stake withdrawn */
  STAKE_WITHDRAWN,
  /** stake has been penalized */
  STAKE_PENALIZED
}

export interface RelayHubEvents {
  depositedEvents?: Array<EventTransactionInfo<DepositedEventInfo>>
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
  minimumUnstakeDelay: IntString
}

export interface RelayServerInfo {
  /** Only when {@link isRegistered} is true this object will contain {@link RelayServerRegistrationInfo} */
  stakeInfo: StakeInfo
  ownerBalance: IntString
  stakeStatus: RelayServerStakeStatus
  isRegistered: boolean
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
