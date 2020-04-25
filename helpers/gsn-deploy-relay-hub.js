const program = require('commander')
const lodash = require('lodash')
const getWeb3 = require('./src/helpers').getWeb3

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('-f, --from <account>', 'account to send transactions from (defaults to first account with balance)')
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/gsn/)', 'build/gsn')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'

const web3 = getWeb3(nodeURL)

const { deployRelayHub } = require('./src/deploy')

const opts = lodash.pick(program, ['from', 'workdir'])
opts.verbose = true
deployRelayHub(web3, opts)
