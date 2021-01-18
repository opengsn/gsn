import { Address } from '@opengsn/common/dist/types/Aliases'

export interface ReputationChange {
  blockNumber: number
  change: number
}

export interface ReputationEntry {
  paymaster: Address
  reputation: number
  lastAcceptedRelayRequestTs: number
  abuseStartedBlock: number
  changes: ReputationChange[]
}
