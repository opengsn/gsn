const program = require('commander')
const lodash = require('lodash')
const fs = require('fs')
const getWeb3 = require('./src/helpers').getWeb3

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--relayUrl <url>', 'url to advertise the relayer (defaults to localhost:8090)')
  .option('--hub <address>',
    'address of the RelayHub contract (defaults to address from build/gsn/RelayHub.json if exists')
  .option('--stake <stake>', 'amount to stake for the relayer, in wei (defaults to 1 Ether)')
  .option(
    '--unstakeDelay <delay>',
    'blocks to wait between deregistering and withdrawing the stake (defaults to one 1000)'
  )
  .option(
    '--funds <funds>',
    'amount to transfer to the relayer to pay for relayed transactions, in wei (defaults to 5 Ether)'
  )
  .option('-f, --from <account>', 'account to send transactions from (defaults to first account with balance)')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'
const hub = program.hub || JSON.parse(fs.readFileSync('build/gsn/RelayHub.json')).address
const web3 = getWeb3(nodeURL)

const { registerRelay } = require('./src/register')
registerRelay(web3, { ...lodash.pick(program, ['relayUrl', 'hub', 'stake', 'unstakeDelay', 'funds', 'from']), hub })
