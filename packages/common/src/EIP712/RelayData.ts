import { type Address, type IntString } from '../types/Aliases'
import { type PrefixedHexString } from 'ethereumjs-util'

export interface RelayData {
  maxFeePerGas: IntString
  maxPriorityFeePerGas: IntString
  transactionCalldataGasUsed: IntString
  relayWorker: Address
  paymaster: Address
  paymasterData: PrefixedHexString
  clientId: IntString
  forwarder: Address
}
