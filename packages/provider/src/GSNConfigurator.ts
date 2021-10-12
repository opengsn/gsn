import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

import { AccountManager } from './AccountManager'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { KnownRelaysManager } from './KnownRelaysManager'
import { RelayedTransactionValidator } from './RelayedTransactionValidator'
import {
  Address,
  AsyncDataCallback,
  AsyncScoreCalculator,
  IntString,
  NpmLogLevel,
  PingFilter,
  RelayFilter
} from '@opengsn/common/dist/types/Aliases'
import { gsnRequiredVersion } from '@opengsn/common/dist'

const GAS_PRICE_PERCENT = 20
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800
const DEFAULT_LOOKUP_WINDOW_BLOCKS = 60000

export const defaultLoggerConfiguration: LoggerConfiguration = {
  logLevel: 'info'
}

export const defaultGsnConfig: GSNConfig = {
  preferredRelays: [],
  relayLookupWindowBlocks: DEFAULT_LOOKUP_WINDOW_BLOCKS,
  relayRegistrationLookupBlocks: Number.MAX_SAFE_INTEGER,
  pastEventsQueryMaxPageSize: Number.MAX_SAFE_INTEGER,
  gasPriceFactorPercent: GAS_PRICE_PERCENT,
  gasPriceOracleUrl: '',
  gasPriceOraclePath: '',
  minGasPrice: 0,
  maxRelayNonceGap: MAX_RELAY_NONCE_GAP,
  sliceSize: 3,
  relayTimeoutGrace: DEFAULT_RELAY_TIMEOUT_GRACE_SEC,
  methodSuffix: '_v4',
  requiredVersionRange: gsnRequiredVersion,
  jsonStringifyRequest: true,
  auditorsCount: 1,
  clientId: '1'
}

export interface LoggerConfiguration {
  logLevel: NpmLogLevel
  loggerUrl?: string
  userId?: string
  applicationId?: string
}

/**
 * @field methodSuffix - allows use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask
 * @field jsonStringifyRequest - should be 'true' for Metamask, false for ganache
 */
export interface GSNConfig {
  preferredRelays: string[]
  // number of blocks back the relay will be considered 'active'
  // must match Relay Server's "activityBlockRate" to be able to discover relay consistently
  relayLookupWindowBlocks: number
  // in case access to older logs is restricted, limit number of blocks the client will look for registration info
  // must match Relay Server's "registrationBlockRate" to be able to discover relay consistently
  relayRegistrationLookupBlocks: number
  // in case querying large block ranges is restricted, set limit and use pagination
  pastEventsQueryMaxPageSize: number

  methodSuffix: string
  jsonStringifyRequest: boolean
  requiredVersionRange?: string
  relayTimeoutGrace: number
  sliceSize: number
  loggerConfiguration?: LoggerConfiguration
  gasPriceFactorPercent: number
  gasPriceOracleUrl: string
  gasPriceOraclePath: string
  minGasPrice: number
  maxRelayNonceGap: number
  paymasterAddress?: Address
  clientId: IntString
  auditorsCount: number
  maxViewableGasLimit?: number
}

export interface GSNDependencies {
  httpClient: HttpClient
  logger: LoggerInterface
  contractInteractor: ContractInteractor
  knownRelaysManager: KnownRelaysManager
  accountManager: AccountManager
  transactionValidator: RelayedTransactionValidator
  pingFilter: PingFilter
  relayFilter: RelayFilter
  asyncApprovalData: AsyncDataCallback
  asyncPaymasterData: AsyncDataCallback
  scoreCalculator: AsyncScoreCalculator
}
