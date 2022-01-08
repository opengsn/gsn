import { IntString } from './Aliases'

export interface RelayHubConfiguration {
  maxWorkerCount: number | BN
  gasReserve: number | BN
  postOverhead: number | BN
  gasOverhead: number | BN
  maximumRecipientDeposit: IntString | BN
  minimumUnstakeDelay: number | BN
  minimumStake: IntString | BN
  devAddress: string
  devFee: number | BN | string
}
