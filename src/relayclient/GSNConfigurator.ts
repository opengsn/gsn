import { Address } from './types/Aliases'
import { defaultEnvironment } from './types/Environments'

const GAS_PRICE_PERCENT = 20
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800

const defaultGsnConfig: GSNConfig = {
  contractInteractorConfig: {
    gtxdatanonzero: defaultEnvironment.gtxdatanonzero,
    verbose: false
  },
  relayClientConfig: {
    gasPriceFactorPercent: GAS_PRICE_PERCENT,
    minGasPrice: 0,
    maxRelayNonceGap: MAX_RELAY_NONCE_GAP,
    verbose: false,
    relaySelectionManagerConfig: {
      sliceSize: 3,
      verbose: false
    }
  },
  knownRelaysManagerConfig: {
    relayTimeoutGrace: DEFAULT_RELAY_TIMEOUT_GRACE_SEC,
    verbose: false
  },
  transactionValidatorConfig: {
    verbose: false
  },
  relayProviderConfig: {
    verbose: false
  },
  accountManagerConfig: {
    verbose: false,
    methodSuffix: '',
    jsonStringifyRequest: false
  },
  chainId: defaultEnvironment.chainId,
  relayHubAddress: '0x0000000000000000000000000000000000000000'
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
  return mergeDeep(target, ...sources)
}

/**
 * @field methodSuffix - allows use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask
 * @field jsonStringifyRequest - should be 'true' for Metamask, false for ganache
 */
export interface AccountManagerConfig {
  verbose: boolean
  methodSuffix: string
  jsonStringifyRequest: boolean
}

export interface KnownRelaysManagerConfig {
  verbose: boolean
  relayTimeoutGrace: number
}

export interface ContractInteractorConfig {
  gtxdatanonzero: number
  verbose: boolean
}

export interface TransactionValidatorConfig {
  verbose: boolean
}

export interface RelayProviderConfig {
  verbose: boolean
}

export interface RelaySelectionManagerConfig {
  verbose: boolean
  sliceSize: number
}

export interface RelayClientConfig {
  verbose: boolean
  gasPriceFactorPercent: number
  minGasPrice: number
  maxRelayNonceGap: number
  relaySelectionManagerConfig: RelaySelectionManagerConfig
}

export interface GSNConfig {
  contractInteractorConfig: ContractInteractorConfig
  relayClientConfig: RelayClientConfig
  knownRelaysManagerConfig: KnownRelaysManagerConfig
  transactionValidatorConfig: TransactionValidatorConfig
  accountManagerConfig: AccountManagerConfig
  relayProviderConfig: RelayProviderConfig
  relayHubAddress: Address
  chainId: number
}
