const fs = require('fs')
const parseArgs = require('minimist')
const Web3 = require('web3')
const HttpServer = require('./HttpServer')
const RelayServer = require('./RelayServer')
const KeyManager = require('./KeyManager')

function error (err) { throw new Error(err) }

const argv = parseArgs(process.argv.slice(2), {
  string: ['Fee', 'Url', 'RelayHubAddress', 'DefaultGasPrice',
           'GasPricePercent',
           'RegistrationBlockRate', 'EthereumNodeUrl', 'Workdir'],
  boolean: ['DevMode'],
  alias: {}
})

if (argv._.length) error('unknown extra params: ' + argv._)

const fee = argv.Fee || 70
const url = argv.Url || 'http://localhost:8090'
const port = argv.Port || 80
const relayHubAddress = argv.RelayHubAddress || '0xD216153c06E857cD7f72665E0aF1d7D82172F494'
const defaultGasPrice = argv.DefaultGasPrice || 1e9 // 1 Gwei
const gasPricePercent = argv.GasPricePercent || 10
const registrationBlockRate = argv.RegistrationBlockRate || 6000 - 200
const ethereumNodeUrl = argv.EthereumNodeUrl || 'http://localhost:8545'
const workdir = argv.Workdir || error('missing Workdir')
const devMode = argv.DevMode || false

let keypair
try {
  keypair = JSON.parse(fs.readFileSync(`${workdir}/keystore`)).ecdsaKeyPair
  keypair.privateKey = Buffer.from(keypair.privateKey)
  console.log('Using saved keypair')
} catch (e) {
  keypair = KeyManager.newKeypair()
}
const keyManager = new KeyManager({ ecdsaKeyPair: keypair, workdir })
const web3provider = new Web3.providers.WebsocketProvider(ethNodeUrl)
const relay = new RelayServer({
  keyManager,
  hubAddress: relayHubAddress,
  web3provider,
  url,
  txFee: fee,
  devMode,
  gasPriceFactor: (gasPricePercent + 100) / 100,
  ethereumNodeUrl
})
console.log('Starting server.')
const httpServer = new HttpServer({ port, backend: relay })
httpServer.start()