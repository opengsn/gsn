// TODO: convert to 'commander' format
import fs from 'fs'
import Web3 from 'web3'
import { HttpServer } from './HttpServer'
import { RelayServer } from './RelayServer'
import { KeyManager } from './KeyManager'
import { TxStoreManager, TXSTORE_FILENAME } from './TxStoreManager'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import {
  parseServerConfig,
  resolveReputationManagerConfig,
  resolveServerConfig,
  ServerConfigParams,
  ServerDependencies
} from './ServerConfigParams'
import { createServerLogger } from './ServerWinstonLogger'
import { PenalizerDependencies, PenalizerService } from './penalizer/PenalizerService'
import { TransactionManager } from './TransactionManager'
import { EtherscanCachedService } from './penalizer/EtherscanCachedService'
import { TransactionDataCache, TX_PAGES_FILENAME, TX_STORE_FILENAME } from './penalizer/TransactionDataCache'
import { GasPriceFetcher } from './GasPriceFetcher'
import { ReputationManager, ReputationManagerConfiguration } from './ReputationManager'
import { REPUTATION_STORE_FILENAME, ReputationStoreManager } from './ReputationStoreManager'
import { gsnRequiredVersion, gsnRuntimeVersion, VersionsManager } from '@opengsn/common'

function error (err: string): never {
  console.error(err)
  process.exit(1)
}

async function run (): Promise<void> {
  let config: ServerConfigParams
  let web3provider
  let runPenalizer: boolean
  let reputationManagerConfig: Partial<ReputationManagerConfiguration>
  let runPaymasterReputations: boolean
  console.log('Starting GSN Relay Server process...\n')
  try {
    console.log('Parsing server config...\n')
    const conf = await parseServerConfig(process.argv.slice(2), process.env)
    if (conf.ethereumNodeUrl == null) {
      error('missing ethereumNodeUrl')
    }
    const loggingProvider: boolean = conf.loggingProvider ?? false
    web3provider = new Web3.providers.HttpProvider(conf.ethereumNodeUrl)
    if (loggingProvider) {
      const orig = web3provider
      web3provider = {
        // @ts-ignore
        send (r, cb) {
          const now = Date.now()
          console.log('>>> ', r)
          // eslint-disable-next-line
          if (r && r.params && r.params[0] && r.params[0].topics) {
            console.log('>>> ', r.params[0].topics)
          }
          // eslint-disable-next-line
          if (r && r.params && r.params[0] && r.params[0].fromBlock == 1 ) {
            console.log('=== big wait!')
          }
          orig.send(r, (err, res) => {
            console.log('<<<', Date.now() - now, err, res)
            cb(err, res)
          })
        }
      }
    }
    console.log('Resolving server config ...\n')
    config = await resolveServerConfig(conf, web3provider) as ServerConfigParams
    runPenalizer = config.runPenalizer
    console.log('Resolving reputation manager config...\n')
    reputationManagerConfig = resolveReputationManagerConfig(conf)
    runPaymasterReputations = config.runPaymasterReputations
  } catch (e) {
    error(e.message)
  }
  const { devMode, workdir } = config
  if (devMode) {
    if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
      fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`)
    }
    if (fs.existsSync(`${workdir}/${REPUTATION_STORE_FILENAME}`)) {
      fs.unlinkSync(`${workdir}/${REPUTATION_STORE_FILENAME}`)
    }
    if (fs.existsSync(`${workdir}/${TX_STORE_FILENAME}`)) {
      fs.unlinkSync(`${workdir}/${TX_STORE_FILENAME}`)
    }
    if (fs.existsSync(`${workdir}/${TX_PAGES_FILENAME}`)) {
      fs.unlinkSync(`${workdir}/${TX_PAGES_FILENAME}`)
    }
  }
  console.log('Creating server logger...\n')
  const logger = createServerLogger(config.logLevel, config.loggerUrl, config.loggerUserId)
  console.log('Creating managers...\n')
  const managerKeyManager = new KeyManager(1, workdir + '/manager')
  const workersKeyManager = new KeyManager(1, workdir + '/workers')
  const txStoreManager = new TxStoreManager({ workdir, autoCompactionInterval: config.dbAutoCompactionInterval }, logger)
  console.log('Creating interactor...\n')
  const contractInteractor = new ContractInteractor({
    provider: web3provider,
    logger,
    maxPageSize: config.pastEventsQueryMaxPageSize,
    versionManager: new VersionsManager(gsnRuntimeVersion, config.requiredVersionRange ?? gsnRequiredVersion),
    deployment: { relayHubAddress: config.relayHubAddress }
  })
  console.log('Initializing interactor...\n')
  await contractInteractor.init()
  console.log('Creating gasPrice fetcher...\n')
  const gasPriceFetcher = new GasPriceFetcher(config.gasPriceOracleUrl, config.gasPriceOraclePath, contractInteractor, logger)
  let reputationManager: ReputationManager | undefined
  if (runPaymasterReputations) {
    console.log('Running paymaster reputation: creating reputation manager ...\n')
    const reputationStoreManager = new ReputationStoreManager({ workdir, inMemory: true }, logger)
    reputationManager = new ReputationManager(reputationStoreManager, logger, reputationManagerConfig)
  }

  const dependencies: ServerDependencies = {
    logger,
    txStoreManager,
    reputationManager,
    managerKeyManager,
    workersKeyManager,
    contractInteractor,
    gasPriceFetcher
  }
  console.log('Creating Transaction Manager...\n')
  const transactionManager: TransactionManager = new TransactionManager(dependencies, config)

  let penalizerService: PenalizerService | undefined
  if (runPenalizer) {
    console.log('Running Penalizer: creating transaction data cache...\n')
    const transactionDataCache: TransactionDataCache = new TransactionDataCache(logger, config.workdir)

    console.log('Running Penalizer: creating etherscan cached service...\n')
    const txByNonceService = new EtherscanCachedService(config.etherscanApiUrl, config.etherscanApiKey, logger, transactionDataCache)
    const penalizerParams: PenalizerDependencies = {
      transactionManager,
      contractInteractor,
      txByNonceService
    }
    console.log('Running Penalizer: creating penalizer service...\n')
    penalizerService = new PenalizerService(penalizerParams, logger, config)
    console.log('Running Penalizer: initializing penalizer service...\n')
    await penalizerService.init()
  }
  console.log('Creating relay server...\n')
  const relay = new RelayServer(config, transactionManager, dependencies)
  console.log('Initializing penalizer service...\n')
  await relay.init()
  console.log('Creating http server...\n')
  const httpServer = new HttpServer(config.port, logger, relay, penalizerService)
  httpServer.start()
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
