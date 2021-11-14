import { Address, IntString } from '../types/Aliases'
import { PrefixedHexString } from 'ethereumjs-util'

export interface BaseRelayData {
  pctRelayFee: IntString
  baseRelayFee: IntString
  transactionCalldataGasUsed: IntString
  relayWorker: Address
  paymaster: Address
  paymasterData: PrefixedHexString
  clientId: IntString
  forwarder: Address
}

export interface RelayData extends BaseRelayData {
  maxPriorityFeePerGas: IntString
  maxFeePerGas: IntString
}
