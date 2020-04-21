const { defaultFromAccount, ether, getPaymasterAddress, getRelayHub } = require('./helpers')
// const { deployRelayHub } = require('./deploy')
const { merge } = require('lodash')

async function fundPaymaster (web3, options = {}) {
  const defaultOptions = {
    amount: ether('1'),
    from: await defaultFromAccount(web3, options && options.from),
    relayHubAddress: options.hub
  }

  options = merge(defaultOptions, options)

  options.paymaster = getPaymasterAddress(options.paymaster)

  // // Ensure relayHub is deployed on the local network
  // if (options.relayHubAddress.toLowerCase() === data.relayHub.address.toLowerCase()) {
  //   await deployRelayHub(web3, options);
  // }
  const relayHub = getRelayHub(web3, options.relayHubAddress)

  // I hate js. Use Math.round() instead of parseInt() to support exponent i.e. 1e18
  const targetAmount = new web3.utils.BN(Math.round(options.amount).toString())
  const currentBalance = new web3.utils.BN(await relayHub.methods.balanceOf(options.paymaster).call())
  if (currentBalance.lt(targetAmount)) {
    const value = targetAmount.sub(currentBalance)
    await relayHub.methods.depositFor(options.paymaster).send({ value, from: options.from })
    return targetAmount
  } else {
    return currentBalance
  }
}

module.exports = {
  fundPaymaster
}
