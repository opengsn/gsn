import { encode, List } from 'rlp'
import {
  Capability,
  FeeMarketEIP1559Transaction,
  Transaction,
  TransactionFactory,
  TxOptions,
  TypedTransaction
} from '@ethereumjs/tx'

import {
  bnToUnpaddedBuffer,
  bufferToHex,
  PrefixedHexString,
  toBuffer,
  unpadBuffer
} from 'ethereumjs-util'

import { signatureRSV2Hex } from '@opengsn/common'

export function getDataAndSignature (tx: TypedTransaction, chainId: number): { data: string, signature: string } {
  if (tx.to == null) {
    throw new Error('tx.to must be defined')
  }
  if (tx.s == null || tx.r == null || tx.v == null) {
    throw new Error('tx signature must be defined')
  }
  const input: List = [bnToUnpaddedBuffer(tx.nonce)]
  if (!tx.supports(Capability.EIP1559FeeMarket)) {
    input.push(
      bnToUnpaddedBuffer((tx as Transaction).gasPrice)
    )
  } else {
    input.push(
      bnToUnpaddedBuffer((tx as FeeMarketEIP1559Transaction).maxPriorityFeePerGas),
      bnToUnpaddedBuffer((tx as FeeMarketEIP1559Transaction).maxFeePerGas)
    )
  }
  input.push(
    bnToUnpaddedBuffer(tx.gasLimit),
    tx.to.toBuffer(),
    bnToUnpaddedBuffer(tx.value),
    tx.data,
    toBuffer(chainId),
    unpadBuffer(toBuffer(0)),
    unpadBuffer(toBuffer(0))
  )
  let vInt = tx.v.toNumber()
  if (vInt > 28) {
    vInt -= chainId * 2 + 8
  }
  const data = `0x${encode(input).toString('hex')}`
  const signature = signatureRSV2Hex(tx.r, tx.s, vInt)
  return {
    data,
    signature
  }
}

export function signedTransactionToHash (signedTransaction: PrefixedHexString, transactionOptions: TxOptions): PrefixedHexString {
  return bufferToHex(TransactionFactory.fromSerializedData(toBuffer(signedTransaction), transactionOptions).hash())
}
