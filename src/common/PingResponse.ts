import { Address, IntString } from '../relayclient/types/Aliases'

export default interface PingResponse {
  // TODO: this should be 'worker'
  relayWorkerAddress: Address
  relayManagerAddress: Address
  relayHubAddress: Address
  minGasPrice: IntString
  maxAcceptanceBudget: IntString
  ready: boolean
  version: string
}
