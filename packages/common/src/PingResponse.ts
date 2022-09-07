import { Address, IntString } from './types/Aliases'

export interface PingResponse {
  relayWorkerAddress: Address
  relayManagerAddress: Address
  relayHubAddress: Address
  ownerAddress: Address
  maxMaxFeePerGas: IntString
  minMaxFeePerGas: IntString
  minMaxPriorityFeePerGas: IntString
  maxAcceptanceBudget: IntString
  networkId?: IntString
  chainId?: IntString
  ready: boolean
  version: string
}
