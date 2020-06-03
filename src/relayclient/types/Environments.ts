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

export const defaultEnvironment = environments.istanbul
