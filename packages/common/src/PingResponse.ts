import { Address, IntString } from './types/Aliases'

export interface PingResponse {
  relayWorkerAddress: Address
  relayManagerAddress: Address
  relayHubAddress: Address
  ownerAddress: Address
  minGasPrice: IntString
  maxAcceptanceBudget: IntString
  networkId?: IntString
  chainId?: IntString
  validUntil?: IntString
  ready: boolean
  version: string
}
