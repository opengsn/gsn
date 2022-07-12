import {
  AsyncDataCallback,
  ContractInteractor,
  GSNConfig,
  HttpClient,
  LoggerConfiguration,
  LoggerInterface,
  PingFilter,
  RelayFilter,
  defaultEnvironment,
  gsnRequiredVersion,
  gsnRuntimeVersion
} from '@opengsn/common'

import { AccountManager } from './AccountManager'

import { KnownRelaysManager } from './KnownRelaysManager'
import { RelayedTransactionValidator } from './RelayedTransactionValidator'

export type { GSNConfig } from '@opengsn/common'

const GAS_PRICE_PERCENT = 20
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800

export const defaultLoggerConfiguration: LoggerConfiguration = {
  logLevel: 'info'
}

export const defaultGsnConfig: GSNConfig = {
  preferredRelays: [],
  blacklistedRelays: [],
  pastEventsQueryMaxPageSize: Number.MAX_SAFE_INTEGER,
  gasPriceFactorPercent: GAS_PRICE_PERCENT,
  gasPriceOracleUrl: '',
  gasPriceOraclePath: '',
  minMaxPriorityFeePerGas: 1e9,
  maxRelayNonceGap: MAX_RELAY_NONCE_GAP,
  relayTimeoutGrace: DEFAULT_RELAY_TIMEOUT_GRACE_SEC,
  methodSuffix: '_v4',
  requiredVersionRange: gsnRequiredVersion,
  jsonStringifyRequest: true,
  auditorsCount: 0,
  skipErc165Check: false,
  clientId: '1',
  requestValidSeconds: 172800, // 2 days
  maxViewableGasLimit: '12000000',
  environment: defaultEnvironment,
  maxApprovalDataLength: 0,
  maxPaymasterDataLength: 0,
  clientDefaultConfigUrl: `https://client-config.opengsn.org/${gsnRuntimeVersion}/client-config.json`,
  useClientDefaultConfigUrl: true,
  performDryRunViewRelayCall: true,
  waitForSuccessSliceSize: 3,
  waitForSuccessPingGrace: 3000
}

export interface GSNDependencies {
  httpClient: HttpClient
  logger?: LoggerInterface
  contractInteractor: ContractInteractor
  knownRelaysManager: KnownRelaysManager
  accountManager: AccountManager
  transactionValidator: RelayedTransactionValidator
  pingFilter: PingFilter
  relayFilter: RelayFilter
  asyncApprovalData: AsyncDataCallback
  asyncPaymasterData: AsyncDataCallback
}
