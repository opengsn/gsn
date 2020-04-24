const fs = require('fs')
const axios = require('axios')
const sleep = require('../../src/common/utils').sleep
const utils = require('web3').utils
const { merge } = require('lodash')

// compiled folder populated by "prepublish"
const compiledFolder = '../compiled/'
const relayHub = require( compiledFolder+'RelayHub.json')
const stakeManager = require( compiledFolder+'StakeManager.json')
const penalizer = require( compiledFolder+'Penalizer.json')
const paymaster = require( compiledFolder+'TestPaymasterEverythingAccepted.json' )

const ether = function (value) {
  return new utils.BN(utils.toWei(value, 'ether'))
}

const fromWei = function (wei) {
  return utils.fromWei(wei, 'ether')
}

async function defaultFromAccount (web3, from = null) {
  if (from) return from
  const requiredBalance = ether('10')

  try {
    const accounts = await web3.eth.getAccounts()
    for (const account of accounts) {
      const balance = new web3.utils.BN(await web3.eth.getBalance(account))
      if (balance.gte(requiredBalance)) {
        return account
      }
    }
  } catch (error) {
    throw Error(`Failed to retrieve accounts and balances: ${error}`)
  }

  throw Error(`Found no accounts with sufficient balance (${requiredBalance} wei)`)
}

async function waitForRelay (relayUrl) {
  const timeout = 30
  console.error(`Will wait up to ${timeout}s for the relay to be ready`)

  for (let i = 0; i < timeout; ++i) {
    await sleep(1000)

    if (await isRelayReady(relayUrl)) {
      return
    }
  }

  throw Error(`Relay not ready after ${timeout}s`)
}

async function isRelayReady (relayUrl) {
  const response = await axios.get(`${relayUrl}/getaddr`)
  return response.data.Ready
}

function getPaymasterAddress (paymaster) {
  if (!paymaster) throw new Error('paymaster address not set')
  if (typeof paymaster !== 'string') {
    if (paymaster.address) return paymaster.address
    else if (paymaster.options && paymaster.options.address) return paymaster.options.address
  }
  return paymaster
}

function getRelayHub (web3, address, options = {}) {
  return new web3.eth.Contract(relayHub.abi, address, {
    data: relayHub.bytecode,
    ...options
  })
}

function getStakeManager (web3, address, options = {}) {
  return new web3.eth.Contract(stakeManager.abi, address, {
    data: stakeManager.bytecode,
    ...options
  })
}

function getPenalizer (web3, address, options = {}) {
  return new web3.eth.Contract(penalizer.abi, address, {
    data: penalizer.bytecode,
    ...options
  })
}

function getPaymaster (web3, address, options = {}) {
  return new web3.eth.Contract(paymaster.abi, address, {
    data: paymaster.bytecode,
    ...options
  })
}

function saveContractToFile (contract, workdir, filename) {
  fs.mkdirSync(workdir, { recursive: true })
  fs.writeFileSync(workdir + '/' + filename, `{ "address": "${contract.options.address}" }`)
}

async function isRelayHubDeployed (web3, hubAddress) {
  const code = await web3.eth.getCode(hubAddress)
  return code.length > 2
}

module.exports = {
  defaultFromAccount,
  ether,
  fromWei,
  getPaymasterAddress,
  getRelayHub,
  getStakeManager,
  getPenalizer,
  getPaymaster,
  isRelayHubDeployed,
  isRelayReady,
  waitForRelay,
  saveContractToFile
}
