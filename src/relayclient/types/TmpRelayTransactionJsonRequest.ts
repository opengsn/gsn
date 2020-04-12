import { PrefixedHexString } from 'ethereumjs-tx'
import { Address, IntString } from './Aliases'

export default interface TmpRelayTransactionJsonRequest {
  relayWorker: Address
  encodedFunction: PrefixedHexString
  approvalData: PrefixedHexString
  signature: PrefixedHexString
  from: Address
  to: Address
  paymaster: Address
  gasPrice: IntString
  gasLimit: IntString
  senderNonce: number
  relayMaxNonce: number
  baseRelayFee: IntString
  pctRelayFee: IntString
  relayHubAddress: Address
}
