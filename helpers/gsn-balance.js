const program = require('commander')
const lodash = require('lodash')

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--paymaster <address>', 'address of the paymaster contract or relayer owner')
  .option('--hub <address>', 'address of the hub contract')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'

const Web3 = require('web3')
const web3 = new Web3(nodeURL)

const { balance } = require('./src/balance')
const { fromWei } = require('./src/helpers')
balance(web3, lodash.pick(program, ['paymaster', 'hub'])).then(balance =>
  console.error(`Account ${program.paymaster} has a GSN balance of ${fromWei(balance)} ETH`)
)
