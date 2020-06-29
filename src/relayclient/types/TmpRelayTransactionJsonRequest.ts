import { PrefixedHexString } from 'ethereumjs-tx'
import { Address, IntString } from './Aliases'

export default interface TmpRelayTransactionJsonRequest {
  relayWorker: Address
  data: PrefixedHexString
  approvalData: PrefixedHexString
  signature: PrefixedHexString
  from: Address
  to: Address
  value: IntString
  paymaster: Address
  paymasterData: PrefixedHexString
  clientId: IntString
  forwarder: Address
  gasPrice: IntString
  gasLimit: IntString
  senderNonce: IntString
  relayMaxNonce: number
  baseRelayFee: IntString
  pctRelayFee: IntString
  relayHubAddress: Address
}
