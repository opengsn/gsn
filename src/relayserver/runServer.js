#!/usr/bin/env node

const fs = require('fs')
const parseArgs = require('minimist')
const Web3 = require('web3')
const HttpServer = require('./HttpServer')
const RelayServer = require('./RelayServer')
const KeyManager = require('./KeyManager')
const TxStoreManager = require('./TxStoreManager').TxStoreManager
const TXSTORE_FILENAME = require('./TxStoreManager').TXSTORE_FILENAME

function error (err) { throw new Error(err) }
// use all camel-case entries from environment as defaults.
const envDefaults = Object.entries(process.env)
  .filter(([k]) => /^[A-Z][a-z][A-Za-z]*$/.test(k))
  .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {})

const argv = parseArgs(process.argv.slice(2), {
  string:
    [
      'BaseFee',
      'PercentFee',
      'Url',
      'RelayHubAddress',
      'DefaultGasPrice',
      'GasPricePercent',
      'RegistrationBlockRate',
      'EthereumNodeUrl',
      'Workdir'
    ],
  boolean: ['DevMode'],
  alias: {},
  default: envDefaults
})

if (argv._.length) error('unknown extra params: ' + argv._)

console.log('runServer start. args', argv)
const baseRelayFee = argv.BaseFee || 70
const pctRelayFee = argv.PercentFee || 0
const url = argv.Url || 'http://localhost:8090'
const port = argv.Port || 8090
const relayHubAddress = argv.RelayHubAddress || '0xD216153c06E857cD7f72665E0aF1d7D82172F494'
// const defaultGasPrice = argv.DefaultGasPrice || 1e9 // 1 Gwei
const gasPricePercent = argv.GasPricePercent || 10
// const registrationBlockRate = argv.RegistrationBlockRate || 6000 - 200
const ethereumNodeUrl = argv.EthereumNodeUrl || 'http://localhost:8545'
const workdir = argv.Workdir || error('missing Workdir')
const devMode = argv.DevMode || false
if (devMode) {
  if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
    fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`)
  }
}

const keyManager = new KeyManager({ count: 2, workdir })
const txStoreManager = new TxStoreManager({ workdir })
const web3provider = new Web3.providers.WebsocketProvider(ethereumNodeUrl)
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
  gasPriceFactor: gasPriceFactor,
  ethereumNodeUrl
})
console.log('Starting server.')
console.log(`server params:\nhub address: ${relayHubAddress} url: ${url} baseRelayFee: ${baseRelayFee} pctRelayFee: ${pctRelayFee} `)
const httpServer = new HttpServer({ port, backend: relay })
httpServer.start()
