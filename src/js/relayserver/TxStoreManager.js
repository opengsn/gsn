const Nedb = require('nedb-async').AsyncNedb
const Transaction = require('ethereumjs-tx')

class StoredTx {
  constructor (tx) {
    assert.ok(tx.from !== undefined &&
      tx.to !== undefined &&
      tx.value !== undefined &&
      tx.gas !== undefined &&
      tx.gasPrice !== undefined &&
      tx.data !== undefined &&
      tx.nonce !== undefined &&
      tx.txId !== undefined&&
      tx.attempts !== undefined)
    Object.assign(this, { ...tx })
  }
}

const TXSTORE_FILENAME = 'txstore.db'

/*
	ListTransactions() (txs []*TimestampedTransaction, err error)
	GetFirstTransaction() (tx *TimestampedTransaction, err error)
	SaveTransaction(tx *types.Transaction) (err error)
	UpdateTransactionByNonce(tx *types.Transaction) (err error)
	RemoveTransactionsLessThanNonce(nonce uint64) (err error)
	Clear() (err error)
	Close() (err error)
 */
class TxStoreManager {
  constructor ({ workdir = '/tmp/test/' }) {
    this.txstore = new Nedb({
      filename: `${workdir}/${TXSTORE_FILENAME}`,
      autoload: true,
      timestampData: true
    })
    this.txstore.ensureIndex({ fieldName: 'txId', unique: true })
    this.txstore.ensureIndex({ fieldName: 'nonce', unique: true })
    console.log('txstore created in ', `${workdir}/${TXSTORE_FILENAME}`)
  }

  _toLowerCase ({ tx }) {
    tx.txId = tx.txId.toLowerCase()
  }

  async putTx ({ tx }) {
    if (!tx || !tx.txId || !tx.attempts) {
      throw new Error('Invalid tx:' + tx)
    }
    this._toLowerCase({ tx })
    const existing = await this.txstore.asyncFindOne({ txId: tx.txId })
    if (existing) {
      await this.txstore.asyncUpdate({ txId: existing.txId }, { $set: tx })
    } else {
      await this.txstore.asyncInsert(tx)
    }
  }

  async getTxByNonce ({ nonce }) {
    if (nonce === undefined) {
      throw new Error('must supply nonce')
    }
    return this.txstore.asyncFindOne({ nonce: nonce }, { _id: 0 })
  }

  async getTxById ({ txId }) {
    if (!txId) {
      throw new Error('must supply txId')
    }
    return this.txstore.asyncFindOne({ txId: txId.toLowerCase() }, { _id: 0 })
  }

  async removeTxByNonce ({ nonce }) {
    if (nonce === undefined) {
      throw new Error('must supply nonce')
    }
    return this.txstore.asyncRemove({ nonce: nonce }, { multi: true })
  }

  async removeTxsUntilNonce ({ nonce }) {
    if (nonce === undefined) {
      throw new Error('must supply nonce')
    }
    return this.txstore.asyncRemove({ nonce: { $lte: nonce } }, { multi: true })
  }

  async clearAll () {
    return this.txstore.asyncRemove({})
  }

  async getAll () {
    return this.txstore.asyncFind({})
  }
}

module.exports = { TxStoreManager, StoredTx, TXSTORE_FILENAME }