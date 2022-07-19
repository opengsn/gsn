import { Address, IntString } from '../types/Aliases'
import { PrefixedHexString } from 'ethereumjs-util'

type addresses = 'from' | 'to'
type data = 'data'
type intStrings = 'value' | 'nonce' | 'gas' | 'validUntilTime'

export type ForwardRequest = Record<addresses, Address> & Record<data, PrefixedHexString> & Record<intStrings, IntString>
