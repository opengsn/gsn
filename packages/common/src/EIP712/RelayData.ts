import { Address, IntString } from '../types/Aliases'
import { PrefixedHexString } from 'ethereumjs-util'

export interface RelayData {
  maxFeePerGas: IntString
  maxPriorityFeePerGas: IntString
  pctRelayFee: IntString
  baseRelayFee: IntString
  transactionCalldataGasUsed: IntString
  relayWorker: Address
  paymaster: Address
  paymasterData: PrefixedHexString
  clientId: IntString
  forwarder: Address
}
