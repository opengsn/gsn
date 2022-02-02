import { RelayHubConfiguration } from './types/RelayHubConfiguration'
import { PaymasterConfiguration } from './types/PaymasterConfiguration'
import { PenalizerConfiguration } from './types/PenalizerConfiguration'

export interface Environment {
  readonly chainId: number
  readonly mintxgascost: number
  readonly relayHubConfiguration: RelayHubConfiguration
  readonly penalizerConfiguration: PenalizerConfiguration
  readonly paymasterConfiguration: PaymasterConfiguration
  readonly maxUnstakeDelay: number
  readonly gtxdatanonzero: number
  readonly gtxdatazero: number
  readonly dataOnChainHandlingGasCostPerByte: number
  readonly getGasPriceFactor: number
  readonly nonZeroDevFeeGasOverhead: number
}

/**
 * Maximum unstake delay is defined at around 3 years for the mainnet.
 * This is done to prevent mistakenly setting an unstake delay to millions of years.
 */
const defaultStakeManagerMaxUnstakeDelay: number = 100000000

const defaultPenalizerConfiguration: PenalizerConfiguration = {
  penalizeBlockDelay: 5,
  penalizeBlockExpiration: 60000
}

const defaultRelayHubConfiguration: RelayHubConfiguration = {
  gasOverhead: 57501,
  postOverhead: 19040,
  gasReserve: 100000,
  maxWorkerCount: 10,
  minimumUnstakeDelay: 15000,
  devAddress: '0xeFEfeFEfeFeFEFEFEfefeFeFefEfEfEfeFEFEFEf',
  devFee: 0
}

// TODO add as constructor params to paymaster instead of constants
const preRelayedCallGasLimit = 1e5
const forwarderHubOverhead = 5e4
const defaultPaymasterConfiguration: PaymasterConfiguration = {
  forwarderHubOverhead: forwarderHubOverhead,
  preRelayedCallGasLimit: preRelayedCallGasLimit,
  postRelayedCallGasLimit: 11e4,
  acceptanceBudget: preRelayedCallGasLimit + forwarderHubOverhead,
  calldataSizeLimit: 10404
}

const ethereumMainnet: Environment = {
  dataOnChainHandlingGasCostPerByte: 13,
  chainId: 1,
  relayHubConfiguration: defaultRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  mintxgascost: 21000,
  gtxdatanonzero: 16,
  gtxdatazero: 4,
  getGasPriceFactor: 1,
  nonZeroDevFeeGasOverhead: 5638
}

const ganacheLocal: Environment = {
  dataOnChainHandlingGasCostPerByte: 13,
  chainId: 1337,
  relayHubConfiguration: defaultRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  mintxgascost: 21000,
  gtxdatanonzero: 16,
  gtxdatazero: 4,
  getGasPriceFactor: 1,
  nonZeroDevFeeGasOverhead: 5638
}

/* begin Arbitrum-specific Environment */
const arbitrumRelayHubConfigurationOverride: Partial<RelayHubConfiguration> = {
  gasOverhead: 1000000,
  postOverhead: 0
}

const arbitrumRelayHubConfiguration: RelayHubConfiguration =
  Object.assign({},
    defaultRelayHubConfiguration,
    arbitrumRelayHubConfigurationOverride)

const arbitrum: Environment = {
  dataOnChainHandlingGasCostPerByte: 13, // TODO: check if memory allocation costs in Arbitrum are unchanged!
  relayHubConfiguration: arbitrumRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  chainId: 421611,
  mintxgascost: 700000,
  gtxdatanonzero: 2024,
  gtxdatazero: 506,
  // there is currently a hard-coded to be 2 at arbitrum:eth.go:43 (commit: 12483cfa17a29e7d68c354c456ebc371b05a6ea2)
  // setting factor to 0.6 instead of 0.5 to allow the transaction to pass in case of moderate gas price increase
  // note that excess will be collected by the Relay Server as an extra profit
  getGasPriceFactor: 0.6,
  nonZeroDevFeeGasOverhead: 5638
}

/* end Arbitrum-specific Environment */

export enum EnvironmentsKeys {
  ganacheLocal = 'ganacheLocal',
  ethereumMainnet = 'ethereumMainnet',
  arbitrum = 'arbitrum'
}

export const environments: { [key in EnvironmentsKeys]: Environment } = {
  ethereumMainnet,
  ganacheLocal,
  arbitrum
}

export const defaultEnvironment = environments.ganacheLocal
