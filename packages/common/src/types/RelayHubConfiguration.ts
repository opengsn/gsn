import { IntString } from './Aliases'

export interface RelayHubConfiguration {
  maxWorkerCount: number
  gasReserve: number
  postOverhead: number
  gasOverhead: number
  maximumRecipientDeposit: IntString
  minimumUnstakeDelay: number
  minimumStake: IntString
  dataGasCostPerByte: number
  externalCallDataCostOverhead: number
}
