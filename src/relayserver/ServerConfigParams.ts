import parseArgs from 'minimist'
import * as fs from 'fs'
import { VersionRegistry } from '../common/VersionRegistry'
import ContractInteractor from '../relayclient/ContractInteractor'
import { configureGSN } from '../relayclient/GSNConfigurator'
import { constants } from '../common/Constants'
import { Address } from '../relayclient/types/Aliases'
import { KeyManager } from './KeyManager'
import { TxStoreManager } from './TxStoreManager'
import { LogLevelNumbers } from 'loglevel'

require('source-map-support').install({ errorFormatterForce: true })

// TODO: is there a way to merge the typescript definition ServerConfigParams with the runtime checking ConfigParamTypes ?
export interface ServerConfigParams {
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
  devMode: boolean
  registrationBlockRate: number
  maxAcceptanceBudget: number
  alertedBlockDelay: number
  minAlertedDelayMS: number
  maxAlertedDelayMS: number
  trustedPaymasters: Address[]
  gasPriceFactor: number
  logLevel: LogLevelNumbers

  workerMinBalance: number
  workerTargetBalance: number
  managerMinBalance: number
  managerMinStake: string
  managerTargetBalance: number
  minHubWithdrawalBalance: number
  refreshStateTimeoutBlocks: number
  pendingTransactionTimeoutBlocks: number
  confirmationsNeeded: number
  retryGasPriceFactor: number
  maxGasPrice: string
  defaultGasLimit: number
}

export interface ServerDependencies {
  // TODO: rename as this name is terrible
  managerKeyManager: KeyManager
  workersKeyManager: KeyManager
  contractInteractor: ContractInteractor
  txStoreManager: TxStoreManager
}

const serverDefaultConfiguration: ServerConfigParams = {
  alertedBlockDelay: 0,
  minAlertedDelayMS: 0,
  maxAlertedDelayMS: 0,
  maxAcceptanceBudget: 2e5,
  relayHubAddress: constants.ZERO_ADDRESS,
  trustedPaymasters: [],
  gasPriceFactor: 1,
  registrationBlockRate: 0,
  workerMinBalance: 0.1e18,
  workerTargetBalance: 0.3e18,
  managerMinBalance: 0.1e18, // 0.1 eth
  managerMinStake: '1', // 1 wei
  managerTargetBalance: 0.3e18,
  minHubWithdrawalBalance: 0.1e18,
  checkInterval: 10000,
  devMode: false,
  logLevel: 1,
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
  retryGasPriceFactor: 1.2,
  defaultGasLimit: 500000,
  maxGasPrice: 100e9.toString()
}

const ConfigParamsTypes = {
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
  ethereumNodeUrl: 'string',
  workdir: 'string',
  checkInterval: 'number',
  devMode: 'boolean',
  logLevel: 'number',
  registrationBlockRate: 'number',
  maxAcceptanceBudget: 'number',
  alertedBlockDelay: 'number',

  workerMinBalance: 'number',
  workerTargetBalance: 'number',
  managerMinBalance: 'number',
  managerTargetBalance: 'number',
  minHubWithdrawalBalance: 'number',
  defaultGasLimit: 'number',

  trustedPaymasters: 'list'

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
  if (configFileName != null) {
    if (!fs.existsSync(configFileName)) {
      error(`unable to read config file "${configFileName}"`)
    }
    configFile = JSON.parse(fs.readFileSync(configFileName, 'utf8'))
  }
  const config = { ...configFile, ...argv }
  return entriesToObj(Object.entries(config).map(explicitType))
}

// resolve params, and validate the resulting struct
export async function resolveServerConfig (config: Partial<ServerConfigParams>, web3provider: any): Promise<Partial<ServerConfigParams>> {
  const contractInteractor = new ContractInteractor(web3provider, configureGSN({ relayHubAddress: config.relayHubAddress }))
  if (config.versionRegistryAddress != null) {
    if (config.relayHubAddress != null) {
      error('missing param: must have either relayHubAddress or versionRegistryAddress')
    }
    const relayHubId = config.relayHubId ?? error('missing param: relayHubId to read from VersionRegistry')
    contractInteractor.validateAddress(config.versionRegistryAddress, 'Invalid param versionRegistryAddress: ')
    if (!await contractInteractor.isContractDeployed(config.versionRegistryAddress)) {
      error('Invalid param versionRegistryAddress: no contract at address ' + config.versionRegistryAddress)
    }

    const versionRegistry = new VersionRegistry(web3provider, config.versionRegistryAddress)
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

  if (!await contractInteractor.isContractDeployed(config.relayHubAddress)) {
    error(`RelayHub: no contract at address ${config.relayHubAddress}`)
  }
  if (config.url == null) error('missing param: url')
  if (config.workdir == null) error('missing param: workdir')
  return { ...serverDefaultConfiguration, ...config }
}

export function configureServer (partialConfig: Partial<ServerConfigParams>): ServerConfigParams {
  return Object.assign({}, serverDefaultConfiguration, partialConfig)
}
