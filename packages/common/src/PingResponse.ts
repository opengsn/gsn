import { Address, IntString } from './types/Aliases'

export interface PingResponse {
  relayWorkerAddress: Address
  relayManagerAddress: Address
  relayHubAddress: Address
  minGasPrice: IntString
  maxRelayExposure: IntString
  networkId?: IntString
  chainId?: IntString
  ready: boolean
  version: string
}
