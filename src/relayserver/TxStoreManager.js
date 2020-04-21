const Nedb = require('nedb-async').AsyncNedb
const ethUtils = require('ethereumjs-util')
const ow = require('ow')

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

class TxStoreManager {
  constructor ({ workdir = '/tmp/test/', inMemory = false }) {
    this.txstore = new Nedb({
      filename: inMemory ? undefined : `${workdir}/${TXSTORE_FILENAME}`,
      autoload: true,
      timestampData: true
    })
    this.txstore.ensureIndex({ fieldName: 'txId', unique: true })
    this.txstore.ensureIndex({ fieldName: 'nonceSigner', unique: true })

    console.log('txstore created in ', inMemory ? 'memory' : `${workdir}/${TXSTORE_FILENAME}`)
  }

  _toLowerCase ({ tx }) {
    return {
      ...tx,
      txId: tx.txId.toLowerCase()
    }
  }

  async putTx ({ tx, updateExisting }) {
    if (!tx || !tx.txId || !tx.attempts || tx.nonce === undefined) {
      throw new Error('Invalid tx:' + JSON.stringify(tx))
    }
    const tx1 = {
      ...tx,
      txId: tx.txId.toLowerCase(),
      nonceSigner: {
        nonce: tx.nonce,
        signer: tx.from
      }
    }
    const existing = await this.txstore.asyncFindOne({ nonceSigner: tx1.nonceSigner })
    if (existing && updateExisting) {
      await this.txstore.asyncUpdate({ txId: existing.txId }, { $set: tx1 })
    } else {
      await this.txstore.asyncInsert(tx1)
    }
  }

  async getTxByNonce ({ signer, nonce }) {
    ow(nonce, ow.any(ow.number, ow.string))
    ow(signer, ow.string)

    return this.txstore.asyncFindOne({
      nonceSigner: {
        signer,
        nonce
      }
    }, { _id: 0 })
  }

  async getTxById ({ txId }) {
    ow(txId, ow.string)

    return this.txstore.asyncFindOne({ txId: txId.toLowerCase() }, { _id: 0 })
  }

  async removeTxByNonce ({ signer, nonce }) {
    ow(nonce, ow.any(ow.string, ow.number))
    ow(signer, ow.string)

    return this.txstore.asyncRemove({
      $and: [
        { 'nonceSigner.nonce': nonce },
        { 'nonceSigner.signer': signer }]
    }, { multi: true })
  }

  async removeTxsUntilNonce ({ signer, nonce }) {
    ow(nonce, ow.number)
    ow(signer, ow.string)

    return this.txstore.asyncRemove({
      $and: [
        { 'nonceSigner.nonce': { $lte: nonce } },
        { 'nonceSigner.signer': signer }]
    }, { multi: true })
  }

  async clearAll () {
    return this.txstore.asyncRemove({}, { multi: true })
  }

  async getAllBySigner (signer) {
    return (await this.txstore.asyncFind({ 'nonceSigner.signer': signer })).sort(function (tx1, tx2) {
      return tx1.nonce - tx2.nonce
    })
  }

  async getAll () {
    return (await this.txstore.asyncFind({})).sort(function (tx1, tx2) {
      return tx1.nonce - tx2.nonce
    })
  }
}

module.exports = {
  TxStoreManager,
  StoredTx,
  TXSTORE_FILENAME
}
