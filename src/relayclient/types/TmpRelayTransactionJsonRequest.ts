import { PrefixedHexString } from 'ethereumjs-tx'
import { Address, IntString } from './Aliases'

export default interface TmpRelayTransactionJsonRequest {
  relayWorker: Address
  data: PrefixedHexString
  approvalData: PrefixedHexString
  signature: PrefixedHexString
  from: Address
  to: Address
  paymaster: Address
  forwarder: Address
  gasPrice: IntString
  gasLimit: IntString
  senderNonce: IntString
  relayMaxNonce: number
  baseRelayFee: IntString
  pctRelayFee: IntString
  relayHubAddress: Address
}
