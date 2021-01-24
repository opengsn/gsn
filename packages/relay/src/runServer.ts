// TODO: convert to 'commander' format
import fs from 'fs'
import Web3 from 'web3'
import { HttpServer } from './HttpServer'
import { RelayServer } from './RelayServer'
import { KeyManager } from './KeyManager'
import { TxStoreManager, TXSTORE_FILENAME } from './TxStoreManager'
import ContractInteractor from '@opengsn/common/dist/ContractInteractor'
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
    const conf = await parseServerConfig(process.argv.slice(2), process.env)
    if (conf.ethereumNodeUrl == null) {
      error('missing ethereumNodeUrl')
    }
    web3provider = new Web3.providers.HttpProvider(conf.ethereumNodeUrl)
    config = await resolveServerConfig(conf, web3provider) as ServerConfigParams
    runPenalizer = config.runPenalizer
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

  const logger = createServerLogger(config.logLevel, config.loggerUrl, config.loggerUserId)
  const managerKeyManager = new KeyManager(1, workdir + '/manager')
  const workersKeyManager = new KeyManager(1, workdir + '/workers')
  const txStoreManager = new TxStoreManager({ workdir }, logger)
  const contractInteractor = new ContractInteractor({
    provider: web3provider,
    logger,
    deployment: { relayHubAddress: config.relayHubAddress }
  })
  await contractInteractor.init()
  const gasPriceFetcher = new GasPriceFetcher(config.gasPriceOracleUrl, config.gasPriceOraclePath, contractInteractor, logger)

  let reputationManager: ReputationManager | undefined
  if (runPaymasterReputations) {
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

  const transactionManager: TransactionManager = new TransactionManager(dependencies, config)

  let penalizerService: PenalizerService | undefined
  if (runPenalizer) {
    const transactionDataCache: TransactionDataCache = new TransactionDataCache(logger, config.workdir)

    const txByNonceService = new EtherscanCachedService(config.etherscanApiUrl, config.etherscanApiKey, logger, transactionDataCache)
    const penalizerParams: PenalizerDependencies = {
      transactionManager,
      contractInteractor,
      txByNonceService
    }
    penalizerService = new PenalizerService(penalizerParams, logger, config)
    await penalizerService.init()
  }
  const relay = new RelayServer(config, transactionManager, dependencies)
  await relay.init()
  const httpServer = new HttpServer(config.port, logger, relay, penalizerService)
  httpServer.start()
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
