import {
  Address,
  IntString,
  NpmLogLevel
} from './types/Aliases'
import { Environment } from './Environments'
import { EIP712Domain } from './EIP712/TypedRequestData'

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

/**
 * The interface describing all possible configuration parameters for a GSN Provider.
 * Note that you probably do not need to modify most of these parameters.
 * They exist to support all possible combinations of use-cases and networks.
 */
export interface GSNConfig {
  /**
   * The list of Relay Server to be tried first.
   * Entries must be full Relay Servers URLs.
   */
  preferredRelays: string[]

  /**
   * The list of Relay Server not to be used.
   * Entries must be either a host URL or a manager address.
   */
  blacklistedRelays: string[]

  /**
   * In case of querying large block ranges is restricted, set limit and use pagination.
   */
  pastEventsQueryMaxPageSize: number

  /**
   * When querying a large range with a small 'pastEventsQueryMaxPageSize' the number of pages may become insane.
   */
  pastEventsQueryMaxPageCount: number

  /**
   * Allows the use of versioned methods, i.e. 'eth_signTypedData_v4'. Should be '_v4' for Metamask.
   */
  methodSuffix: string

  /**
   * Should be 'true' for Metamask, false for Ganache.
   */
  jsonStringifyRequest: boolean

  /**
   * The SemVer string defining which contracts versions are supported.
   */
  requiredVersionRange?: string

  /**
   * Provider will forget the Relay Server failures that occurred more than 'relayTimeoutGrace' seconds ago.
   */
  relayTimeoutGrace: number

  /**
   * The object representing configuration for remote logs collection service.
   */
  loggerConfiguration?: LoggerConfiguration

  /**
   * The 'gasPrice'/'maxPriorityFeePerGas' reported by the network will be increased by this value, in percents.
   */
  gasPriceFactorPercent: number

  /**
   * The number of past blocks to query in 'eth_getGasFees' RPC request.
   */
  getGasFeesBlocks: number

  /**
   * The miner reward "percentile" to query in 'eth_getGasFees' RPC request.
   */
  getGasFeesPercentile: number

  /**
   * The URL to access to get the gas price from.
   * This is done instead of reading the 'gasPrice'/'maxPriorityFeePerGas' from the RPC node.
   */
  gasPriceOracleUrl: string

  /**
   * For JSON response format, the field to get from the object.
   */
  gasPriceOraclePath: string

  /**
   * The absolute maximum priority gas fee the Relay Provider is willing to pay.
   */
  minMaxPriorityFeePerGas: number

  /**
   * The maximum number of transactions allowed between last known to the client and returned by the Relay Server.
   */
  maxRelayNonceGap: number

  /**
   * The address of the Payamster contract to be used.
   */
  paymasterAddress?: Address

  /**
  * The address of the token paymaster contract used by TokenPaymasterProvider
  */
  tokenPaymasterAddress: Address

  /**
  * Fields required by TokenPaymasterProvider for the supported tokens
  */
  tokenPaymasterDomainSeparators: Record<Address, EIP712Domain>

  /**
   * If set to 'true' the Relay will not perform an ERC-165 interfaces check on the GSN contracts.
   */
  skipErc165Check: boolean

  /**
   * Value used to identify applications in RelayRequests.
   */
  clientId: IntString

  /**
   * The number of Penalizer Relay Servers to send the signed transaction for audit.
   */
  auditorsCount: number

  /**
   * The number of seconds the RelayRequest will be valid for.
   */
  requestValidSeconds: number

  /**
   * @deprecated
   */
  maxViewableGasLimit: IntString

  /**
   * The name of preconfigured network. Supported values: "ganacheLocal", "ethereumMainnet", "arbitrum".
   */
  environment: Environment

  /**
   * The maximum length of the 'approvalData' parameter.
   */
  maxApprovalDataLength: number

  /**
   * The maximum length of the 'approvalData' parameter.
   */
  maxPaymasterDataLength: number

  /**
   * The URL that will be read to fill in the necessary fields in client configuration.
   */
  clientDefaultConfigUrl: string

  /**
   * If set to 'true' the client will request the default configuration from {@link clientDefaultConfigUrl}.
   */
  useClientDefaultConfigUrl: boolean

  /**
   * If set to 'true' the client will make the view call to the RelayHub before requesting user signature for Request.
   */
  performDryRunViewRelayCall: boolean

  /**
   * The number of Relay Servers to be pinged simultaneously.
   */
  waitForSuccessSliceSize: number

  /**
   * The number of milliseconds to wait after the first Relay Server responds to the ping before picking a winner.
   */
  waitForSuccessPingGrace: number

  /**
   * The name of the EIP-712 Domain Separator field. Note that this is usually the name of the requiest the
   * users will see in MetaMask or other wallets.
   * Note: The domain type must be first registered on-chain by calling 'Forwarder::registerDomainSeparator'.
   */
  domainSeparatorName: string
}
