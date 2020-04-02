#!/usr/bin/env node
const Web3 = require('web3')

const promisify = require('util').promisify

const request = promisify(require('request'))

const irelayhub = require('../src/relayclient/IRelayHub')

async function fundrelay (hubaddr, relayaddr, fromaddr, fund, stake, unstakeDelay, web3) {
  const rhub = new web3.eth.Contract(irelayhub, hubaddr)
  const curstake = (await rhub.methods.getRelay(relayaddr).call()).totalStake

  if (curstake > 1e18) {
    console.log('already has a stake of ' + (curstake / 1e18) + ' eth. NOT adding more')
  } else {
    console.log('staking ', stake)
    console.log(await rhub.methods.stake(relayaddr, unstakeDelay).send({ value: stake, from: fromaddr, gas: 8000000 }))
  }

  const balance = await web3.eth.getBalance(relayaddr)
  if (balance > 1e17) {
    console.log('already has a balance of ' + (stake / 1e18) + ' eth. NOT adding more')
  } else {
    const ret = await new Promise((resolve, reject) => {
      web3.eth.sendTransaction({ from: fromaddr, to: relayaddr, value: fund, gas: 1e6 }, (e, r) => {
        if (e) reject(e)
        else resolve(r)
      })
    })
    console.log(ret)
  }
}

async function run () {
  const hubaddr = process.argv[2]
  let relay = process.argv[3]
  const ethNodeUrl = process.argv[5] || 'http://localhost:8545'

  console.log({ relay, hubaddr, ethNodeUrl })
  if (relay.indexOf('http') === 0) {
    const res = await request(relay + '/getaddr')
    relay = JSON.parse(res.body).RelayServerAddress
  }

  const fromaccount = process.argv[4] || 0

  if (!relay) {
    console.log('usage: fundrelay.js {hubaddr} {relayaddr/url} {from-account}')
    console.log('stake amount is fixed on 1 eth, delay 30 seconds')
    process.exit(1)
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(ethNodeUrl))

  const accounts = await web3.eth.getAccounts()
  fundrelay(hubaddr, relay, accounts[fromaccount], 1.1e18, 1.1e18, 3600 * 24 * 7, web3)
}

run()
