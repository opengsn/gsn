// TODO: convert to 'commander' format
import fs from 'fs'
import Web3 from 'web3'
import chalk from 'chalk'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { HttpServer } from './HttpServer'
import { RelayServer } from './RelayServer'
import { KeyManager } from './KeyManager'
import { TXSTORE_FILENAME, TxStoreManager } from './TxStoreManager'
import {
  ContractInteractor,
  Environment,
  EnvironmentsKeys,
  RelayCallGasLimitCalculationHelper,
  VersionsManager,
  gsnRequiredVersion,
  gsnRuntimeVersion
} from '@opengsn/common'
import {
  LoggingProviderMode,
  parseServerConfig,
  resolveReputationManagerConfig,
  resolveServerConfig,
  ServerConfigParams,
  ServerDependencies
} from './ServerConfigParams'
import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'
import { PenalizerDependencies, PenalizerService } from './penalizer/PenalizerService'
import { TransactionManager } from './TransactionManager'
import { EtherscanCachedService } from './penalizer/EtherscanCachedService'
import { TransactionDataCache, TX_PAGES_FILENAME, TX_STORE_FILENAME } from './penalizer/TransactionDataCache'
import { GasPriceFetcher } from './GasPriceFetcher'
import { ReputationManager, ReputationManagerConfiguration } from './ReputationManager'
import { REPUTATION_STORE_FILENAME, ReputationStoreManager } from './ReputationStoreManager'
import { Web3MethodsBuilder } from './Web3MethodsBuilder'

function error (err: string): never {
  console.error(err)
  process.exit(1)
}

function sanitizeJsonRpcPayload (request: JsonRpcPayload): JsonRpcPayload {
  // protect original object from modification
  const clone = JSON.parse(JSON.stringify(request))
  const data = clone?.params[0]?.data
  if (typeof data === 'string' && data.length > 1000) {
    clone.params[0].data = data.substr(0, 70) + '...'
  }
  return clone
}

function sanitizeJsonRpcResponse (response?: JsonRpcResponse): JsonRpcResponse | undefined {
  if (response == null) {
    return response
  }
  // protect original object from modification
  const clone: JsonRpcResponse = JSON.parse(JSON.stringify(response))
  if (typeof clone.result === 'string' && clone.result.length > 1000) {
    clone.result = clone.result.substr(0, 70) + '...'
  }
  return clone
}

async function run (): Promise<void> {
  let config: ServerConfigParams
  let environment: Environment
  let web3provider
  let ethersJsonRpcProvider: StaticJsonRpcProvider
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
    const loggingProvider: LoggingProviderMode = conf.loggingProvider ?? LoggingProviderMode.NONE
    conf.environmentName = conf.environmentName ?? EnvironmentsKeys.ethereumMainnet
    web3provider = new Web3.providers.HttpProvider(conf.ethereumNodeUrl)
    ethersJsonRpcProvider = new StaticJsonRpcProvider(conf.ethereumNodeUrl)

    if (loggingProvider !== LoggingProviderMode.NONE) {
      const orig = web3provider
      web3provider = {
        // @ts-ignore
        send (r, cb) {
          const startTimestamp = Date.now()
          switch (loggingProvider) {
            case LoggingProviderMode.DURATION: {
              let blockRange = ''
              if (r?.params[0]?.fromBlock != null) {
                blockRange = `(${r?.params[0]?.fromBlock as string} - ${r?.params[0]?.toBlock as string})`
              }
              console.log('>>> ', r.method, blockRange)
              break
            }
            case LoggingProviderMode.ALL:
              console.log('>>> ', sanitizeJsonRpcPayload(r))
              // eslint-disable-next-line
              if (r && r.params && r.params[0] && r.params[0].topics) {
                console.log('>>>\n', r.params[0].topics, '\n')
              }
              break
          }
          // eslint-disable-next-line
          if (r && r.params && r.params[0] && r.params[0].fromBlock == 1) {
            console.warn('=== eth_getLogs fromBlock: 1, potentially long operation!')
          }
          orig.send(r, (err, res) => {
            const duration = Date.now() - startTimestamp
            switch (loggingProvider) {
              case LoggingProviderMode.DURATION:
                console.log('<<<', r.method, duration)
                break
              case LoggingProviderMode.ALL:
                console.log('<<<\n', r.method, duration, err, sanitizeJsonRpcResponse(res))
                break
            }
            cb(err, res)
          })
        }
      }
    }
    console.log('Resolving server config ...\n');
    ({ config, environment } = await resolveServerConfig(conf, ethersJsonRpcProvider))
    runPenalizer = config.runPenalizer
    console.log('Resolving reputation manager config...\n')
    reputationManagerConfig = resolveReputationManagerConfig(conf)
    runPaymasterReputations = config.runPaymasterReputations
  } catch (e: any) {
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
  const managerKeyManager = new KeyManager(1, `${workdir}/manager`)
  const workersKeyManager = new KeyManager(1, `${workdir}/workers/${config.relayHubAddress}`)
  const txStoreManager = new TxStoreManager({
    workdir,
    autoCompactionInterval: config.dbAutoCompactionInterval
  }, logger)
  console.log(chalk.redBright('Relay worker key manager created. This address is staked and meant only for internal (gsn) usage.' +
    ' Using this address for any other purpose may result in loss of funds.'))
  console.log('Creating interactor...\n')
  const contractInteractor = new ContractInteractor({
    provider: ethersJsonRpcProvider,
    logger,
    environment,
    calldataEstimationSlackFactor: config.calldataEstimationSlackFactor,
    maxPageSize: config.pastEventsQueryMaxPageSize,
    versionManager: new VersionsManager(gsnRuntimeVersion, config.requiredVersionRange ?? gsnRequiredVersion),
    deployment: {
      relayHubAddress: config.relayHubAddress,
      managerStakeTokenAddress: config.managerStakeTokenAddress
    }
  })
  console.log('Initializing interactor...\n')
  await contractInteractor.init()
  const gasLimitCalculator = new RelayCallGasLimitCalculationHelper(
    logger,
    contractInteractor,
    config.calldataEstimationSlackFactor,
    config.maxAcceptanceBudget
  )
  const resolvedDeployment = contractInteractor.getDeployment()
  const web3MethodsBuilder = new Web3MethodsBuilder(new Web3(web3provider as any), resolvedDeployment)

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
    gasLimitCalculator,
    web3MethodsBuilder,
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
      web3MethodsBuilder,
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
