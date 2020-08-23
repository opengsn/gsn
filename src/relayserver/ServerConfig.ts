import ContractInteractor from '../relayclient/ContractInteractor'
import { Address } from '../relayclient/types/Aliases'

import { RelayServerRegistryInfo } from './RegistrationManager'
import { TxStoreManager } from './TxStoreManager'
import { KeyManager } from './KeyManager'
import { constants } from '../common/Constants'
import { LogLevelNumbers } from 'loglevel'

export interface ServerConfig extends RelayServerRegistryInfo {
  relayHubAddress: Address
  trustedPaymasters: Address[]
  gasPriceFactor: number
  registrationBlockRate: number
  workerMinBalance: number
  workerTargetBalance: number
  managerMinBalance: number
  managerMinStake: number
  managerTargetBalance: number
  minHubWithdrawalBalance: number
  devMode: boolean
  logLevel: LogLevelNumbers
}

export interface ServerDependencies {
  // TODO: rename as this name is terrible
  managerKeyManager: KeyManager
  workersKeyManager: KeyManager
  contractInteractor: ContractInteractor
  txStoreManager: TxStoreManager
}

const defaultConfiguration: ServerConfig = {
  relayHubAddress: constants.ZERO_ADDRESS,
  trustedPaymasters: [],
  gasPriceFactor: 1,
  registrationBlockRate: 0,
  workerMinBalance: 0.1e18,
  workerTargetBalance: 0.3e18,
  managerMinBalance: 0.1e18, // 0.1 eth
  managerMinStake: 1, // 1 wei
  managerTargetBalance: 0.3e18,
  minHubWithdrawalBalance: 0.1e18,
  devMode: false,
  logLevel: 1,
  baseRelayFee: '0',
  pctRelayFee: 0,
  url: 'http://localhost:8090'
}

export function configureServer (partialConfig: Partial<ServerConfig>): ServerConfig {
  return Object.assign({}, defaultConfiguration, partialConfig) as ServerConfig
}
