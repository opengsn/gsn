#!/usr/bin/env node
// helper script, to fund a meta-mask account when working with ganache.

const Web3 = require('web3')
const url = process.env.URL
const ethvalue = process.argv[2]
const destaddrs = process.argv[3]
const acct = process.argv[4] || 0
if (!ethvalue || !destaddrs) {
  console.log('usage:', process.argv[1], ' {ethvalue} {destaddr} [fromacct] ')
  process.exit(1)
}

const value = ethvalue * 1e18
const web3 = new Web3(new Web3.providers.HttpProvider(url || 'http://localhost:8545'))
web3.eth.getAccounts().then((accounts) => {
  const from = accounts[acct]
  for (const to of destaddrs.split(',')) {
    web3.eth.getBalance(to).then(res => {
      if (web3.utils.toBN(res).cmp(web3.utils.toBN(value)) > 0) {
        console.log('Account is already funded', to)
        return
      }
      web3.eth.sendTransaction({ from, to, value }, (e, r) => {
        if (e) {
          console.log('Failed to transfer', e)
        } else {
          console.log('Successfully funded', to)
        }
      })
    })
  }
})
