import Nedb from '@seald-io/nedb'
import ow from 'ow/dist'
import { PrefixedHexString } from 'ethereumjs-util'

import { Address, isSameAddress, LoggerInterface } from '@opengsn/common'

import { ServerAction, StoredTransaction } from './StoredTransaction'

export const TXSTORE_FILENAME = 'txstore.db'

export class TxStoreManager {
  private readonly txstore: Nedb<any>
  private readonly logger: LoggerInterface

  constructor ({ workdir = '/tmp/test/', inMemory = false, autoCompactionInterval = 0, recentActionAvoidRepeatDistanceBlocks = 0 }, logger: LoggerInterface) {
    this.logger = logger
    this.txstore = new Nedb({
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
    const existing = await this.txstore.findOneAsync({ nonceSigner: tx1.nonceSigner })
    // eslint-disable-next-line
    if (existing && updateExisting) {
      await this.txstore.updateAsync({ txId: existing.txId }, { $set: tx1 })
    } else {
      await this.txstore.insertAsync(tx1)
    }
  }

  /**
   * Only for testing
   */
  async getTxByNonce (signer: PrefixedHexString, nonce: number): Promise<StoredTransaction> {
    ow(nonce, ow.any(ow.number, ow.string))
    ow(signer, ow.string)

    return await this.txstore.findOneAsync({
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

    return await this.txstore.findOneAsync({ txId: txId.toLowerCase() })
  }

  async getTxsInNonceRange (signer: PrefixedHexString, fromNonce: number, toNonce: number = Number.MAX_SAFE_INTEGER): Promise<StoredTransaction[]> {
    return (await this.txstore.findAsync({
      $and: [
        { 'nonceSigner.nonce': { $gte: fromNonce, $lte: toNonce } },
        { 'nonceSigner.signer': signer.toLowerCase() }]
    })).sort(function (tx1, tx2) {
      return tx1.nonce - tx2.nonce
    })
  }

  /**
   * NOTE: the transaction must satisfy *both* criteria to be removed
   */
  async removeArchivedTransactions (upToMinedBlockNumber: number, upToMinedTimestamp: number): Promise<unknown> {
    return await this.txstore.removeAsync({
      $and: [
        { 'minedBlock.number': { $lte: upToMinedBlockNumber } },
        { 'minedBlock.timestamp': { $lte: upToMinedTimestamp } }]
    }, { multi: true })
  }

  async clearAll (): Promise<void> {
    await this.txstore.removeAsync({}, { multi: true })
  }

  async getAll (): Promise<StoredTransaction[]> {
    return (await this.txstore.findAsync({})).sort(function (tx1, tx2) {
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
    const pendingTxs = storedMatchingTxs.filter(it => it.minedBlock?.number == null)
    if (pendingTxs.length !== 0) {
      this.logger.info(`Found ${pendingTxs.length} pending transactions that match a query: ${JSON.stringify(pendingTxs)}`)
      return true
    }
    const recentlyMinedTxs = storedMatchingTxs.filter(it => {
      const minedBlockNumber = it.minedBlock?.number
      return minedBlockNumber != null && currentBlock - minedBlockNumber <= recencyBlockCount
    })
    if (recentlyMinedTxs.length !== 0) {
      this.logger.info(`Found ${recentlyMinedTxs.length} recently mined transactions that match a query: ${JSON.stringify(recentlyMinedTxs)}`)
      return true
    }
    return false
  }
}
