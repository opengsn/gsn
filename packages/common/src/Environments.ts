/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */
import { RelayHubConfiguration } from './types/RelayHubConfiguration'
import { PaymasterConfiguration } from './types/PaymasterConfiguration'
import { PenalizerConfiguration } from './types/PenalizerConfiguration'

interface Environment {
  readonly chainId: number
  readonly mintxgascost: number
  readonly relayHubConfiguration: RelayHubConfiguration
  readonly penalizerConfiguration: PenalizerConfiguration
  readonly paymasterConfiguration: PaymasterConfiguration
  readonly maxUnstakeDelay: number
  readonly gtxdatanonzero: number
  readonly gtxdatazero: number
}

/**
 * With about 6000 blocks per day, maximum unstake delay is defined at around 5 years for the mainnet.
 * This is done to prevent mistakenly setting an unstake delay to millions of years.
 */
const defaultStakeManagerMaxUnstakeDelay: number = 10000000

const defaultPenalizerConfiguration: PenalizerConfiguration = {
  penalizeBlockDelay: 5,
  penalizeBlockExpiration: 60000
}

const defaultRelayHubConfiguration: RelayHubConfiguration = {
  gasOverhead: 31907,
  postOverhead: 11890,
  gasReserve: 100000,
  maxWorkerCount: 10,
  minimumStake: 1e18.toString(),
  minimumUnstakeDelay: 1000,
  maximumRecipientDeposit: 2e18.toString(),
  dataGasCostPerByte: 13,
  externalCallDataCostOverhead: 22402
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

export const environments: { [key: string]: Environment } = {
  istanbul: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    penalizerConfiguration: defaultPenalizerConfiguration,
    paymasterConfiguration: defaultPaymasterConfiguration,
    maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
    mintxgascost: 21000,
    gtxdatanonzero: 16,
    gtxdatazero: 4
  },
  constantinople: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    penalizerConfiguration: defaultPenalizerConfiguration,
    paymasterConfiguration: defaultPaymasterConfiguration,
    maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
    mintxgascost: 21000,
    gtxdatanonzero: 16,
    gtxdatazero: 4
  },
  ganacheLocal: {
    chainId: 1337,
    relayHubConfiguration: defaultRelayHubConfiguration,
    penalizerConfiguration: defaultPenalizerConfiguration,
    paymasterConfiguration: defaultPaymasterConfiguration,
    maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
    mintxgascost: 21000,
    gtxdatanonzero: 16,
    gtxdatazero: 4
  }
}

export const defaultEnvironment = environments.ganacheLocal
