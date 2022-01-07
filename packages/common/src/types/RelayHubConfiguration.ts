import { IntString } from './Aliases'

export interface RelayHubConfiguration {
  maxWorkerCount: number | BN
  gasReserve: number | BN
  postOverhead: number | BN
  gasOverhead: number | BN
  minimumUnstakeDelay: number | BN
  minimumStake: IntString | BN
}
