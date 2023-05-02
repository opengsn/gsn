import * as fs from 'fs'
import parseArgs from 'minimist'

import { JsonRpcProvider } from '@ethersproject/providers'

import {
  Address,
  ContractInteractor,
  Environment,
  EnvironmentsKeys,
  LoggerInterface,
  NpmLogLevel,
  RelayCallGasLimitCalculationHelper,
  constants,
  defaultEnvironment,
  environments
} from '@opengsn/common'

import { KeyManager } from './KeyManager'
import { TxStoreManager } from './TxStoreManager'
import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'

import { GasPriceFetcher } from './GasPriceFetcher'
import { ReputationManager, ReputationManagerConfiguration } from './ReputationManager'

import { toBN } from 'web3-utils'
import { Web3MethodsBuilder } from './Web3MethodsBuilder'

export enum LoggingProviderMode {
  NONE,
  DURATION,
  ALL,
  CHATTY
}

/**
 * The interface describing all possible configuration parameters for a GSN Provider.
 * Note that you probably do not need to modify most of these parameters.
 * They exist to support all possible combinations of use-cases and networks.
 */
export interface ServerConfigParams {
  /**
   * An address of the owner of this relay. Must be set to the address that will be putting the stake for the Relay.
   */
  ownerAddress: string

  /**
   * The URL with which the Relay will register on the RelayRegistrar.
   * This must be a publicly accessible URL for the clients to be able to reach your Relay.
   */
  url: string

  /**
   * The port on which the Relay process will listen for connections.
   * Affects the docker configuration. Defaults to 8090.
   */
  port: number

  /**
   * The address of the RelayHub contract.
   */
  relayHubAddress: string

  /**
   * The URL of the Ethereum RPC Node that is used to interact with the blockchain.
   */
  ethereumNodeUrl: string

  /**
   * The name of the directory used to store the database and private keys.
   */
  workdir: string

  /**
   * The interval, in milliseconds, with which the Relay will poll the RPC node for new confirmed blocks.
   */
  checkInterval: number

  /**
   * With this flag set to true the Relay will always clean up its own storage. Only use for testing.
   */
  devMode: boolean

  /**
   * Set what information to output to console from the RPC node calls. Possible values:
   *  0 NONE
   *  1 DURATION
   *  2 ALL
   *  3 CHATTY
   */
  loggingProvider: LoggingProviderMode

  /**
   * The maximum value the Relay is ready to risk in one call when relaying a transaction, denominated in gas.
   * If the incoming Relay Request requires more gas to verify itself on-chain it will be rejected.
   */
  maxAcceptanceBudget: number

  /**
   * The duration of time the Relay will throttle incoming RelayRequests after suffering a loss.
   * This indicates a transaction reverted on-chain, which may be an attempted attack to drain the relay.
   */
  alertedDelaySeconds: number

  /**
   * Alerted mode will delay incoming RelayRequests by at least this amount of time.
   */
  minAlertedDelayMS: number

  /**
   * Alerted mode will delay incoming RelayRequests by no more than this amount of time.
   */
  maxAlertedDelayMS: number

  /**
   * The Paymasters in this array will have unlimited {@link maxAcceptanceBudget} and reputation.
   */
  trustedPaymasters: Address[]

  /**
   * The Paymasters in this array will not be served.
   */
  blacklistedPaymasters: Address[]

  /**
   * The Recipients in this array will not be served.
   */
  blacklistedRecipients: Address[]
  /**
   * Only the Paymasters in this array will be served. Can only be set together with 'url' set to empty string.
   */
  whitelistedPaymasters: Address[]

  /**
   * Only the Recipients in this array will be served. Can only be set together with 'url' set to empty string.
   * Empty whitelist means the whitelist will not be applied.
   */
  whitelistedRecipients: Address[]

  /**
   * The 'gasPrice'/'maxPriorityFeePerGas' reported by the network will be multiplied by this value.
   */
  gasPriceFactor: number

  /**
   * If the calldata gas estimation is non-deterministic, as is the case on L2s, use a factor to supply some extra gas.
   * Note that the server should have a smaller factor then the clients to avoid rejecting valid Relay Requests.
   */
  calldataEstimationSlackFactor: number

  /**
   * The URL to access to get the gas price from.
   * This is done instead of reading the 'gasPrice'/'maxPriorityFeePerGas' from the RPC node.
   */
  gasPriceOracleUrl: string

  /**
   * For JSON response format, the field to get from the object.
   */
  gasPriceOraclePath: string

  /**
   * The logging level for the Relay process.
   *  'error' , 'warn' , 'info' , 'debug'
   */
  logLevel: NpmLogLevel

  /**
   * The URL of the remote logger service. Setting it enables remote log collection.
   */
  loggerUrl: string

  /**
   * The user ID for the remote logger service.
   */
  loggerUserId: string

  /**
   * If running the Relay in a Penalizer mode it will require an Etherscan API URL to query transactions.
   */
  etherscanApiUrl: string

  /**
   * If running the Relay in a Penalizer mode it will require an Etherscan API key.
   */
  etherscanApiKey: string

  /**
   * The minimum balance of the worker. If the balance gets lower than that Relay Manager will top it up.
   */
  workerMinBalance: number

  /**
   * The balance of the worker that the Relay will try to maintain by sending funds to it from the Manager.
   */
  workerTargetBalance: number

  /**
   * The minimum balance of the Relay Manager.
   * If the balance gets lower than that Relay Manager will pull its revenue from the RelayHub.
   */
  managerMinBalance: number

  /**
   * The balance of the Relay Manager that the Relay will try to maintain by pulling its revenue from the RelayHub.
   */
  managerTargetBalance: number

  /**
   * The address of the ERC-20 tokens that are used as stake kept on the StakeManager contract.
   */
  managerStakeTokenAddress: string

  /**
   * If the balance of the Relay Manager on the RelayHub is above this value it will be sent to the owner.
   */
  withdrawToOwnerOnBalance?: number

  /**
   * The Relay will re-read relevant blockchain state after so many blocks.
   */
  refreshStateTimeoutBlocks: number

  /**
   * Once a transaction is broadcast, the Relay will boost it after this number of seconds.
   */
  pendingTransactionTimeoutSeconds: number

  /**
   * Remove transactions that were send this many blocks ago from database.
   */
  dbPruneTxAfterBlocks: number

  /**
   * Remove transactions that were send this many seconds ago from database.
   */
  dbPruneTxAfterSeconds: number

  /**
   * Automatically compact the database with this interval.
   */
  dbAutoCompactionInterval: number

  /**
   * If the transaction is stuck pending for some time the Relay will multiply its 'maxFeePerGas'
   * and 'maxPriorityFeePerGas' by this value.
   */
  retryGasPriceFactor: number

  /**
   * The absolute maximum gas fee the Relay is willing to pay.
   */
  maxMaxFeePerGas: string

  /**
   * The number of past blocks to query in 'eth_getGasFees' RPC request.
   */
  getGasFeesBlocks: number

  /**
   * The miner reward "percentile" to query in 'eth_getGasFees' RPC request.
   */
  getGasFeesPercentile: number

  /**
   * In case the RPC node reports 'maxPriorityFeePerGas' to be 0, override it with this value.
   */
  defaultPriorityFee: string

  /**
   * Only used to set 'addRelayWorker' gas limit as it fails estimation.
   * @deprecated
   */
  defaultGasLimit: number

  /**
   * If the RelayRequest becomes invalid this soon after it is received it should be rejected.
   */
  requestMinValidSeconds: number

  /**
   * If set to 'true' this Relay will run in Penalizer mode by listening to '/audit' HTTP requests.
   */
  runPenalizer: boolean

  /**
   * If set to 'true' this Relay will keep track of Paymasters' reputations.
   */
  runPaymasterReputations: boolean

  /**
   * The SemVer string defining which contracts versions are supported.
   */
  requiredVersionRange?: string

  /**
   * If the number of blocks per 'getLogs' query is limited, use pagination with this page size.
   */
  pastEventsQueryMaxPageSize: number

  /**
   * When querying a large range with a small {@link pastEventsQueryMaxPageSize} the number of pages may become insane.
   */
  pastEventsQueryMaxPageCount: number

  /**
   * The name of preconfigured network. Supported values: "ethereumMainnet", "arbitrum".
   */
  environmentName?: string

  /**
   * Number of blocks the server will not repeat a ServerAction for regardless of blockchain state to avoid duplicates.
   */
  recentActionAvoidRepeatDistanceBlocks: number

  /**
   * If set to 'true' the Relay will not perform an ERC-165 interfaces check on the GSN contracts.
   */
  skipErc165Check: boolean
}

export interface ServerDependencies {
  // TODO: rename as this name is terrible
  managerKeyManager: KeyManager
  workersKeyManager: KeyManager
  contractInteractor: ContractInteractor
  gasLimitCalculator: RelayCallGasLimitCalculationHelper
  web3MethodsBuilder: Web3MethodsBuilder
  gasPriceFetcher: GasPriceFetcher
  txStoreManager: TxStoreManager
  reputationManager?: ReputationManager
  logger: LoggerInterface
}

export const serverDefaultConfiguration: ServerConfigParams = {
  ownerAddress: constants.ZERO_ADDRESS,
  alertedDelaySeconds: 0,
  minAlertedDelayMS: 0,
  maxAlertedDelayMS: 0,
  // set to paymasters' default acceptanceBudget + RelayHub.calldataGasCost(<paymasters' default calldataSizeLimit>)
  maxAcceptanceBudget:
    defaultEnvironment.paymasterConfiguration.acceptanceBudget +
    defaultEnvironment.dataOnChainHandlingGasCostPerByte *
    defaultEnvironment.paymasterConfiguration.calldataSizeLimit,
  relayHubAddress: constants.ZERO_ADDRESS,
  trustedPaymasters: [],
  blacklistedPaymasters: [],
  blacklistedRecipients: [],
  whitelistedPaymasters: [],
  whitelistedRecipients: [],
  gasPriceFactor: 1,
  calldataEstimationSlackFactor: 1,
  gasPriceOracleUrl: '',
  gasPriceOraclePath: '',
  workerMinBalance: 0.1e18,
  workerTargetBalance: 0.3e18,
  managerMinBalance: 0.1e18, // 0.1 eth
  managerStakeTokenAddress: constants.ZERO_ADDRESS,
  managerTargetBalance: 0.3e18,
  checkInterval: 10000,
  devMode: false,
  loggingProvider: LoggingProviderMode.NONE,
  runPenalizer: true,
  logLevel: 'debug',
  loggerUrl: '',
  etherscanApiUrl: '',
  etherscanApiKey: '',
  loggerUserId: '',
  url: 'http://localhost:8090',
  ethereumNodeUrl: '',
  port: 8090,
  workdir: '',
  refreshStateTimeoutBlocks: 5,
  pendingTransactionTimeoutSeconds: 300,
  dbPruneTxAfterBlocks: 12,
  dbPruneTxAfterSeconds: 3600, // One hour
  dbAutoCompactionInterval: 604800000, // Week in ms: 1000*60*60*24*7
  retryGasPriceFactor: 1.2,
  defaultGasLimit: 500000,
  maxMaxFeePerGas: 500e9.toString(),
  defaultPriorityFee: 1e9.toString(),
  getGasFeesBlocks: 5,
  getGasFeesPercentile: 50,

  requestMinValidSeconds: 43200, // roughly 12 hours, quarter of client's default of 172800 seconds (2 days)
  runPaymasterReputations: true,
  pastEventsQueryMaxPageSize: Number.MAX_SAFE_INTEGER,
  pastEventsQueryMaxPageCount: 20,
  recentActionAvoidRepeatDistanceBlocks: 10,
  skipErc165Check: false
}

const ConfigParamsTypes = {
  ownerAddress: 'string',
  config: 'string',
  url: 'string',
  port: 'number',
  relayHubAddress: 'string',
  gasPriceFactor: 'number',
  calldataEstimationSlackFactor: 'number',
  gasPriceOracleUrl: 'string',
  gasPriceOraclePath: 'string',
  ethereumNodeUrl: 'string',
  workdir: 'string',
  checkInterval: 'number',
  devMode: 'boolean',
  loggingProvider: 'number',
  logLevel: 'string',

  loggerUrl: 'string',
  loggerUserId: 'string',

  customerToken: 'string',
  hostOverride: 'string',
  userId: 'string',
  maxAcceptanceBudget: 'number',
  alertedDelaySeconds: 'number',

  workerMinBalance: 'number',
  workerTargetBalance: 'number',
  managerMinBalance: 'number',
  managerMinStake: 'string',
  managerStakeTokenAddress: 'string',
  managerTargetBalance: 'number',
  withdrawToOwnerOnBalance: 'number',
  defaultGasLimit: 'number',
  requestMinValidSeconds: 'number',

  trustedPaymasters: 'list',
  blacklistedPaymasters: 'list',
  blacklistedRecipients: 'list',
  whitelistedPaymasters: 'list',
  whitelistedRecipients: 'list',

  runPenalizer: 'boolean',

  etherscanApiUrl: 'string',
  etherscanApiKey: 'string',

  // TODO: does not belong here
  initialReputation: 'number',

  requiredVersionRange: 'string',
  dbAutoCompactionInterval: 'number',
  retryGasPriceFactor: 'number',
  runPaymasterReputations: 'boolean',
  refreshStateTimeoutBlocks: 'number',
  pendingTransactionTimeoutSeconds: 'number',
  minAlertedDelayMS: 'number',
  maxAlertedDelayMS: 'number',
  maxMaxFeePerGas: 'string',
  getGasFeesBlocks: 'number',
  getGasFeesPercentile: 'number',
  defaultPriorityFee: 'string',
  pastEventsQueryMaxPageSize: 'number',
  pastEventsQueryMaxPageCount: 'number',
  dbPruneTxAfterBlocks: 'number',
  dbPruneTxAfterSeconds: 'number',
  environmentName: 'string',
  recentActionAvoidRepeatDistanceBlocks: 'number',
  skipErc165Check: 'boolean'
} as any

// helper function: throw and never return..
function error (err: string): never {
  throw new Error(err)
}

// get the keys matching specific type from ConfigParamsType
export function filterType (config: any, type: string): any {
  return Object.entries(config).flatMap(e => e[1] === type ? [e[0]] : [])
}

// convert [key,val] array (created by Object.entries) back to an object.
export function entriesToObj (entries: any[]): any {
  return entries
    .reduce((set: any, [k, v]) => ({ ...set, [k]: v }), {})
}

// filter and return from env only members that appear in "config"
export function filterMembers (env: any, config: any): any {
  return entriesToObj(Object.entries(env)
    .filter(e => config[e[0]] != null))
}

// map value from string into its explicit type (number, boolean)
// TODO; maybe we can use it for more specific types, such as "address"..
function explicitType ([key, val]: [string, any]): any {
  const type = ConfigParamsTypes[key] as string
  if (type === undefined) {
    error(`unexpected param ${key}=${val as string}`)
  }
  switch (type) {
    case 'boolean' :
      if (val === 'true' || val === true) return [key, true]
      if (val === 'false' || val === false) return [key, false]
      break
    case 'number': {
      const v = parseFloat(val)
      if (!isNaN(v)) {
        return [key, v]
      }
      break
    }
    default:
      return [key, val]
  }
  error(`Invalid ${type}: ${key} = ${val as string}`)
}

/**
 * initialize each parameter from commandline, env or config file (in that order)
 * config file must be provided either as command-line or env (obviously, not in
 * the config file..)
 */
export function parseServerConfig (args: string[], env: any): any {
  const envDefaults = filterMembers(env, ConfigParamsTypes)

  const argv = parseArgs(args, {
    string: filterType(ConfigParamsTypes, 'string'),
    // boolean: filterType(ConfigParamsTypes, 'boolean'),
    default: envDefaults
  })
  if (argv._.length > 0) {
    error(`unexpected param(s) ${argv._.join(',')}`)
  }
  // @ts-ignore
  delete argv._
  let configFile = {}
  const configFileName = argv.config as string
  console.log('Using config file', configFileName)
  if (configFileName != null) {
    if (!fs.existsSync(configFileName)) {
      error(`unable to read config file "${configFileName}"`)
    }
    configFile = JSON.parse(fs.readFileSync(configFileName, 'utf8'))
    console.log('Initial configuration:', configFile)
  }
  const config = { ...configFile, ...argv }
  return entriesToObj(Object.entries(config).map(explicitType))
}

// resolve params, and validate the resulting struct
export async function resolveServerConfig (config: Partial<ServerConfigParams>, ethersProvider: JsonRpcProvider): Promise<{
  config: ServerConfigParams
  environment: Environment
}> {
  let environment: Environment
  if (config.environmentName != null) {
    environment = environments[config.environmentName as EnvironmentsKeys]
    if (environment == null) {
      throw new Error(`Unknown named environment: ${config.environmentName}`)
    }
  } else {
    environment = defaultEnvironment
    console.error(`Must provide one of the supported values for environmentName: ${Object.keys(EnvironmentsKeys).toString()}`)
  }

  // TODO: avoid functions that are not parts of objects! Refactor this so there is a configured logger before we start blockchain interactions.
  const logger = createServerLogger(config.logLevel ?? 'debug', config.loggerUrl ?? '', config.loggerUserId ?? '')
  const contractInteractor: ContractInteractor = new ContractInteractor({
    maxPageSize: config.pastEventsQueryMaxPageSize ?? Number.MAX_SAFE_INTEGER,
    calldataEstimationSlackFactor: config.calldataEstimationSlackFactor ?? 1,
    provider: ethersProvider,
    logger,
    deployment: {
      relayHubAddress: config.relayHubAddress
    },
    environment
  })
  await contractInteractor._resolveDeployment()
  await contractInteractor._initializeContracts()
  await contractInteractor._initializeNetworkParams()

  if (config.relayHubAddress == null) {
    error('missing param: must have relayHubAddress')
  }
  if (config.url == null) error('missing param: url')
  if (config.workdir == null) error('missing param: workdir')
  if (config.ownerAddress == null || config.ownerAddress === constants.ZERO_ADDRESS) error('missing param: ownerAddress')
  if (config.managerStakeTokenAddress == null || config.managerStakeTokenAddress === constants.ZERO_ADDRESS) error('missing param: managerStakeTokenAddress')
  const finalConfig = { ...serverDefaultConfiguration, ...config }
  validatePrivateModeParams(finalConfig)
  validateBalanceParams(finalConfig)
  return {
    config: finalConfig,
    environment
  }
}

export function validatePrivateModeParams (config: ServerConfigParams): void {
  if (config.url.length !== 0 && (config.whitelistedRecipients.length !== 0 || config.whitelistedPaymasters.length !== 0)) {
    throw new Error('Cannot whitelist recipients or paymasters on a public Relay Server')
  }
}

export function validateBalanceParams (config: ServerConfigParams): void {
  const workerTargetBalance = toBN(config.workerTargetBalance)
  const managerTargetBalance = toBN(config.managerTargetBalance)
  const managerMinBalance = toBN(config.managerMinBalance)
  const workerMinBalance = toBN(config.workerMinBalance)
  if (managerTargetBalance.lt(managerMinBalance)) {
    throw new Error('managerTargetBalance must be at least managerMinBalance')
  }
  if (workerTargetBalance.lt(workerMinBalance)) {
    throw new Error('workerTargetBalance must be at least workerMinBalance')
  }
  if (config.withdrawToOwnerOnBalance == null) {
    return
  }
  const withdrawToOwnerOnBalance = toBN(config.withdrawToOwnerOnBalance)
  if (managerTargetBalance.add(workerTargetBalance).gte(withdrawToOwnerOnBalance)) {
    throw new Error('withdrawToOwnerOnBalance must be larger than managerTargetBalance + workerTargetBalance')
  }
}

export function resolveReputationManagerConfig (config: any): Partial<ReputationManagerConfiguration> {
  if (config.configFileName != null) {
    if (!fs.existsSync(config.configFileName)) {
      error(`unable to read config file "${config.configFileName as string}"`)
    }
    return JSON.parse(fs.readFileSync(config.configFileName, 'utf8'))
  }
  // TODO: something not insane!
  return config as Partial<ReputationManagerConfiguration>
}

export function configureServer (partialConfig: Partial<ServerConfigParams>): ServerConfigParams {
  return Object.assign({}, serverDefaultConfiguration, partialConfig)
}
