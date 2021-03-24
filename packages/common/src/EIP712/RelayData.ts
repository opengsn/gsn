import { Address, IntString } from '../types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

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
