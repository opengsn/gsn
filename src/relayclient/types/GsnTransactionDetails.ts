import { Address } from './Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export default interface GsnTransactionDetails {
  // Added by the Web3 call stack:
  readonly from: Address
  readonly data: PrefixedHexString
  readonly to: Address
  readonly gas: PrefixedHexString

  gasPrice: PrefixedHexString

  // Required parameters for GSN:
  readonly forwarder: Address
  readonly paymaster: Address

  // Optional parameters for RelayProvider only:
  /**
   * Set to 'false' to create a direct transaction
   */
  readonly useGSN?: boolean

  /**
   * Use this to force the {@link RelayClient} to use provided gas price instead of calculated one.
   */
  readonly forceGasPrice?: PrefixedHexString
}
