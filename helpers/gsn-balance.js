const program = require('commander')
const lodash = require('lodash')
const fs = require('fs')

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--paymaster <address>', 'address of the paymaster contract or relayer owner')
  .option('--hub <address>', 'address of the hub contract')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'
const hub = program.hub || JSON.parse(fs.readFileSync('build/gsn/RelayHub.json')).address
const paymaster = program.paymaster || JSON.parse(fs.readFileSync('build/gsn/Paymaster.json')).address
const Web3 = require('web3')
const web3 = new Web3(nodeURL)

const { balance } = require('./src/balance')
const { fromWei } = require('./src/helpers')
balance(web3, {...lodash.pick(program, ['paymaster', 'hub']), hub, paymaster}).then(balance =>
  console.error(`Account ${paymaster} has a GSN balance of ${fromWei(balance)} ETH`)
)
