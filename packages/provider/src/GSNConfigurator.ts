import {
  ApprovalDataCallback,
  ContractInteractor,
  GSNConfig,
  HttpClient,
  LoggerConfiguration,
  LoggerInterface,
  PaymasterDataCallback,
  PingFilter,
  RelayCallGasLimitCalculationHelper,
  RelayFilter,
  SignTypedDataCallback,
  defaultEnvironment,
  gsnRequiredVersion,
  gsnRuntimeVersion
} from '@opengsn/common'

import { AccountManager } from './AccountManager'

import { KnownRelaysManager } from './KnownRelaysManager'
import { RelayedTransactionValidator } from './RelayedTransactionValidator'

export type { GSNConfig } from '@opengsn/common'

const GAS_PRICE_PERCENT = 20
const GAS_PRICE_SLACK_PERCENT = 80
const MAX_RELAY_NONCE_GAP = 3
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 1800

export const defaultLoggerConfiguration: LoggerConfiguration = {
  logLevel: 'info'
}

export const defaultGsnConfig: GSNConfig = {
  calldataEstimationSlackFactor: 1,
  preferredRelays: [],
  blacklistedRelays: [],
  pastEventsQueryMaxPageSize: Number.MAX_SAFE_INTEGER,
  pastEventsQueryMaxPageCount: 20,
  gasPriceFactorPercent: GAS_PRICE_PERCENT,
  gasPriceSlackPercent: GAS_PRICE_SLACK_PERCENT,
  getGasFeesBlocks: 5,
  getGasFeesPercentile: 50,
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
  maxViewableGasLimit: '20000000',
  minViewableGasLimit: '300000',
  environment: defaultEnvironment,
  maxApprovalDataLength: 0,
  maxPaymasterDataLength: 0,
  clientDefaultConfigUrl: `https://client-config.opengsn.org/${gsnRuntimeVersion}/client-config.json`,
  useClientDefaultConfigUrl: true,
  performDryRunViewRelayCall: true,
  performEstimateGasFromRealSender: false,
  paymasterAddress: '',
  tokenPaymasterDomainSeparators: {},
  waitForSuccessSliceSize: 3,
  waitForSuccessPingGrace: 3000,
  domainSeparatorName: 'GSN Relayed Transaction'
}

export interface GSNDependencies {
  httpClient: HttpClient
  logger?: LoggerInterface
  contractInteractor: ContractInteractor
  gasLimitCalculator: RelayCallGasLimitCalculationHelper
  knownRelaysManager: KnownRelaysManager
  accountManager: AccountManager
  transactionValidator: RelayedTransactionValidator
  pingFilter: PingFilter
  relayFilter: RelayFilter
  asyncApprovalData: ApprovalDataCallback
  asyncPaymasterData: PaymasterDataCallback
  asyncSignTypedData?: SignTypedDataCallback
}
