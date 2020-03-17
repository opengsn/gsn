const Nedb = require('nedb-async').AsyncNedb
const Transaction = require('ethereumjs-tx')
const ethUtils = require('ethereumjs-util')

class StoredTx {
  constructor (tx) {
    // Object.keys(tx).forEach(key => {
    //   this[key] = ethUtils.bufferToHex(tx[key])
    // })
    this.from = ethUtils.bufferToHex(tx.from)
    this.to = ethUtils.bufferToHex(tx.to)
    this.gas = ethUtils.bufferToInt(tx.gas)
    this.gasPrice = ethUtils.bufferToInt(tx.gasPrice)
    this.data = ethUtils.bufferToHex(tx.data)
    this.nonce = ethUtils.bufferToInt(tx.nonce)
    this.txId = tx.txId
    this.attempts = tx.attempts
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
    if (!tx || !tx.txId || !tx.attempts || tx.nonce === undefined) {
      throw new Error('Invalid tx:' + JSON.stringify(tx))
    }
    this._toLowerCase({ tx })
    const existing = await this.txstore.asyncFindOne({ nonce: tx.nonce })
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
    return (await this.txstore.asyncFind({})).sort(function (tx1, tx2) {
      return tx1.nonce > tx2.nonce
    })
  }
}

module.exports = { TxStoreManager, StoredTx, TXSTORE_FILENAME }