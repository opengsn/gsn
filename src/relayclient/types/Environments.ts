/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */

class Environment {
  public readonly gtxdatanonzero: number
  public readonly gtxdatazero: number
  public readonly chainId: number
  public readonly mintxgascost: number

  constructor (env: Environment) {
    this.gtxdatanonzero = env.gtxdatanonzero
    this.gtxdatazero = env.gtxdatazero
    this.chainId = env.chainId
    this.mintxgascost = env.mintxgascost
  }
}

export const environments = {
  istanbul: new Environment({
    gtxdatanonzero: 16,
    gtxdatazero: 4,
    chainId: 1,
    mintxgascost: 21000
  }),
  constantinople: new Environment({
    gtxdatanonzero: 68,
    gtxdatazero: 4,
    chainId: 1,
    mintxgascost: 21000
  })
}

export const defaultEnvironment = environments.istanbul
