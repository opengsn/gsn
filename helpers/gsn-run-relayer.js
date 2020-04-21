const program = require('commander')
const lodash = require('lodash')
const process = require('process')

program
  .option('-n, --ethereumNodeURL <url>', 'url to the local Ethereum node', 'http://localhost:8545')
  .option('--relayUrl <url>', 'url to advertise the relayer (defaults to localhost:8090)')
  .option('-p, --port <port>', 'port to bind the relayer to (defaults to port defined in url)')
  .option('--relayHubAddress <address>', 'address to the relay hub (deploys a new hub if not set)')
  .option('-f, --from <account>', 'account to send transactions from (defaults to first account with balance)')
  .option('--workdir <workdir>', 'working directory for relayer data (defaults to tmp dir)')
  .option('-q, --quiet', 'silence relayer process output')
  .option(
    '-d, --detach',
    'exit process after relayer is ready, and return relayer process pid, but remember to kill it yourself! (implies --quiet)'
  )
  .option('--no-register', 'skip registration of the relayer process')
  .option('--no-devMode', 'turns off dev mode in relayer')
  .option('--fee <percentage>', 'relayer\'s transaction fee (defaults to 70)')
  .parse(process.argv)

const { runRelayer, runAndRegister } = require('./src/run')
const opts = lodash.pick(program, [
  'detach',
  'workdir',
  'ethereumNodeURL',
  'relayUrl',
  'port',
  'relayHubAddress',
  'from',
  'devMode',
  'quiet',
  'fee'
])
if (opts.port && opts.relayUrl) {
  console.error(`Cannot set both port and relayUrl options. Please set only one.`)
  process.exit(1)
}

if (program.register === false) {
  runRelayer(opts)
  return
}

const Web3 = require('web3')
const web3 = new Web3(program.ethereumNodeURL)

web3.eth
  .getAccounts()
  .then(async () => {
    const subprocess = await runAndRegister(web3, opts)
    if (program.detach) {
      subprocess.unref()
      process.exit(0)
    }
  })
  .catch(err => {
    console.error(`Could not connect to node at ${program.ethereumNodeURL} (${err}).`)
  })
