import { IntString } from './Aliases'

export interface RelayHubConfiguration {
  maxWorkerCount: number | BN
  gasReserve: number | BN
  postOverhead: number | BN
  gasOverhead: number | BN
  maximumRecipientDeposit: IntString | BN
  minimumUnstakeDelay: number | BN
  minimumStake: IntString | BN
  dataGasCostPerByte: number | BN
  maxGasCostPerCalldataByte: number | BN
  externalCallDataCostOverhead: number | BN
  baseRelayFeeBidMode: boolean
}
