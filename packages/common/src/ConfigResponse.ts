import {
  Address,
  IntString,
  NpmLogLevel
} from './types/Aliases'
import { Environment } from './Environments'

export interface LoggerConfiguration {
  logLevel: NpmLogLevel
  loggerUrl?: string
  userId?: string
  applicationId?: string
}

export interface ConfigResponse {
  networks: Record<number, ConfigEntry>
}

export interface ConfigEntry {
  name: string
  gsnConfig: Partial<GSNConfig>
}

export interface GSNConfig {
  preferredRelays: string[]
  // either a url host or a manager address
  blacklistedRelays: string[]
  // in case querying large block ranges is restricted, set limit and use pagination
  pastEventsQueryMaxPageSize: number
  // allows use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask
  methodSuffix: string
  // should be 'true' for Metamask, false for ganache
  jsonStringifyRequest: boolean
  requiredVersionRange?: string
  relayTimeoutGrace: number
  loggerConfiguration?: LoggerConfiguration
  gasPriceFactorPercent: number
  gasPriceOracleUrl: string
  gasPriceOraclePath: string
  minMaxPriorityFeePerGas: number
  maxRelayNonceGap: number
  paymasterAddress?: Address
  skipErc165Check: boolean
  clientId: IntString
  auditorsCount: number
  requestValidSeconds: number
  maxViewableGasLimit: IntString
  environment: Environment
  maxApprovalDataLength: number
  maxPaymasterDataLength: number
  clientDefaultConfigUrl: string
  useClientDefaultConfigUrl: boolean
  performDryRunViewRelayCall: boolean
  waitForSuccessSliceSize: number
  waitForSuccessPingGrace: number
}
