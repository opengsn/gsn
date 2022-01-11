import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

import { AccountManager } from './AccountManager'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { KnownRelaysManager } from './KnownRelaysManager'
import { RelayedTransactionValidator } from './RelayedTransactionValidator'
import {
  AsyncDataCallback,
  AsyncScoreCalculator,
  NpmLogLevel,
  PingFilter,
  RelayFilter
} from '@opengsn/common/dist/types/Aliases'
import { gsnRequiredVersion } from '@opengsn/common/dist/Version'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { GSNConfig } from '@opengsn/common/dist/ConfigResponse'
import { gsnRuntimeVersion } from '@opengsn/common/dist'
export type { GSNConfig } from '@opengsn/common/dist/ConfigResponse'

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
  minMaxPriorityFeePerGas: 1e9,
  maxRelayNonceGap: MAX_RELAY_NONCE_GAP,
  sliceSize: 3,
  relayTimeoutGrace: DEFAULT_RELAY_TIMEOUT_GRACE_SEC,
  methodSuffix: '_v4',
  requiredVersionRange: gsnRequiredVersion,
  jsonStringifyRequest: true,
  auditorsCount: 0,
  clientId: '1',
  requestValidBlocks: '6000',
  maxViewableGasLimit: '12000000',
  environment: defaultEnvironment,
  maxApprovalDataLength: 0,
  maxPaymasterDataLength: 0,
  gsnUrl: `https://raw.githubusercontent.com/opengsn/gsn-networks/${gsnRuntimeVersion}/client-config.json`,
  useGsnDocsConfig: true
}

export interface LoggerConfiguration {
  logLevel: NpmLogLevel
  loggerUrl?: string
  userId?: string
  applicationId?: string
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
