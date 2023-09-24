import { type Address, type IntString } from '../types/Aliases'
import { type PrefixedHexString } from 'ethereumjs-util'

type addresses = 'from' | 'to'
type data = 'data'
type intStrings = 'value' | 'nonce' | 'gas' | 'validUntilTime'

export type ForwardRequest = Record<addresses, Address> & Record<data, PrefixedHexString> & Record<intStrings, IntString>
