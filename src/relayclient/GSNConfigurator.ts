import { HttpProvider } from 'web3-core'
import { Address, AsyncApprove, PingFilter, RelayFilter } from './types/Aliases'
import { defaultEnvironment } from './types/Environments'
import HttpClient from './HttpClient'
import ContractInteractor from './ContractInteractor'
import KnownRelaysManager, { EmptyFilter } from './KnownRelaysManager'
import AccountManager from './AccountManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import HttpWrapper from './HttpWrapper'
import { EmptyApprove, GasPricePingFilter } from './RelayClient'

const GAS_PRICE_PERCENT = 20
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800

const defaultGsnConfig: GSNConfig = {
  gtxdatanonzero: defaultEnvironment.gtxdatanonzero,
  gasPriceFactorPercent: GAS_PRICE_PERCENT,
  minGasPrice: 0,
  maxRelayNonceGap: MAX_RELAY_NONCE_GAP,
  sliceSize: 3,
  relayTimeoutGrace: DEFAULT_RELAY_TIMEOUT_GRACE_SEC,
  methodSuffix: '',
  jsonStringifyRequest: false,
  chainId: defaultEnvironment.chainId,
  relayHubAddress: '0x0000000000000000000000000000000000000000',
  verbose: false
}

/**
 * All classes in GSN must be configured correctly with non-null values.
 * Yet it is tedious to provide default values to all configuration fields on new instance creation.
 * This helper allows users to provide only the overrides and the remainder of values will be set automatically.
 */
export function configureGSN (partialConfig: RecursivePartial<GSNConfig>): GSNConfig {
  return mergeDeep({}, defaultGsnConfig, partialConfig) as GSNConfig
}

type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
}

/**
 * Simple object check.
 * @param item
 * @returns {boolean}
 */
function isObject (item: any): boolean {
  return (item != null && typeof item === 'object' && !Array.isArray(item))
}

/**
 * Deep merge two objects.
 * @param target
 * @param sources
 */
function mergeDeep (target: any, ...sources: any[]): Object {
  if (sources.length === 0) {
    return target
  }
  const source = sources.shift()
  if (source != null) {
    if (isObject(target) && isObject(source)) {
      for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          if (isObject(source[key])) {
            if (target[key] == null) {
              Object.assign(target, { [key]: {} })
            }
            mergeDeep(target[key], source[key])
          } else {
            Object.assign(target, { [key]: source[key] })
          }
        }
      }
    }
  }
  return mergeDeep(target, ...sources)
}

/**
 * @field methodSuffix - allows use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask
 * @field jsonStringifyRequest - should be 'true' for Metamask, false for ganache
 */
export interface GSNConfig {
  methodSuffix: string
  jsonStringifyRequest: boolean
  relayTimeoutGrace: number
  gtxdatanonzero: number
  sliceSize: number
  verbose: boolean
  gasPriceFactorPercent: number
  minGasPrice: number
  maxRelayNonceGap: number
  relayHubAddress: Address
  chainId: number
}

export interface GSNDependencies {
  httpClient: HttpClient
  contractInteractor: ContractInteractor
  knownRelaysManager: KnownRelaysManager
  accountManager: AccountManager
  transactionValidator: RelayedTransactionValidator
  pingFilter: PingFilter
  relayFilter: RelayFilter
  asyncApprove: AsyncApprove
  config: GSNConfig
}

export function getDependencies (config: GSNConfig, provider?: HttpProvider, overrideDependencies?: Partial<GSNDependencies>): GSNDependencies {
  let accountManager = overrideDependencies?.accountManager
  if (accountManager == null) {
    if (provider != null) {
      accountManager = new AccountManager(provider, defaultEnvironment.chainId, config)
    } else {
      throw new Error('either account manager or web3 provider must be non-null')
    }
  }

  let contractInteractor = overrideDependencies?.contractInteractor
  if (contractInteractor == null) {
    if (provider != null) {
      contractInteractor = new ContractInteractor(provider, config)
    } else {
      throw new Error('either contract interactor or web3 provider must be non-null')
    }
  }

  const httpClient = overrideDependencies?.httpClient ?? new HttpClient(new HttpWrapper(), config)
  const pingFilter = overrideDependencies?.pingFilter ?? GasPricePingFilter
  const relayFilter = overrideDependencies?.relayFilter ?? EmptyFilter
  const asyncApprove = overrideDependencies?.asyncApprove ?? EmptyApprove
  const knownRelaysManager = overrideDependencies?.knownRelaysManager ?? new KnownRelaysManager(contractInteractor, relayFilter, config)
  const transactionValidator = overrideDependencies?.transactionValidator ?? new RelayedTransactionValidator(contractInteractor, config)
  return {
    httpClient,
    contractInteractor,
    knownRelaysManager,
    accountManager,
    transactionValidator,
    pingFilter,
    relayFilter,
    asyncApprove,
    config
  }
}
