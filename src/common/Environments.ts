/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */
import { RelayHubConfiguration } from './types/RelayHubConfiguration'

interface Environment {
  readonly chainId: number
  readonly mintxgascost: number
  readonly relayHubConfiguration: RelayHubConfiguration
}

export const defaultRelayHubConfiguration: RelayHubConfiguration = {
  gasOverhead: 33346,
  postOverhead: 13302,
  gasReserve: 100000,
  maxWorkerCount: 10,
  minimumStake: 1e18.toString(),
  minimumUnstakeDelay: 1000,
  maximumRecipientDeposit: 2e18.toString()
}

export const environments: { [key: string]: Environment } = {
  istanbul: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    mintxgascost: 21000
  },
  constantinople: {
    chainId: 1,
    relayHubConfiguration: defaultRelayHubConfiguration,
    mintxgascost: 21000
  },
  ganacheLocal: {
    chainId: 1337,
    relayHubConfiguration: defaultRelayHubConfiguration,
    mintxgascost: 21000
  }
}

export const defaultEnvironment = environments.ganacheLocal
