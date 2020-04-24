const program = require('commander')
const lodash = require('lodash')
const fs = require('fs')

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--relayUrl <url>', 'url to advertise the relayer (defaults to localhost:8090)')
  .option('--hub <address>',
    'address of the RelayHub contract (defaults to address from build/gsn/RelayHub.json if exists')
  .option('--stake <stake>', 'amount to stake for the relayer, in wei (defaults to 1 Ether)')
  .option(
    '--unstakeDelay <delay>',
    'time to wait between deregistering and withdrawing the stake, in seconds (defaults to one week)'
  )
  .option(
    '--funds <funds>',
    'amount to transfer to the relayer to pay for relayed transactions, in wei (defaults to 5 Ether)'
  )
  .option('-f, --from <account>', 'account to send transactions from (defaults to first account with balance)')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'
const hub = program.hub || JSON.parse(fs.readFileSync('build/gsn/RelayHub.json')).address
const Web3 = require('web3')
const web3 = new Web3(nodeURL)

const { registerRelay } = require('./src/register')
registerRelay(web3, { ...lodash.pick(program, ['relayUrl', 'hub', 'stake', 'unstakeDelay', 'funds', 'from']), hub })
