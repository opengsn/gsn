const { defaultFromAccount, ether, isRelayReady, waitForRelay, getStakeManager, getRelayHub } = require('./helpers')
const { merge } = require('lodash')
const axios = require('axios')

async function registerRelay (web3, options = {}) {
  const defaultOptions = {
    relayUrl: 'http://localhost:8090',
    stake: ether('1'),
    unstakeDelay: 604800, // 1 week
    funds: ether('5'),
    from: await defaultFromAccount(web3, options && options.from)
  }

  options = merge(defaultOptions, options)

  try {
    if (await isRelayReady(options.relayUrl)) {
      return
    }
  } catch (error) {
    throw Error(`Could not reach the relay at ${options.relayUrl}, is it running?`)
  }

  try {
    console.error(`Funding GSN relay at ${options.relayUrl}`)

    const response = await axios.get(`${options.relayUrl}/getaddr`)
    const relayAddress = response.data.RelayManagerAddress
    console.log('relay server', relayAddress)
    const relayHub = getRelayHub(web3, options.hub)
    console.log('hub', relayHub.options.address)
    const stakeManagerAddress = await relayHub.methods.getStakeManager().call()
    console.log('stake manager ', stakeManagerAddress)
    const stakeManager = getStakeManager(web3, stakeManagerAddress)
    await stakeManager.methods
      .stakeForAddress(relayAddress, options.unstakeDelay.toString())
      .send({ value: options.stake, from: options.from })
    await stakeManager.methods
      .authorizeHub(relayAddress, options.hub)
      .send({ from: options.from })
    await web3.eth.sendTransaction({
      from: options.from,
      to: relayAddress,
      value: options.funds
    })

    await waitForRelay(options.relayUrl)

    console.error(`Relay is funded and ready!`)
  } catch (error) {
    throw Error(`Failed to fund relay: '${error}'`)
  }
}

module.exports = {
  registerRelay
}
