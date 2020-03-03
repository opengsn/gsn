/**
 * We will need some mechanism to support different constants and algorithms for different networks.
 * So far the only conflict we will have is migration to Istanbul, as ETC does not integrate it as of this writing.
 * TODO: see the differences between networks we want to support and make project structure multi-chain
 */
module.exports = {
  istanbul: {
    gtxdatanonzero: 16
  },
  constantinople: {
    gtxdatanonzero: 68
  }
}
