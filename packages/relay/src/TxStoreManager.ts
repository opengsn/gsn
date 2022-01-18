import AsyncNedb from 'nedb-async'
import ow from 'ow'
import { PrefixedHexString } from 'ethereumjs-util'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { isSameAddress } from '@opengsn/common/dist/Utils'

import { ServerAction, StoredTransaction } from './StoredTransaction'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

export const TXSTORE_FILENAME = 'txstore.db'

export class TxStoreManager {
  private readonly txstore: AsyncNedb<any>
  private readonly logger: LoggerInterface

  constructor ({ workdir = '/tmp/test/', inMemory = false, autoCompactionInterval = 0, recentActionAvoidRepeatDistanceBlocks = 0 }, logger: LoggerInterface) {
    this.logger = logger
    this.txstore = new AsyncNedb({
      filename: inMemory ? undefined : `${workdir}/${TXSTORE_FILENAME}`,
      autoload: true,
      timestampData: true
    })
    if (autoCompactionInterval !== 0) {
      this.txstore.persistence.setAutocompactionInterval(autoCompactionInterval)
    }
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
    const nonceSigner = {
      nonce: tx.nonce,
      signer: tx.from.toLowerCase()
    }
    const tx1: StoredTransaction = {
      ...tx,
      txId: tx.txId.toLowerCase(),
      nonceSigner
    }
    const existing = await this.txstore.asyncFindOne({ nonceSigner: tx1.nonceSigner })
    // eslint-disable-next-line
    if (existing && updateExisting) {
      await this.txstore.asyncUpdate({ txId: existing.txId }, { $set: tx1 })
    } else {
      await this.txstore.asyncInsert(tx1)
    }
  }

  /**
   * Only for testing
   */
  async getTxByNonce (signer: PrefixedHexString, nonce: number): Promise<StoredTransaction> {
    ow(nonce, ow.any(ow.number, ow.string))
    ow(signer, ow.string)

    return await this.txstore.asyncFindOne({
      nonceSigner: {
        signer: signer.toLowerCase(),
        nonce
      }
    })
  }

  /**
   * Only for testing
   */
  async getTxById (txId: string): Promise<StoredTransaction> {
    ow(txId, ow.string)

    return await this.txstore.asyncFindOne({ txId: txId.toLowerCase() })
  }

  async getTxsUntilNonce (signer: PrefixedHexString, nonce: number): Promise<StoredTransaction[]> {
    return await this.txstore.asyncFind({
      $and: [
        { 'nonceSigner.nonce': { $lte: nonce } },
        { 'nonceSigner.signer': signer.toLowerCase() }]
    })
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

  /**
   * The server is originally written to fully rely on blockchain events to determine its state.
   * However, on real networks the server's actions propagate slowly and server considers its state did not change.
   * To mitigate this, server should not repeat its actions for at least {@link recencyBlockCount} blocks.
   */
  async isActionPendingOrRecentlyMined (serverAction: ServerAction, currentBlock: number, recencyBlockCount: number, destination: Address | undefined = undefined): Promise<boolean> {
    const allTransactions = await this.getAll()
    const storedMatchingTxs = allTransactions.filter(it => it.serverAction === serverAction && (destination == null || isSameAddress(it.to, destination)))
    const pendingTxs = storedMatchingTxs.filter(it => it.minedBlockNumber == null)
    if (pendingTxs.length !== 0) {
      this.logger.info(`Found ${pendingTxs.length} pending transactions that match a query: ${JSON.stringify(pendingTxs)}`)
      return true
    }
    const recentlyMinedTxs = storedMatchingTxs.filter(it => {
      const minedBlockNumber = it.minedBlockNumber ?? 0
      return currentBlock - minedBlockNumber <= recencyBlockCount
    })
    if (recentlyMinedTxs.length !== 0) {
      this.logger.info(`Found ${recentlyMinedTxs.length} recently mined transactions that match a query: ${JSON.stringify(recentlyMinedTxs)}`)
      return true
    }
    return false
  }
}
