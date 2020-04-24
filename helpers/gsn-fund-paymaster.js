const program = require('commander')
const lodash = require('lodash')
const fs = require('fs')

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--paymaster <address>',
    'address of the paymaster contract (defaults to address from build/gsn/Paymaster.json if exists')
  .option('--amount <amount>', 'amount of funds to deposit for the paymaster contract, in wei (defaults to 1 Ether)')
  .option('-f, --from <account>', 'account to send transactions from (defaults to first account with balance)')
  .option('--hub <address>',
    'address of the RelayHub contract (defaults to address from build/gsn/RelayHub.json if exists')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'
const hub = program.hub || JSON.parse(fs.readFileSync('build/gsn/RelayHub.json')).address
const paymaster = program.paymaster || JSON.parse(fs.readFileSync('build/gsn/Paymaster.json')).address
const Web3 = require('web3')
const web3 = new Web3(nodeURL)

const { fundPaymaster } = require('./src/fund')
fundPaymaster(web3, { ...lodash.pick(program, ['from', 'paymaster', 'amount', 'hub']), hub, paymaster }).then(balance =>
  console.error(`Paymaster ${paymaster} balance is now ${balance.toString()} wei`)
)
