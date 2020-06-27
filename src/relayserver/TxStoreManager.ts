import * as ethUtils from 'ethereumjs-util'
import ow from 'ow'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import AsyncNedb from 'nedb-async'

interface StoredParams {
  from: Buffer
  to: Buffer
  gas: Buffer
  gasPrice: Buffer
  data: Buffer
  nonce: Buffer
  txId: string
  attempts: number
}

export class StoredTx {
  readonly from: PrefixedHexString
  readonly to: PrefixedHexString
  readonly gas: number
  readonly gasPrice: number
  readonly data: PrefixedHexString
  readonly nonce: number
  readonly txId: PrefixedHexString
  readonly attempts: number

  constructor (params: StoredParams) {
    // Object.keys(tx).forEach(key => {
    //   this[key] = ethUtils.bufferToHex(tx[key])
    // })
    this.from = ethUtils.bufferToHex(params.from)
    this.to = ethUtils.bufferToHex(params.to)
    this.gas = ethUtils.bufferToInt(params.gas)
    this.gasPrice = ethUtils.bufferToInt(params.gasPrice)
    this.data = ethUtils.bufferToHex(params.data)
    this.nonce = ethUtils.bufferToInt(params.nonce)
    this.txId = params.txId
    this.attempts = params.attempts
  }
}

export function transactionToStoredTx (tx: Transaction, from: PrefixedHexString, chainId: number, attempts: number): StoredTx {
  return {
    from,
    to: ethUtils.bufferToHex(tx.to),
    gas: ethUtils.bufferToInt(tx.gasLimit),
    gasPrice: ethUtils.bufferToInt(tx.gasPrice),
    data: ethUtils.bufferToHex(tx.data),
    nonce: ethUtils.bufferToInt(tx.nonce),
    txId: ethUtils.bufferToHex(tx.hash()),
    attempts: attempts
  }
}
export function storedTxToTransaction (stx: StoredTx): Transaction {
  return new Transaction({
    to: stx.to,
    gasLimit: stx.gas,
    gasPrice: stx.gasPrice,
    nonce: stx.nonce,
    data: stx.data
  })
}
export const TXSTORE_FILENAME = 'txstore.db'

export class TxStoreManager {
  private readonly txstore: AsyncNedb<any>
  constructor ({ workdir = '/tmp/test/', inMemory = false }) {
    this.txstore = new AsyncNedb({
      filename: inMemory ? undefined : `${workdir}/${TXSTORE_FILENAME}`,
      autoload: true,
      timestampData: true
    })
    this.txstore.ensureIndex({ fieldName: 'txId', unique: true })
    this.txstore.ensureIndex({ fieldName: 'nonceSigner', unique: true })

    console.log('txstore created in ', inMemory ? 'memory' : `${workdir}/${TXSTORE_FILENAME}`)
  }

  async putTx (tx: any, updateExisting: boolean = false): Promise<void> {
    // eslint-disable-next-line
    if (!tx || !tx.txId || !tx.attempts || tx.nonce === undefined) {
      throw new Error('Invalid tx:' + JSON.stringify(tx))
    }
    const tx1 = {
      ...tx,
      txId: tx.txId.toLowerCase(),
      nonceSigner: {
        nonce: tx.nonce,
        signer: tx.from.toLowerCase()
      }
    }
    const existing = await this.txstore.asyncFindOne({ nonceSigner: tx1.nonceSigner })
    // eslint-disable-next-line
    if (existing && updateExisting) {
      await this.txstore.asyncUpdate({ txId: existing.txId }, { $set: tx1 })
    } else {
      await this.txstore.asyncInsert(tx1)
    }
  }

  async getTxByNonce (signer: PrefixedHexString, nonce: number): Promise<any> {
    ow(nonce, ow.any(ow.number, ow.string))
    ow(signer, ow.string)

    return await this.txstore.asyncFindOne({
      nonceSigner: {
        signer: signer.toLowerCase(),
        nonce
      }
    }, { _id: 0 })
  }

  async getTxById (txId: string): Promise<any> {
    ow(txId, ow.string)

    return await this.txstore.asyncFindOne({ txId: txId.toLowerCase() }, { _id: 0 })
  }

  async removeTxByNonce (signer: PrefixedHexString, nonce: number): Promise<unknown> {
    ow(nonce, ow.any(ow.string, ow.number))
    ow(signer, ow.string)

    return await this.txstore.asyncRemove({
      $and: [
        { 'nonceSigner.nonce': nonce },
        { 'nonceSigner.signer': signer.toLowerCase() }]
    }, { multi: true })
  }

  async removeTxsUntilNonce (signer: PrefixedHexString, nonce: number): Promise<unknown> {
    ow(nonce, ow.number)
    ow(signer, ow.string)

    return await this.txstore.asyncRemove({
      $and: [
        { 'nonceSigner.nonce': { $lte: nonce } },
        { 'nonceSigner.signer': signer.toLowerCase() }]
    }, { multi: true })
  }

  async clearAll (): Promise<void> {
    await this.txstore.asyncRemove({}, { multi: true })
  }

  async getAllBySigner (signer: PrefixedHexString): Promise<any[]> {
    return (await this.txstore.asyncFind({ 'nonceSigner.signer': signer.toLowerCase() })).sort(function (tx1, tx2) {
      return tx1.nonce - tx2.nonce
    })
  }

  async getAll (): Promise<any[]> {
    return (await this.txstore.asyncFind({})).sort(function (tx1, tx2) {
      return tx1.nonce - tx2.nonce
    })
  }
}
