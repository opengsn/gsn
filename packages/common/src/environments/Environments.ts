import { RelayHubConfiguration } from '../types/RelayHubConfiguration'
import { PaymasterConfiguration } from '../types/PaymasterConfiguration'
import { PenalizerConfiguration } from '../types/PenalizerConfiguration'
import { constants } from '../Constants'

export interface DeploymentConfiguration {
  readonly registrationMaxAge: number
  readonly minimumStakePerToken: { [key: string]: string }
  readonly paymasterDeposit: string
  readonly deployTestPaymaster: boolean
  readonly deploySingleRecipientPaymaster: boolean
  readonly isArbitrum?: boolean
}

export enum EnvironmentsKeys {
  ethereumMainnet = 'ethereumMainnet',
  arbitrum = 'arbitrum'
}

export interface Environment {
  readonly environmentsKey: EnvironmentsKeys
  readonly mintxgascost: number
  readonly relayHubConfiguration: RelayHubConfiguration
  readonly penalizerConfiguration: PenalizerConfiguration
  readonly paymasterConfiguration: PaymasterConfiguration
  readonly deploymentConfiguration?: DeploymentConfiguration
  readonly stakeBurnAddress: string
  readonly maxUnstakeDelay: number
  readonly abandonmentDelay: number
  readonly escheatmentDelay: number
  readonly gtxdatanonzero: number
  readonly gtxdatazero: number
  readonly dataOnChainHandlingGasCostPerByte: number
  readonly getGasPriceFactor: number
  readonly nonZeroDevFeeGasOverhead: number
  readonly calldataEstimationSlackFactor: number
  readonly useEstimateGasForCalldataCost: boolean
}

// deep (3-level) merge of environments
export function merge (env1: Environment, env2: Partial<Environment>): Environment {
  return Object.assign({}, env1, env2,
    {
      relayHubConfiguration: Object.assign({}, env1.relayHubConfiguration, env2.relayHubConfiguration),
      penalizerConfiguration: Object.assign({}, env1.penalizerConfiguration, env2.penalizerConfiguration),
      paymasterConfiguration: Object.assign({}, env1.paymasterConfiguration, env2.paymasterConfiguration),
      deploymentConfiguration: Object.assign({}, env1.deploymentConfiguration, env2.deploymentConfiguration, {
        minimumStakePerToken: Object.assign({}, env1.deploymentConfiguration?.minimumStakePerToken, env2.deploymentConfiguration?.minimumStakePerToken)
      })
    })
}

/**
 * Maximum unstake delay is defined at around 3 years for the mainnet.
 * This is done to prevent mistakenly setting an unstake delay to millions of years.
 */
const defaultStakeManagerMaxUnstakeDelay: number = 100000000

const defaultPenalizerConfiguration: PenalizerConfiguration = {
  penalizeBlockDelay: 5,
  penalizeBlockExpiration: 60000
}

const defaultRelayHubConfiguration: RelayHubConfiguration = {
  gasOverhead: 34909,
  postOverhead: 38516,
  gasReserve: 100000,
  maxWorkerCount: 10,
  minimumUnstakeDelay: 15000,
  devAddress: '0xeFEfeFEfeFeFEFEFEfefeFeFefEfEfEfeFEFEFEf',
  devFee: 0,
  // TODO STOPSHIP: DECIDE!
  pctRelayFee: 0,
  baseRelayFee: 0
}

// TODO add as constructor params to paymaster instead of constants
const preRelayedCallGasLimit = 1e5
const forwarderHubOverhead = 5e4
const defaultPaymasterConfiguration: PaymasterConfiguration = {
  forwarderHubOverhead: forwarderHubOverhead,
  preRelayedCallGasLimit: preRelayedCallGasLimit,
  postRelayedCallGasLimit: 11e4,
  acceptanceBudget: preRelayedCallGasLimit + forwarderHubOverhead,
  calldataSizeLimit: 10404
}

const ethereumMainnet: Environment = {
  environmentsKey: EnvironmentsKeys.ethereumMainnet,
  calldataEstimationSlackFactor: 1,
  useEstimateGasForCalldataCost: false,
  dataOnChainHandlingGasCostPerByte: 13,
  relayHubConfiguration: defaultRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  stakeBurnAddress: constants.BURN_ADDRESS,
  abandonmentDelay: 31536000, // 1 year
  escheatmentDelay: 2629746, // 1 month
  mintxgascost: 21000,
  gtxdatanonzero: 16,
  gtxdatazero: 4,
  getGasPriceFactor: 1,
  nonZeroDevFeeGasOverhead: 5605
}

/* begin Arbitrum-specific Environment */
const arbitrumRelayHubConfigurationOverride: Partial<RelayHubConfiguration> = {
  gasOverhead: 1000000,
  postOverhead: 0
}

const arbitrumRelayHubConfiguration: RelayHubConfiguration =
  Object.assign({},
    defaultRelayHubConfiguration,
    arbitrumRelayHubConfigurationOverride)

const arbitrum: Environment = Object.assign({}, ethereumMainnet, {
  environmentsKey: EnvironmentsKeys.arbitrum,
  calldataEstimationSlackFactor: 1.3,
  useEstimateGasForCalldataCost: true,
  relayHubConfiguration: arbitrumRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  mintxgascost: 0,
  gtxdatanonzero: 0,
  gtxdatazero: 0,
  // there is currently a hard-coded to be 2 at arbitrum:eth.go:43 (commit: 12483cfa17a29e7d68c354c456ebc371b05a6ea2)
  // setting factor to 0.6 instead of 0.5 to allow the transaction to pass in case of moderate gas price increase
  // note that excess will be collected by the Relay Server as an extra profit
  getGasPriceFactor: 0.6
})

/* end Arbitrum-specific Environment */

export const environments: { [key in EnvironmentsKeys]: Environment } = {
  ethereumMainnet,
  arbitrum
}

export const defaultEnvironment = environments.ethereumMainnet
