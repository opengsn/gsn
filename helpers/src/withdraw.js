const { getRelayHub } = require('./helpers')
const { balance } = require('./balance')
const { merge } = require('lodash')

async function withdraw (web3, options = {}) {
  const defaultOptions = {
    to: options.from,
    amount: await balance(web3, { paymaster: options.from })
  }

  options = merge(defaultOptions, options)

  const relayHub = getRelayHub(web3)
  await relayHub.methods.withdraw(options.amount, options.to).send({ from: options.from })

  return {
    from: options.from,
    to: options.to,
    amount: options.amount,
    remaining: await balance(web3, { paymaster: options.from })
  }
}

module.exports = {
  withdraw
}
