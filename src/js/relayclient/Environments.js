/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */
const environments = {
  istanbul: {
    gtxdatanonzero: 16,
    gtxdatazero: 4,
    chainId: 1
  },
  constantinople: {
    gtxdatanonzero: 68,
    gtxdatazero: 4,
    chainId: 1
  }
}

environments.default = environments.istanbul

module.exports = environments
