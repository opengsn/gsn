import { Address } from '@opengsn/common'

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
