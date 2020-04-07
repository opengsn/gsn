import { Address } from './Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface GsnTransactionDetails {
  // Added by the Web3 call stack
  from: Address
  data: PrefixedHexString
  to: Address
  gas: PrefixedHexString
  gasPrice: PrefixedHexString

  // Required parameters for GSN
  forwarder: Address
  paymaster: Address

  // Optional parameters for RelayProvider only
  useGSN?: boolean
}
