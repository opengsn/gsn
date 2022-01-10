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
  networks: Record<number|string, ConfigEntry>
}

export interface ConfigEntry {
  name: string
  gsnConfig: Partial<GSNConfig>
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
  minMaxPriorityFeePerGas: number
  maxRelayNonceGap: number
  paymasterAddress?: Address
  clientId: IntString
  auditorsCount: number
  requestValidBlocks: IntString
  maxViewableGasLimit: IntString
  environment: Environment
  maxApprovalDataLength: number
  maxPaymasterDataLength: number
  useGsnDocsConfig: boolean
}
