const { getPaymasterAddress, getRelayHub } = require('./helpers')

async function balance (web3, options = {}) {
  options.paymaster = getPaymasterAddress(options.paymaster)

  const relayHub = getRelayHub(web3, options.hub)
  return relayHub.methods.balanceOf(options.paymaster).call()
}

module.exports = {
  balance
}
