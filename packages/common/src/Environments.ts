import { RelayHubConfiguration } from './types/RelayHubConfiguration'
import { PaymasterConfiguration } from './types/PaymasterConfiguration'
import { PenalizerConfiguration } from './types/PenalizerConfiguration'

export interface DeploymentConfiguration {
  readonly registrationMaxAge: number
  readonly minimumStakePerToken: { [key: string]: string }
  readonly paymasterDeposit: string
  readonly deployTestPaymaster: boolean
  readonly isArbitrum?: boolean
}

export interface Environment {
  readonly chainId: number
  readonly mintxgascost: number
  readonly relayHubConfiguration: RelayHubConfiguration
  readonly penalizerConfiguration: PenalizerConfiguration
  readonly paymasterConfiguration: PaymasterConfiguration
  readonly deploymentConfiguration?: DeploymentConfiguration
  readonly maxUnstakeDelay: number
  readonly abandonmentDelay: number
  readonly escheatmentDelay: number
  readonly gtxdatanonzero: number
  readonly gtxdatazero: number
  readonly dataOnChainHandlingGasCostPerByte: number
  readonly getGasPriceFactor: number
  readonly nonZeroDevFeeGasOverhead: number
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
  gasOverhead: 55596,
  postOverhead: 16425,
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
  dataOnChainHandlingGasCostPerByte: 13,
  chainId: 1,
  relayHubConfiguration: defaultRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  abandonmentDelay: 31536000, // 1 year
  escheatmentDelay: 2629746, // 1 month
  mintxgascost: 21000,
  gtxdatanonzero: 16,
  gtxdatazero: 4,
  getGasPriceFactor: 1,
  nonZeroDevFeeGasOverhead: 5605
}

const ganacheLocal: Environment = {
  dataOnChainHandlingGasCostPerByte: 13,
  chainId: 1337,
  relayHubConfiguration: defaultRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  abandonmentDelay: 1000,
  escheatmentDelay: 500,
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

const arbitrum: Environment = {
  dataOnChainHandlingGasCostPerByte: 13, // TODO: check if memory allocation costs in Arbitrum are unchanged!
  relayHubConfiguration: arbitrumRelayHubConfiguration,
  penalizerConfiguration: defaultPenalizerConfiguration,
  paymasterConfiguration: defaultPaymasterConfiguration,
  maxUnstakeDelay: defaultStakeManagerMaxUnstakeDelay,
  chainId: 421611,
  mintxgascost: 700000,
  gtxdatanonzero: 2024,
  gtxdatazero: 506,
  abandonmentDelay: 31536000, // 1 year
  escheatmentDelay: 2629746, // 1 month
  // there is currently a hard-coded to be 2 at arbitrum:eth.go:43 (commit: 12483cfa17a29e7d68c354c456ebc371b05a6ea2)
  // setting factor to 0.6 instead of 0.5 to allow the transaction to pass in case of moderate gas price increase
  // note that excess will be collected by the Relay Server as an extra profit
  getGasPriceFactor: 0.6,
  nonZeroDevFeeGasOverhead: 5605
}

/* end Arbitrum-specific Environment */

export enum EnvironmentsKeys {
  ganacheLocal = 'ganacheLocal',
  ethereumMainnet = 'ethereumMainnet',
  arbitrum = 'arbitrum'
}

export const environments: { [key in EnvironmentsKeys]: Environment } = {
  ethereumMainnet,
  ganacheLocal,
  arbitrum
}

export function getEnvironment (chainId: number): { name: EnvironmentsKeys, environment: Environment } | undefined {
  const name = Object.keys(environments).find(env => environments[env as EnvironmentsKeys].chainId === chainId) as EnvironmentsKeys
  if (name == null) {
    return undefined
  }
  const environment = environments[name]
  return { name, environment }
}

export const defaultEnvironment = environments.ganacheLocal
