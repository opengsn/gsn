import * as fs from 'fs'
import parseArgs from 'minimist'

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
import { Environment, environments, EnvironmentsKeys } from '@opengsn/common'
import { toBN } from 'web3-utils'

export enum LoggingProviderMode {
  NONE,
  DURATION,
  ALL,
  CHATTY
}

// TODO: is there a way to merge the typescript definition ServerConfigParams with the runtime checking ConfigParamTypes ?
export interface ServerConfigParams {
  ownerAddress: string
  baseRelayFee: string
  pctRelayFee: number
  url: string
  port: number
  relayHubAddress: string
  ethereumNodeUrl: string
  workdir: string
  checkInterval: number
  devMode: boolean
  loggingProvider: LoggingProviderMode
  maxAcceptanceBudget: number
  alertedDelaySeconds: number
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
  managerStakeTokenAddress: string
  managerTargetBalance: number
  minHubWithdrawalBalance: number
  withdrawToOwnerOnBalance?: number
  refreshStateTimeoutBlocks: number
  pendingTransactionTimeoutSeconds: number
  confirmationsNeeded: number
  dbAutoCompactionInterval: number
  retryGasPriceFactor: number
  maxGasPrice: string
  defaultPriorityFee: string
  defaultGasLimit: number
  requestMinValidSeconds: number

  runPenalizer: boolean
  runPaymasterReputations: boolean

  requiredVersionRange?: string

  // when server starts, it will look for relevant Relay Hub, Stake Manager events starting at this block
  coldRestartLogsFromBlock?: number
  // if the number of blocks per 'getLogs' query is limited, use pagination with this page size
  pastEventsQueryMaxPageSize: number

  environmentName?: string
  // number of blocks the server will not repeat a ServerAction for regardless of blockchain state to avoid duplicates
  recentActionAvoidRepeatDistanceBlocks: number
  skipErc165Check: boolean
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
  gasPriceFactor: 1,
  gasPriceOracleUrl: '',
  gasPriceOraclePath: '',
  workerMinBalance: 0.1e18,
  workerTargetBalance: 0.3e18,
  managerMinBalance: 0.1e18, // 0.1 eth
  managerMinStake: '1', // 1 wei
  managerStakeTokenAddress: constants.ZERO_ADDRESS,
  managerTargetBalance: 0.3e18,
  minHubWithdrawalBalance: 0.1e18,
  checkInterval: 10000,
  devMode: false,
  loggingProvider: LoggingProviderMode.NONE,
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
  port: 8090,
  workdir: '',
  refreshStateTimeoutBlocks: 5,
  pendingTransactionTimeoutSeconds: 300,
  confirmationsNeeded: 12,
  dbAutoCompactionInterval: 604800000, // Week in ms: 1000*60*60*24*7
  retryGasPriceFactor: 1.2,
  defaultGasLimit: 500000,
  maxGasPrice: 500e9.toString(),
  defaultPriorityFee: 1e9.toString(),

  requestMinValidSeconds: 43200, // roughly 12 hours, quarter of client's default of 172800 seconds (2 days)
  runPaymasterReputations: true,
  pastEventsQueryMaxPageSize: Number.MAX_SAFE_INTEGER,
  recentActionAvoidRepeatDistanceBlocks: 10,
  skipErc165Check: false
}

const ConfigParamsTypes = {
  ownerAddress: 'string',
  config: 'string',
  baseRelayFee: 'number',
  pctRelayFee: 'number',
  url: 'string',
  port: 'number',
  relayHubAddress: 'string',
  gasPriceFactor: 'number',
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
  minHubWithdrawalBalance: 'number',
  withdrawToOwnerOnBalance: 'number',
  defaultGasLimit: 'number',
  requestMinValidSeconds: 'number',

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
  pendingTransactionTimeoutSeconds: 'number',
  minAlertedDelayMS: 'number',
  maxAlertedDelayMS: 'number',
  maxGasPrice: 'string',
  defaultPriorityFee: 'string',
  coldRestartLogsFromBlock: 'number',
  pastEventsQueryMaxPageSize: 'number',
  confirmationsNeeded: 'number',
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
export async function resolveServerConfig (config: Partial<ServerConfigParams>, web3provider: any): Promise<{
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
    provider: web3provider,
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
  if (config.coldRestartLogsFromBlock == null) {
    const block = await contractInteractor.getCreationBlockFromRelayHub()
    config.coldRestartLogsFromBlock = block.toNumber()
  }
  if (config.url == null) error('missing param: url')
  if (config.workdir == null) error('missing param: workdir')
  if (config.ownerAddress == null || config.ownerAddress === constants.ZERO_ADDRESS) error('missing param: ownerAddress')
  if (config.managerStakeTokenAddress == null || config.managerStakeTokenAddress === constants.ZERO_ADDRESS) error('missing param: managerStakeTokenAddress')
  const finalConfig = { ...serverDefaultConfiguration, ...config }
  validateBalanceParams(finalConfig)
  return {
    config: finalConfig,
    environment
  }
}

export function validateBalanceParams (config: ServerConfigParams): void {
  const workerTargetBalance = toBN(config.workerTargetBalance)
  const managerTargetBalance = toBN(config.managerTargetBalance)
  const managerMinBalance = toBN(config.managerMinBalance)
  const workerMinBalance = toBN(config.workerMinBalance)
  const minHubWithdrawalBalance = toBN(config.minHubWithdrawalBalance)
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
  if (minHubWithdrawalBalance.gt(withdrawToOwnerOnBalance)) {
    throw new Error('withdrawToOwnerOnBalance must be at least minHubWithdrawalBalance')
  }
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
