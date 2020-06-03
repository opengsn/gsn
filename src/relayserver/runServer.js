// TODO: convert to 'commander' format
const fs = require('fs')
const parseArgs = require('minimist')
const Web3 = require('web3')
const HttpServer = require('./HttpServer').HttpServer
const RelayServer = require('./RelayServer').RelayServer
const KeyManager = require('./KeyManager').KeyManager
const TxStoreManager = require('./TxStoreManager').TxStoreManager
const TXSTORE_FILENAME = require('./TxStoreManager').TXSTORE_FILENAME
const getRelayHubAddress = require('../cli/utils').getRelayHubAddress

function error (err) {
  console.error(err)
  process.exit(1)
}

// use all camel-case entries from environment as defaults.
const envDefaults = Object.entries(process.env)
  .filter(([k]) => /^[A-Z][a-z][A-Za-z]*$/.test(k))
  .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {})

const argv = parseArgs(process.argv.slice(2), {
  string:
    [
      'config',
      'baseRelayFee',
      'pctRelayFee',
      'url',
      'relayHubAddress',
      'defaultGasPrice',
      'gasPricePercent',
      'ethereumNodeUrl',
      'workdir'
    ],
  boolean: ['devMode', 'debug'],
  alias: {},
  default: envDefaults
})

if (argv._.length) error('unknown extra params: ' + argv._)

console.log('runServer start. args', argv)
const config = argv.config ? require(argv.config) : error('missing --config')
const baseRelayFee = argv.baseRelayFee || config.baseRelayFee
const pctRelayFee = argv.pctRelayFee || config.pctRelayFee
const url = argv.url || config.url
const port = argv.port || config.port
const relayHubAddress = getRelayHubAddress(argv.relayHubAddress) || config.relayHubAddress || error('missing --RelayHubAddress')
const gasPricePercent = argv.gasPricePercent || config.gasPricePercent
const ethereumNodeUrl = argv.ethereumNodeUrl || config.ethereumNodeUrl
const workdir = argv.workdir || config.workdir || error('missing --Workdir')
const devMode = argv.devMode || config.devMode
const Debug = argv.debug || config.debug
if (devMode) {
  if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
    fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`)
  }
}

const keyManager = new KeyManager(2, workdir)
const txStoreManager = new TxStoreManager({ workdir })
const web3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
const gasPriceFactor = (parseInt(gasPricePercent) + 100) / 100
const relay = new RelayServer({
  txStoreManager,
  keyManager,
  hubAddress: relayHubAddress,
  web3provider,
  url,
  baseRelayFee: baseRelayFee,
  pctRelayFee: pctRelayFee,
  devMode,
  Debug,
  gasPriceFactor: gasPriceFactor
})
console.log('Starting server.')
console.log(
  `server params:\nhub address: ${relayHubAddress} url: ${url} baseRelayFee: ${baseRelayFee} pctRelayFee: ${pctRelayFee} `)
const httpServer = new HttpServer(port, relay)
httpServer.start()
