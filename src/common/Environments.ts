/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */
import { RelayHubConfiguration } from './types/RelayHubConfiguration'
import { PaymasterConfiguration } from './types/PaymasterConfiguration'

interface Environment {
  readonly chainId: number
  readonly mintxgascost: number
  readonly relayHubConfiguration: RelayHubConfiguration
  readonly gtxdatanonzero: number
  readonly gtxdatazero: number
}

export const defaultRelayHubConfiguration: RelayHubConfiguration = {
  gasOverhead: 35901,
  postOverhead: 15026,
  gasReserve: 100000,
  maxWorkerCount: 10,
  minimumStake: 1e18.toString(),
  minimumUnstakeDelay: 1000,
  maximumRecipientDeposit: 2e18.toString(),
  dataGasCostPerByte: 20
}

// TODO add as constructor params to paymaster instead of constants
const preRelayedCallGasLimit = 1e5
const forwarderHubOverhead = 5e4
export const defaultPaymasterConfiguration: PaymasterConfiguration = {
  forwarderHubOverhead: forwarderHubOverhead,
  preRelayedCallGasLimit: preRelayedCallGasLimit,
  postRelayedCallGasLimit: 11e4,
  acceptanceBudget: preRelayedCallGasLimit + forwarderHubOverhead,
  calldataSizeLimit: 10020
}

export const environments: { [key: string]: Environment } = {
  istanbul: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    mintxgascost: 21000,
    gtxdatanonzero: 16,
    gtxdatazero: 4
  },
  constantinople: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    mintxgascost: 21000,
    gtxdatanonzero: 16,
    gtxdatazero: 4
  },
  ganacheLocal: {
    chainId: 1337,
    relayHubConfiguration: defaultRelayHubConfiguration,
    mintxgascost: 21000,
    gtxdatanonzero: 16,
    gtxdatazero: 4
  }
}

export const defaultEnvironment = environments.ganacheLocal
