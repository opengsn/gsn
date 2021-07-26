import { Address, IntString } from '../types/Aliases'
import { PrefixedHexString } from 'ethereumjs-util'

export interface ForwardRequest {
  from: Address
  to: Address
  data: PrefixedHexString
  value: IntString
  nonce: IntString
  gas: IntString
  validUntil: IntString
}
