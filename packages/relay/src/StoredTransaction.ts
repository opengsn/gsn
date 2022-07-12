import { Capability, FeeMarketEIP1559Transaction, Transaction, TypedTransaction } from '@ethereumjs/tx'
import * as ethUtils from 'ethereumjs-util'
import { PrefixedHexString } from 'ethereumjs-util'
import { Address } from '@opengsn/common'

export enum ServerAction {
  REGISTER_SERVER,
  ADD_WORKER,
  RELAY_CALL,
  VALUE_TRANSFER,
  DEPOSIT_WITHDRAWAL,
  PENALIZATION,
  SET_OWNER,
  AUTHORIZE_HUB
}

export interface StoredTransactionMetadata {
  readonly from: Address
  readonly attempts: number
  readonly serverAction: ServerAction
  readonly creationBlock: ShortBlockInfo
  readonly boostBlock?: ShortBlockInfo
  readonly minedBlock?: ShortBlockInfo
}

export interface StoredTransactionSerialized {
  readonly to: Address
  readonly gas: number
  maxFeePerGas: number
  maxPriorityFeePerGas: number
  readonly data: PrefixedHexString
  readonly nonce: number
  readonly txId: PrefixedHexString
  readonly value: PrefixedHexString
  readonly rawSerializedTx: PrefixedHexString
}

export interface NonceSigner {
  nonceSigner?: {
    nonce: number
    signer: Address
  }
}

export interface ShortBlockInfo {
  hash: PrefixedHexString
  number: number
  timestamp: number | string
}

export type StoredTransaction = StoredTransactionSerialized & StoredTransactionMetadata & NonceSigner

/**
 * Make sure not to pass {@link StoredTransaction} as {@param metadata}, as it will override fields from {@param tx}!
 * @param tx
 * @param metadata
 */
export function createStoredTransaction (tx: TypedTransaction, metadata: StoredTransactionMetadata): StoredTransaction {
  if (tx.to == null) {
    throw new Error('tx.to must be defined')
  }
  const details: Partial<StoredTransactionSerialized> =
    {
      to: ethUtils.bufferToHex(tx.to.toBuffer()),
      gas: ethUtils.bufferToInt(tx.gasLimit.toBuffer()),
      data: ethUtils.bufferToHex(tx.data),
      nonce: ethUtils.bufferToInt(tx.nonce.toBuffer()),
      txId: ethUtils.bufferToHex(tx.hash()),
      value: ethUtils.bufferToHex(tx.value.toBuffer()),
      rawSerializedTx: ethUtils.bufferToHex(tx.serialize())
    }
  if (tx.supports(Capability.EIP1559FeeMarket)) {
    tx = tx as FeeMarketEIP1559Transaction
    details.maxFeePerGas = ethUtils.bufferToInt(tx.maxFeePerGas.toBuffer())
    details.maxPriorityFeePerGas = ethUtils.bufferToInt(tx.maxPriorityFeePerGas.toBuffer())
  } else {
    tx = tx as Transaction
    details.maxFeePerGas = ethUtils.bufferToInt(tx.gasPrice.toBuffer())
    details.maxPriorityFeePerGas = ethUtils.bufferToInt(tx.gasPrice.toBuffer())
  }
  return Object.assign({}, details as StoredTransactionSerialized, metadata)
}
