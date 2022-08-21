import { Address, EventName, IntString } from './Aliases'
import BN from 'bn.js'
import { PrefixedHexString } from 'ethereumjs-util'

// Empty interface used on purpose to mark various Event Infos in collections, used in StatisticsManager.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GNSContractsEvent {}

/** IPenalizer.sol */
export const CommitAdded: EventName = 'CommitAdded'

/** IRelayHub.sol */

export const RelayServerRegistered: EventName = 'RelayServerRegistered'
export const RelayWorkersAdded: EventName = 'RelayWorkersAdded'
export const TransactionRejectedByPaymaster: EventName = 'TransactionRejectedByPaymaster'
export const TransactionRelayed: EventName = 'TransactionRelayed'
export const Deposited: EventName = 'Deposited'

/**
 * Emitting any of these events is handled by GSN clients as a sign of activity by a RelayServer.
 */
export const ActiveManagerEvents = [RelayWorkersAdded, TransactionRelayed, TransactionRejectedByPaymaster]

export interface RelayInfoUrl {
  relayUrl: string
}

export interface RelayRegisteredEventInfo extends RelayInfoUrl, GNSContractsEvent {
  relayHub: Address
  relayManager: Address
}

export interface TransactionRelayedEventInfo extends GNSContractsEvent {
  relayManager: Address
  relayWorker: Address
  from: Address
  to: Address
  paymaster: Address
  selector: PrefixedHexString // ???
  status: IntString // RelayCallStatus
  charge: IntString // ???
}

export interface TransactionRejectedByPaymasterEventInfo extends GNSContractsEvent {
  relayManager: Address
  paymaster: Address
  from: Address
  to: Address
  relayWorker: Address
  selector: PrefixedHexString // ??
  innerGasUsed: IntString
  reason: PrefixedHexString // ??? should be string, see 'decodeRevertReason' for reasons logic
}

export interface DepositedEventInfo extends GNSContractsEvent {
  paymaster: Address
  from: Address
  amount: IntString
}

export function isInfoFromEvent (info: RelayInfoUrl): boolean {
  return 'relayManager' in info
}

/** IStakeManager.sol */

export const HubAuthorized: EventName = 'HubAuthorized'
export const HubUnauthorized: EventName = 'HubUnauthorized'
export const StakeAdded: EventName = 'StakeAdded'
export const StakePenalized: EventName = 'StakePenalized'
export const StakeUnlocked: EventName = 'StakeUnlocked'
export const StakeWithdrawn: EventName = 'StakeWithdrawn'
export const OwnerSet: EventName = 'OwnerSet'

export const allStakeManagerEvents = [StakeAdded, HubAuthorized, HubUnauthorized, StakeUnlocked, StakeWithdrawn, StakePenalized]

export interface StakeAddedEventInfo extends GNSContractsEvent {
  relayManager: Address
  owner: Address
  stake: IntString
  unstakeDelay: IntString
}

export interface StakeUnlockedEventInfo extends GNSContractsEvent {
  relayManager: Address
  owner: Address
  withdrawBlock: IntString
}

export interface StakeWithdrawnEventInfo extends GNSContractsEvent {
  relayManager: Address
  owner: Address
  amount: IntString
}

export interface StakePenalizedEventInfo extends GNSContractsEvent {
  relayManager: Address
  beneficiary: Address
  reward: IntString
}

export type StakeChangeEvent =
  StakeAddedEventInfo
  | StakeUnlockedEventInfo
  | StakeWithdrawnEventInfo
  | StakePenalizedEventInfo

export interface HubAuthorizedEventInfo extends GNSContractsEvent {
  relayManager: Address
  relayHub: Address
}

export interface HubUnauthorizedEventInfo extends GNSContractsEvent {
  relayManager: Address
  relayHub: Address
  removalTime: IntString
}

export interface StakeInfo {
  stake: BN
  unstakeDelay: BN
  withdrawTime: BN
  owner: Address
  token: Address
}
