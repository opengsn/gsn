/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */
import { RelayHubConfiguration } from '../relayclient/types/RelayHubConfiguration'

interface Environment {
  readonly chainId: number
  readonly mintxgascost: number
  readonly relayHubConfiguration: RelayHubConfiguration
}

const defaultRelayHubConfiguration: RelayHubConfiguration = {
  gasOverhead: 35951,
  postOverhead: 13950,
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
  }
}

export const defaultEnvironment = environments.istanbul
