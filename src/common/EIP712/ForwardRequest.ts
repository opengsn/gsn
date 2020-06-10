import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface ForwardRequest {
  target: Address
  encodedFunction: PrefixedHexString
  senderAddress: Address
  senderNonce: IntString
  gasLimit: IntString
}
