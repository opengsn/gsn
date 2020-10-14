import AsyncNedb from 'nedb-async'
import ow from 'ow'
import { PrefixedHexString } from 'ethereumjs-tx'

import { Address } from '../relayclient/types/Aliases'
import { isSameAddress } from '../common/Utils'

import { ServerAction, StoredTransaction } from './StoredTransaction'
import { LoggerInterface } from '../common/LoggerInterface'

export const TXSTORE_FILENAME = 'txstore.db'

export class TxStoreManager {
  private readonly txstore: AsyncNedb<any>
  private readonly logger: LoggerInterface

  constructor ({ workdir = '/tmp/test/', inMemory = false }, logger: LoggerInterface) {
    this.logger = logger
    this.txstore = new AsyncNedb({
      filename: inMemory ? undefined : `${workdir}/${TXSTORE_FILENAME}`,
      autoload: true,
      timestampData: true
    })
    this.txstore.ensureIndex({ fieldName: 'txId', unique: true })
    this.txstore.ensureIndex({ fieldName: 'nonceSigner', unique: true })

    const dbLocationStr = inMemory ? 'memory' : `${workdir}/${TXSTORE_FILENAME}`
    this.logger.info(`Server database location: ${dbLocationStr}`)
  }

  async putTx (tx: StoredTransaction, updateExisting: boolean = false): Promise<void> {
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

  async getAllBySigner (signer: PrefixedHexString): Promise<StoredTransaction[]> {
    return (await this.txstore.asyncFind({ 'nonceSigner.signer': signer.toLowerCase() })).sort(function (tx1, tx2) {
      return tx1.nonce - tx2.nonce
    })
  }

  async getAll (): Promise<StoredTransaction[]> {
    return (await this.txstore.asyncFind({})).sort(function (tx1, tx2) {
      return tx1.nonce - tx2.nonce
    })
  }

  async isActionPending (serverAction: ServerAction, destination: Address | undefined = undefined): Promise<boolean> {
    const allTransactions = await this.getAll()
    return allTransactions.find(it => it.minedBlockNumber == null && it.serverAction === serverAction && (destination == null || isSameAddress(it.to, destination))) != null
  }
}
