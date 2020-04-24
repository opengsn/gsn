import { HttpProvider } from 'web3-core'
import { Address, AsyncApprovalData, AsyncScoreCalculator, PingFilter, RelayFilter } from './types/Aliases'
import { defaultEnvironment } from './types/Environments'
import HttpClient from './HttpClient'
import ContractInteractor from './ContractInteractor'
import KnownRelaysManager, { DefaultRelayScore, EmptyFilter, IKnownRelaysManager } from './KnownRelaysManager'
import AccountManager from './AccountManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import HttpWrapper from './HttpWrapper'
import { EmptyApprovalData, GasPricePingFilter } from './RelayClient'

const GAS_PRICE_PERCENT = 20
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800

const defaultGsnConfig: GSNConfig = {
  preferredRelays: [],
  relayLookupWindowBlocks: 6000,
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
  stakeManagerAddress: '0x0000000000000000000000000000000000000000',
  paymasterAddress: '0x0000000000000000000000000000000000000000',
  verbose: false
}

/**
 * All classes in GSN must be configured correctly with non-null values.
 * Yet it is tedious to provide default values to all configuration fields on new instance creation.
 * This helper allows users to provide only the overrides and the remainder of values will be set automatically.
 */
export function configureGSN (partialConfig: Partial<GSNConfig>): GSNConfig {
  return Object.assign({}, defaultGsnConfig, partialConfig) as GSNConfig
}

/**
 * @field methodSuffix - allows use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask
 * @field jsonStringifyRequest - should be 'true' for Metamask, false for ganache
 */
export interface GSNConfig {
  preferredRelays: string[]
  relayLookupWindowBlocks: number
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
  stakeManagerAddress: Address
  paymasterAddress: Address
  chainId: number
}

export interface GSNDependencies {
  httpClient: HttpClient
  contractInteractor: ContractInteractor
  knownRelaysManager: IKnownRelaysManager
  accountManager: AccountManager
  transactionValidator: RelayedTransactionValidator
  pingFilter: PingFilter
  relayFilter: RelayFilter
  asyncApprovalData: AsyncApprovalData
  scoreCalculator: AsyncScoreCalculator
  config: GSNConfig
}

export function getDependencies (config: GSNConfig, provider?: HttpProvider, overrideDependencies?: Partial<GSNDependencies>): GSNDependencies {
  let accountManager = overrideDependencies?.accountManager
  if (accountManager == null) {
    if (provider != null) {
      accountManager = new AccountManager(provider, config.chainId ?? defaultEnvironment.chainId, config)
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
  const asyncApprovalData = overrideDependencies?.asyncApprovalData ?? EmptyApprovalData
  const scoreCalculator = overrideDependencies?.scoreCalculator ?? DefaultRelayScore
  const knownRelaysManager = overrideDependencies?.knownRelaysManager ?? new KnownRelaysManager(contractInteractor, config, relayFilter)
  const transactionValidator = overrideDependencies?.transactionValidator ?? new RelayedTransactionValidator(contractInteractor, config)
  return {
    httpClient,
    contractInteractor,
    knownRelaysManager,
    accountManager,
    transactionValidator,
    pingFilter,
    relayFilter,
    asyncApprovalData,
    scoreCalculator,
    config
  }
}
