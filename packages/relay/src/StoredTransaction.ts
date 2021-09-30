import { Transaction } from '@ethereumjs/tx'
import { PrefixedHexString } from 'ethereumjs-util'
import * as ethUtils from 'ethereumjs-util'
import { Address } from '@opengsn/common/dist/types/Aliases'

export enum ServerAction {
  REGISTER_SERVER,
  ADD_WORKER,
  RELAY_CALL,
  VALUE_TRANSFER,
  DEPOSIT_WITHDRAWAL,
  PENALIZATION,
  SET_OWNER
}

export interface StoredTransactionMetadata {
  readonly from: Address
  readonly attempts: number
  readonly serverAction: ServerAction
  readonly creationBlockNumber: number
  readonly boostBlockNumber?: number
  readonly minedBlockNumber?: number
}

export interface StoredTransactionSerialized {
  readonly to: Address
  readonly gas: number
  readonly gasPrice: number
  readonly data: PrefixedHexString
  readonly nonce: number
  readonly txId: PrefixedHexString
  readonly value: PrefixedHexString
}

export interface NonceSigner {
  nonceSigner?: {
    nonce: number
    signer: Address
  }
}

export type StoredTransaction = StoredTransactionSerialized & StoredTransactionMetadata & NonceSigner

/**
 * Make sure not to pass {@link StoredTransaction} as {@param metadata}, as it will override fields from {@param tx}!
 * @param tx
 * @param metadata
 */
export function createStoredTransaction (tx: Transaction, metadata: StoredTransactionMetadata): StoredTransaction {
  if (tx.to == null) {
    throw new Error('tx.to must be defined')
  }
  const details: StoredTransactionSerialized = {
    to: ethUtils.bufferToHex(tx.to.toBuffer()),
    gas: ethUtils.bufferToInt(tx.gasLimit.toBuffer()),
    gasPrice: ethUtils.bufferToInt(tx.gasPrice.toBuffer()),
    data: ethUtils.bufferToHex(tx.data),
    nonce: ethUtils.bufferToInt(tx.nonce.toBuffer()),
    txId: ethUtils.bufferToHex(tx.hash()),
    value: ethUtils.bufferToHex(tx.value.toBuffer())
  }
  return Object.assign({}, details, metadata)
}
