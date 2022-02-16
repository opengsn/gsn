export interface RelayHubConfiguration {
  maxWorkerCount: number | BN
  gasReserve: number | BN
  postOverhead: number | BN
  gasOverhead: number | BN
  minimumUnstakeDelay: number | BN
  devAddress: string
  devFee: number | BN | string
}
