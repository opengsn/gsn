// TODO: convert to 'commander' format
import fs from 'fs'
import Web3 from 'web3'
import { HttpServer } from './HttpServer'
import { RelayServer, RelayServerParams } from './RelayServer'
import { KeyManager } from './KeyManager'
import { TxStoreManager, TXSTORE_FILENAME } from './TxStoreManager'
import ContractInteractor from '../relayclient/ContractInteractor'
import { configureGSN } from '../relayclient/GSNConfigurator'
import { parseServerConfig, resolveServerConfig, ServerConfigParams } from './ServerConfigParams'

/*
added:
  alertedBlockDelay?: number
*/
function error (err: string): never {
  console.error(err)
  process.exit(1)
}

async function run (): Promise<void> {
  let config: ServerConfigParams
  let web3provider
  try {
    const conf = await parseServerConfig(process.argv.slice(2), process.env)
    if (conf.ethereumNodeUrl == null) {
      error('missing ethereumNodeUrl')
    }
    web3provider = new Web3.providers.HttpProvider(conf.ethereumNodeUrl)
    config = await resolveServerConfig(conf, web3provider) as ServerConfigParams
  } catch (e) {
    error(e.message)
  }
  const { devMode, workdir } = config
  if (devMode) {
    if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
      fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`)
    }
  }

  const managerKeyManager = new KeyManager(1, workdir + '/manager')
  const workersKeyManager = new KeyManager(1, workdir + '/workers')
  const txStoreManager = new TxStoreManager({ workdir })
  const gasPriceFactor = (config.gasPricePercent + 100) / 100
  const { relayHubAddress, baseRelayFee, pctRelayFee, port, url } = config
  const contractInteractor = new ContractInteractor(web3provider, configureGSN({ relayHubAddress: config.relayHubAddress}))

  const params = {
    contractInteractor,
    txStoreManager,
    managerKeyManager,
    workersKeyManager,
    hubAddress: relayHubAddress,
    gasPriceFactor,
    ...config
  }

  const relay = new RelayServer(params as RelayServerParams)
  console.log('Starting server.')
  console.log('Using server config:', config)
  console.log(
    `server params:\nhub address: ${relayHubAddress} url: ${url} baseRelayFee: ${baseRelayFee} pctRelayFee: ${pctRelayFee} `)
  const httpServer = new HttpServer(port, relay)
  httpServer.start()
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
