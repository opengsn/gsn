import ow from 'ow'
import { PrefixedHexString } from 'ethereumjs-util'

import { Address, IntString } from './Aliases'
import { ValidHexString } from '../Utils'

export interface GsnTransactionDetails {
  // Added by the Web3 call stack:
  readonly from: Address
  readonly data: PrefixedHexString
  readonly to: Address

  value?: IntString
  /**
   * TODO: this is horrible. Think about it some more
   * TODO 2: why do these have to be optional? When is it allowed to be null?
   * Do not set this value manually as this value will be overwritten. Use {@link forceGasPrice} instead.
   */
  gas?: PrefixedHexString
  gasPrice?: PrefixedHexString

  // TODO remove; pass it as a separate parameter to the '_prepareRelayHttpRequest'
  gasPriceForLookup?: PrefixedHexString

  // TODO: remove; only used in test, not allowed in Ethers.js
  readonly paymasterData?: PrefixedHexString

  // TODO: remove; only used in test, not allowed in Ethers.js
  readonly clientId?: IntString

  // Optional parameters for RelayProvider only:
  // TODO: remove; only used in test, not allowed in Ethers.js
  /**
   * Set to 'false' to create a direct transaction
   */
  readonly useGSN?: boolean

  /**
   * Use this to force the {@link RelayClient} to use provided gas price instead of calculated one.
   * TODO: remove; only used in test, not allowed in Ethers.js
   */
  readonly forceGasPrice?: PrefixedHexString
}

export const GsnTransactionDetailsShape = {
  from: ow.string.matches(ValidHexString),
  to: ow.string.matches(ValidHexString),
  data: ow.string.matches(ValidHexString),
  value: ow.string.matches(ValidHexString),
  gas: ow.string.matches(ValidHexString),
  gasPrice: ow.string.matches(ValidHexString)
}
