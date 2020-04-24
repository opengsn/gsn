const program = require('commander')
const lodash = require('lodash')

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--from <address>', 'account to withdraw funds from (paymaster/relay manager)')
  .option('--to <address>', 'account to send the withdrawn the funds to (defaults to --from)')
  .option('--amount <amount>', 'how much to withdraw, in wei (defaults to the whole --from balance)')
  .option('--hub <address>', 'address of the hub contract')
  .parse(process.argv)

const nodeURL = program.ethereumNodeURL !== undefined ? program.ethereumNodeURL : 'http://localhost:8545'

const Web3 = require('web3')
const web3 = new Web3(nodeURL)

const { withdraw } = require('./src/withdraw')
const { fromWei } = require('./src/helpers')
withdraw(web3, lodash.pick(program, ['from', 'to', 'amount', 'hub'])).then(opts =>
  console.error(
    `Withdrew ${fromWei(opts.amount)} ETH from ${opts.from} and sent to ${opts.to}, remaining GSN balance is ${fromWei(
      opts.remaining
    )} ETH`
  )
)
