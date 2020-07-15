/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */

class Environment {
  public readonly chainId: number
  public readonly mintxgascost: number

  constructor (env: Environment) {
    this.chainId = env.chainId
    this.mintxgascost = env.mintxgascost
  }
}

export const environments = {
  istanbul: new Environment({
    chainId: 1,
    mintxgascost: 21000
  }),
  constantinople: new Environment({
    chainId: 1,
    mintxgascost: 21000
  })
}

export const relayHubConfiguration = {
  GAS_OVERHEAD: 34914,
  POST_OVERHEAD: 10572,
  GAS_RESERVE: 100000,
  MAX_WORKER_COUNT: 10,
  MINIMUM_STAKE: 1e18.toString(),
  MINIMUM_UNSTAKE_DELAY: 1000,
  MINIMUM_RELAY_BALANCE: 1e17.toString(),
  MAXIMUM_RECIPIENT_DEPOSIT: 2e18.toString()
}

export const defaultEnvironment = environments.istanbul
