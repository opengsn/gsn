import * as fs from 'fs'
import parseArgs from 'minimist'

import { VersionRegistry } from '@opengsn/common/dist/VersionRegistry'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { constants } from '@opengsn/common/dist/Constants'
import { Address, NpmLogLevel } from '@opengsn/common/dist/types/Aliases'
import { KeyManager } from './KeyManager'
import { TxStoreManager } from './TxStoreManager'
import { createServerLogger } from './ServerWinstonLogger'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { GasPriceFetcher } from './GasPriceFetcher'
import { ReputationManager, ReputationManagerConfiguration } from './ReputationManager'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'

// TODO: is there a way to merge the typescript definition ServerConfigParams with the runtime checking ConfigParamTypes ?
export interface ServerConfigParams {
  ownerAddress: string
  baseRelayFee: string
  pctRelayFee: number
  url: string
  port: number
  versionRegistryAddress: string
  versionRegistryDelayPeriod?: number
  relayHubId?: string
  relayHubAddress: string
  ethereumNodeUrl: string
  workdir: string
  checkInterval: number
  readyTimeout: number
  devMode: boolean
  loggingProvider: boolean
  // if set, must match clients' "relayRegistrationLookupBlocks" parameter for relay to be discoverable
  registrationBlockRate: number
  // if set, must match clients' "relayLookupWindowBlocks" parameter for relay to be discoverable
  activityBlockRate: number
  maxAcceptanceBudget: number
  alertedBlockDelay: number
  minAlertedDelayMS: number
  maxAlertedDelayMS: number
  trustedPaymasters: Address[]
  blacklistedPaymasters: Address[]
  gasPriceFactor: number
  gasPriceOracleUrl: string
  gasPriceOraclePath: string
  logLevel: NpmLogLevel
  loggerUrl: string
  loggerUserId: string
  etherscanApiUrl: string
  etherscanApiKey: string

  workerMinBalance: number
  workerTargetBalance: number
  managerMinBalance: number
  managerMinStake: string
  managerTargetBalance: number
  minHubWithdrawalBalance: number
  refreshStateTimeoutBlocks: number
  pendingTransactionTimeoutBlocks: number
  confirmationsNeeded: number
  dbAutoCompactionInterval: number
  retryGasPriceFactor: number
  maxGasPrice: string
  defaultGasLimit: number
  requestMinValidBlocks: number

  runPenalizer: boolean
  runPaymasterReputations: boolean

  requiredVersionRange?: string

  // when server starts, it will look for relevant Relay Hub, Stake Manager events starting at this block
  coldRestartLogsFromBlock: number
  // if the number of blocks per 'getLogs' query is limited, use pagination with this page size
  pastEventsQueryMaxPageSize: number
}

export interface ServerDependencies {
  // TODO: rename as this name is terrible
  managerKeyManager: KeyManager
  workersKeyManager: KeyManager
  contractInteractor: ContractInteractor
  gasPriceFetcher: GasPriceFetcher
  txStoreManager: TxStoreManager
  reputationManager?: ReputationManager
  logger: LoggerInterface
}

export const serverDefaultConfiguration: ServerConfigParams = {
  ownerAddress: constants.ZERO_ADDRESS,
  alertedBlockDelay: 0,
  minAlertedDelayMS: 0,
  maxAlertedDelayMS: 0,
  // set to paymasters' default acceptanceBudget + RelayHub.calldataGasCost(<paymasters' default calldataSizeLimit>)
  maxAcceptanceBudget: defaultEnvironment.paymasterConfiguration.acceptanceBudget + defaultEnvironment.relayHubConfiguration.dataGasCostPerByte * defaultEnvironment.paymasterConfiguration.calldataSizeLimit,
  relayHubAddress: constants.ZERO_ADDRESS,
  trustedPaymasters: [],
  blacklistedPaymasters: [],
  gasPriceFactor: 1,
  gasPriceOracleUrl: '',
  gasPriceOraclePath: '',
  registrationBlockRate: 0,
  activityBlockRate: 0,
  workerMinBalance: 0.1e18,
  workerTargetBalance: 0.3e18,
  managerMinBalance: 0.1e18, // 0.1 eth
  managerMinStake: '1', // 1 wei
  managerTargetBalance: 0.3e18,
  minHubWithdrawalBalance: 0.1e18,
  checkInterval: 10000,
  readyTimeout: 30000,
  devMode: false,
  loggingProvider: false,
  runPenalizer: true,
  logLevel: 'debug',
  loggerUrl: '',
  etherscanApiUrl: '',
  etherscanApiKey: '',
  loggerUserId: '',
  baseRelayFee: '0',
  pctRelayFee: 0,
  url: 'http://localhost:8090',
  ethereumNodeUrl: '',
  port: 0,
  versionRegistryAddress: constants.ZERO_ADDRESS,
  workdir: '',
  refreshStateTimeoutBlocks: 5,
  pendingTransactionTimeoutBlocks: 30, // around 5 minutes with 10 seconds block times
  confirmationsNeeded: 12,
  dbAutoCompactionInterval: 604800000, // Week in ms: 1000*60*60*24*7
  retryGasPriceFactor: 1.2,
  defaultGasLimit: 500000,
  maxGasPrice: 100e9.toString(),

  requestMinValidBlocks: 3000, // roughly 12 hours (half client's default of 6000 blocks
  runPaymasterReputations: true,
  coldRestartLogsFromBlock: 1,
  pastEventsQueryMaxPageSize: Number.MAX_SAFE_INTEGER
}

const ConfigParamsTypes = {
  ownerAddress: 'string',
  config: 'string',
  baseRelayFee: 'number',
  pctRelayFee: 'number',
  url: 'string',
  port: 'number',
  versionRegistryAddress: 'string',
  versionRegistryDelayPeriod: 'number',
  relayHubId: 'string',
  relayHubAddress: 'string',
  gasPriceFactor: 'number',
  gasPriceOracleUrl: 'string',
  gasPriceOraclePath: 'string',
  ethereumNodeUrl: 'string',
  workdir: 'string',
  checkInterval: 'number',
  readyTimeout: 'number',
  devMode: 'boolean',
  loggingProvider: 'boolean',
  logLevel: 'string',

  loggerUrl: 'string',
  loggerUserId: 'string',

  customerToken: 'string',
  hostOverride: 'string',
  userId: 'string',
  registrationBlockRate: 'number',
  activityBlockRate: 'number',
  maxAcceptanceBudget: 'number',
  alertedBlockDelay: 'number',

  workerMinBalance: 'number',
  workerTargetBalance: 'number',
  managerMinBalance: 'number',
  managerMinStake: 'string',
  managerTargetBalance: 'number',
  minHubWithdrawalBalance: 'number',
  defaultGasLimit: 'number',
  requestMinValidBlocks: 'number',

  trustedPaymasters: 'list',
  blacklistedPaymasters: 'list',

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
  pendingTransactionTimeoutBlocks: 'number',
  minAlertedDelayMS: 'number',
  maxAlertedDelayMS: 'number',
  maxGasPrice: 'string',
  coldRestartLogsFromBlock: 'number',
  pastEventsQueryMaxPageSize: 'number',
  confirmationsNeeded: 'number'
} as any

// by default: no waiting period - use VersionRegistry entries immediately.
const DefaultRegistryDelayPeriod = 0

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
      const v = parseInt(val)
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
export async function resolveServerConfig (config: Partial<ServerConfigParams>, web3provider: any): Promise<Partial<ServerConfigParams>> {
  // TODO: avoid functions that are not parts of objects! Refactor this so there is a configured logger before we start blockchain interactions.
  const logger = createServerLogger(config.logLevel ?? 'debug', config.loggerUrl ?? '', config.loggerUserId ?? '')
  const contractInteractor = new ContractInteractor({
    maxPageSize: config.pastEventsQueryMaxPageSize ?? Number.MAX_SAFE_INTEGER,
    provider: web3provider,
    logger,
    deployment: {
      relayHubAddress: config.relayHubAddress,
      versionRegistryAddress: config.versionRegistryAddress
    }
  })
  await contractInteractor._initializeContracts()
  await contractInteractor._initializeNetworkParams()
  if (config.versionRegistryAddress != null) {
    if (config.relayHubAddress != null) {
      error('missing param: must have either relayHubAddress or versionRegistryAddress')
    }
    const relayHubId = config.relayHubId ?? error('missing param: relayHubId to read from VersionRegistry')
    contractInteractor.validateAddress(config.versionRegistryAddress, 'Invalid param versionRegistryAddress: ')
    if (!await contractInteractor.isContractDeployed(config.versionRegistryAddress)) {
      error('Invalid param versionRegistryAddress: no contract at address ' + config.versionRegistryAddress)
    }
    const versionRegistry = new VersionRegistry(config.coldRestartLogsFromBlock ?? 1, contractInteractor)
    const { version, value, time } = await versionRegistry.getVersion(relayHubId, config.versionRegistryDelayPeriod ?? DefaultRegistryDelayPeriod)
    contractInteractor.validateAddress(value, `Invalid param relayHubId ${relayHubId} @ ${version}: not an address:`)
    console.log(`Using RelayHub ID:${relayHubId} version:${version} address:${value} . created at: ${new Date(time * 1000).toString()}`)
    config.relayHubAddress = value
  } else {
    if (config.relayHubAddress == null) {
      error('missing param: must have either relayHubAddress or versionRegistryAddress')
    }
    contractInteractor.validateAddress(config.relayHubAddress, 'invalid param: "relayHubAddress" is not a valid address:')
  }

  if (config.relayHubAddress == null) {
    error('relayHubAddress is still null')
  }
  if (!await contractInteractor.isContractDeployed(config.relayHubAddress)) {
    error(`RelayHub: no contract at address ${config.relayHubAddress}`)
  }
  if (config.url == null) error('missing param: url')
  if (config.workdir == null) error('missing param: workdir')
  if (config.ownerAddress == null || config.ownerAddress === constants.ZERO_ADDRESS) error('missing param: ownerAddress')
  return { ...serverDefaultConfiguration, ...config }
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
