import { HttpProvider } from 'web3-core'
import { Address, AsyncDataCallback, AsyncScoreCalculator, IntString, PingFilter, RelayFilter } from './types/Aliases'
import { defaultEnvironment } from '../common/Environments'
import HttpClient from './HttpClient'
import ContractInteractor from './ContractInteractor'
import KnownRelaysManager, { DefaultRelayScore, EmptyFilter, IKnownRelaysManager } from './KnownRelaysManager'
import AccountManager from './AccountManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import HttpWrapper from './HttpWrapper'
import { EmptyDataCallback, GasPricePingFilter } from './RelayClient'
import { constants } from '../common/Constants'

const GAS_PRICE_PERCENT = 20
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800

const defaultGsnConfig: GSNConfig = {
  preferredRelays: [],
  relayLookupWindowBlocks: 6000,
  gasPriceFactorPercent: GAS_PRICE_PERCENT,
  minGasPrice: 0,
  maxRelayNonceGap: MAX_RELAY_NONCE_GAP,
  sliceSize: 3,
  relayTimeoutGrace: DEFAULT_RELAY_TIMEOUT_GRACE_SEC,
  methodSuffix: '',
  jsonStringifyRequest: false,
  chainId: defaultEnvironment.chainId,
  relayHubAddress: constants.ZERO_ADDRESS,
  stakeManagerAddress: constants.ZERO_ADDRESS,
  paymasterAddress: constants.ZERO_ADDRESS,
  forwarderAddress: constants.ZERO_ADDRESS,
  verbose: false,
  clientId: '1'
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
  sliceSize: number
  verbose: boolean
  gasPriceFactorPercent: number
  minGasPrice: number
  maxRelayNonceGap: number
  relayHubAddress: Address
  stakeManagerAddress: Address
  paymasterAddress: Address
  forwarderAddress: Address
  chainId: number
  clientId: IntString
}

export interface GSNDependencies {
  httpClient: HttpClient
  contractInteractor: ContractInteractor
  knownRelaysManager: IKnownRelaysManager
  accountManager: AccountManager
  transactionValidator: RelayedTransactionValidator
  pingFilter: PingFilter
  relayFilter: RelayFilter
  asyncApprovalData: AsyncDataCallback
  asyncPaymasterData: AsyncDataCallback
  scoreCalculator: AsyncScoreCalculator
  config: GSNConfig
}

export function getDependencies (config: GSNConfig, provider?: HttpProvider, overrideDependencies?: Partial<GSNDependencies>): GSNDependencies {
  let contractInteractor = overrideDependencies?.contractInteractor
  if (contractInteractor == null) {
    if (provider != null) {
      contractInteractor = new ContractInteractor(provider, config)
    } else {
      throw new Error('either contract interactor or web3 provider must be non-null')
    }
  }

  let accountManager = overrideDependencies?.accountManager
  if (accountManager == null) {
    if (provider != null) {
      accountManager = new AccountManager(provider, config.chainId ?? contractInteractor.getChainId(), config)
    } else {
      throw new Error('either account manager or web3 provider must be non-null')
    }
  }

  const httpClient = overrideDependencies?.httpClient ?? new HttpClient(new HttpWrapper(), config)
  const pingFilter = overrideDependencies?.pingFilter ?? GasPricePingFilter
  const relayFilter = overrideDependencies?.relayFilter ?? EmptyFilter
  const asyncApprovalData = overrideDependencies?.asyncApprovalData ?? EmptyDataCallback
  const asyncPaymasterData = overrideDependencies?.asyncPaymasterData ?? EmptyDataCallback
  const scoreCalculator = overrideDependencies?.scoreCalculator ?? DefaultRelayScore
  const knownRelaysManager = overrideDependencies?.knownRelaysManager ?? new KnownRelaysManager(contractInteractor, config, relayFilter)
  const transactionValidator = overrideDependencies?.transactionValidator ?? new RelayedTransactionValidator(contractInteractor, config)

  const ret = {
    httpClient,
    contractInteractor,
    knownRelaysManager,
    accountManager,
    transactionValidator,
    pingFilter,
    relayFilter,
    asyncApprovalData,
    asyncPaymasterData,
    scoreCalculator,
    config
  }

  // sanity check: overrides must not contain unknown fields.
  for (const key in overrideDependencies) {
    if ((ret as any)[key] == null) {
      throw new Error(`Unexpected override key ${key}`)
    }
  }

  return ret
}
