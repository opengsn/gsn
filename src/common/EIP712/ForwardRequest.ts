import { Address, IntString } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface ForwardRequest {
  to: Address
  data: PrefixedHexString
  from: Address
  nonce: IntString
  gas: IntString
}
