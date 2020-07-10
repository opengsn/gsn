// TODO: convert to 'commander' format
import fs from 'fs'
import parseArgs from 'minimist'
import Web3 from 'web3'
import { HttpServer } from './HttpServer'
import { RelayServer, RelayServerParams } from './RelayServer'
import { KeyManager } from './KeyManager'
import { TxStoreManager, TXSTORE_FILENAME } from './TxStoreManager'
import { getRelayHubAddress } from '../cli/utils'
import ContractInteractor from '../relayclient/ContractInteractor'
import { configureGSN } from '../relayclient/GSNConfigurator'

export interface ServerConfigParams {
  baseRelayFee?: number | string
  pctRelayFee?: number | string
  url?: string
  port?: number | string
  relayHubAddress?: string
  gasPricePercent?: number | string
  ethereumNodeUrl?: string
  workdir?: string
  devMode?: boolean
  debug?: boolean
}

function error (err: string): void {
  console.error(err)
  process.exit(1)
}

// use all camel-case entries from environment as defaults.
const envDefaults = Object.entries(process.env)
  .filter(([k]) => /^[a-z][A-Za-z]*$/.test(k))
  .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {})

const argv = parseArgs(process.argv.slice(2), {
  string:
    [
      'config',
      'baseRelayFee',
      'pctRelayFee',
      'url',
      'port',
      'relayHubAddress',
      'gasPricePercent',
      'ethereumNodeUrl',
      'workdir'
    ],
  boolean: ['devMode', 'debug'],
  alias: {},
  default: envDefaults
})

if (argv._.length > 0) error(`unknown extra params: ${argv._.toString()}`)

console.log('runServer start. args', argv)
let config: ServerConfigParams = {}
if (argv.config != null && fs.existsSync(argv.config)) {
  config = JSON.parse(fs.readFileSync(argv.config, 'utf8'))
}
const baseRelayFee: string = argv.baseRelayFee ?? config.baseRelayFee?.toString() ?? error('missing --baseRelayFee')
const pctRelayFee: string = argv.pctRelayFee ?? config.pctRelayFee?.toString() ?? error('missing --pctRelayFee')
const url: string = argv.url ?? config.url ?? error('missing --url')
const port: string = argv.port ?? config.port?.toString() ?? error('missing --port')
const relayHubAddress: string = getRelayHubAddress(argv.relayHubAddress) as string ?? config.relayHubAddress ?? error('missing --relayHubAddress')
const gasPricePercent: string = argv.gasPricePercent ?? config.gasPricePercent?.toString() ?? error('missing --gasPricePercent')
const ethereumNodeUrl: string = argv.ethereumNodeUrl ?? config.ethereumNodeUrl ?? error('missing --ethereumNodeUrl')
const workdir: string = argv.workdir ?? config.workdir ?? error('missing --workdir')
const devMode: boolean = argv.devMode ?? config.devMode ?? error('missing --devMode')
const debug: boolean = argv.debug ?? config.debug ?? error('missing --debug')
if (devMode) {
  if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
    fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`)
  }
}

const managerKeyManager = new KeyManager(1, workdir + '/manager')
const workersKeyManager = new KeyManager(1, workdir + '/workers')
const txStoreManager = new TxStoreManager({ workdir })
const web3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
const interactor = new ContractInteractor(web3provider,
  configureGSN({}))
const gasPriceFactor = (parseInt(gasPricePercent) + 100) / 100
const params = {
  txStoreManager,
  managerKeyManager,
  workersKeyManager,
  hubAddress: relayHubAddress,
  contractInteractor: interactor,
  url,
  baseRelayFee: parseInt(baseRelayFee),
  pctRelayFee: parseInt(pctRelayFee),
  devMode,
  debug: debug,
  gasPriceFactor: gasPriceFactor
}
const relay = new RelayServer(params as RelayServerParams)
console.log('Starting server.')
console.log(
  `server params:\nhub address: ${relayHubAddress} url: ${url} baseRelayFee: ${baseRelayFee} pctRelayFee: ${pctRelayFee} `)
const httpServer = new HttpServer(parseInt(port), relay)
httpServer.start()
