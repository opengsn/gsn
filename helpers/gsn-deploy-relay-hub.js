const program = require('commander')
const lodash = require('lodash')

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('-f, --from <account>', 'account to send transactions from (defaults to first account with balance)')
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'

const Web3 = require('web3')
const web3 = new Web3(nodeURL)

const { deployRelayHub } = require('./src/deploy')

const opts = lodash.pick(program, ['from', 'workdir'])
opts.verbose = true
deployRelayHub(web3, opts).then(address => console.log(address))
