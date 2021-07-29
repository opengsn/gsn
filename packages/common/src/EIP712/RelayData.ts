import { Address, IntString } from '../types/Aliases'
import { PrefixedHexString } from 'ethereumjs-util'

export interface RelayData {
  gasPrice: IntString
  pctRelayFee: IntString
  baseRelayFee: IntString
  relayWorker: Address
  paymaster: Address
  paymasterData: PrefixedHexString
  clientId: IntString
  forwarder: Address
}
