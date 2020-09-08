/* global */

import fs from 'fs'
import { StoredTx, TXSTORE_FILENAME, TxStoreManager } from '../src/relayserver/TxStoreManager'

// NOTICE: this dir is removed in 'after', do not use this in any other test
const workdir = '/tmp/gsn/test/txstore_manager'
const txStoreFilePath = `${workdir}/${TXSTORE_FILENAME}`

function cleanFolder (): void {
  if (fs.existsSync(txStoreFilePath)) {
    fs.unlinkSync(txStoreFilePath)
  }
  if (fs.existsSync(workdir)) {
    fs.rmdirSync(workdir)
  }
}

contract('TxStoreManager', function (accounts) {
  let txmanager: TxStoreManager
  let tx: StoredTx
  let tx2: StoredTx
  let tx3: StoredTx

  function compareStoredTxs (tx1: StoredTx, tx2: StoredTx): void {
    assert.equal(tx1.data, tx2.data)
    assert.equal(tx1.gas, tx2.gas)
    assert.equal(tx1.gasPrice, tx2.gasPrice)
    assert.equal(tx1.to, tx2.to)
    assert.equal(tx1.value, tx2.value)
    assert.equal(tx1.nonce, tx2.nonce)
    assert.equal(tx1.txId, tx2.txId)
    assert.equal(tx1.attempts, tx2.attempts)
  }

  before('create txstore', async function () {
    cleanFolder()
    txmanager = new TxStoreManager({ workdir })
    await txmanager.clearAll()
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    assert.ok(txmanager, 'txstore uninitialized' + txmanager.toString())
    assert.isTrue(fs.existsSync(workdir), 'test txstore dir should exist already')
    tx = new StoredTx({
      from: Buffer.from([]),
      to: Buffer.from([]),
      gas: Buffer.from([0]),
      gasPrice: Buffer.from([0]),
      data: Buffer.from([]),
      nonce: Buffer.from([111]),
      value: Buffer.from([222]),
      txId: '123456',
      attempts: 1
    })
    tx2 = new StoredTx({
      from: Buffer.from([]),
      to: Buffer.from([]),
      gas: Buffer.from([0]),
      gasPrice: Buffer.from([0]),
      data: Buffer.from([]),
      nonce: Buffer.from([112]),
      value: Buffer.from([222]),
      txId: '1234567',
      attempts: 1
    })
    tx3 = new StoredTx(
      {
        from: Buffer.from([]),
        to: Buffer.from([]),
        gas: Buffer.from([0]),
        gasPrice: Buffer.from([0]),
        data: Buffer.from([]),
        nonce: Buffer.from([113]),
        value: Buffer.from([333]),
        txId: '12345678',
        attempts: 1
      })
  })

  it('should store and get tx by txId', async function () {
    assert.equal(null, await txmanager.getTxById(tx.txId))
    await txmanager.putTx(tx)
    const txById: StoredTx = await txmanager.getTxById(tx.txId)
    compareStoredTxs(tx, txById)
  })

  it('should get tx by nonce', async function () {
    assert.equal(null, await txmanager.getTxByNonce(tx.from, tx.nonce + 1234))
    const txByNonce: StoredTx = await txmanager.getTxByNonce(tx.from, tx.nonce)
    compareStoredTxs(tx, txByNonce)
  })

  it('should remove tx by nonce', async function () {
    let txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    assert.equal(tx.txId, txByNonce.txId)
    assert.deepEqual(1, (await txmanager.getAll()).length)
    await txmanager.removeTxByNonce(tx.from, tx.nonce)
    txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    assert.equal(null, txByNonce)
    assert.deepEqual([], await txmanager.getAll())
  })

  it('should remove txs until nonce', async function () {
    await txmanager.putTx(tx)
    await txmanager.putTx(tx2)
    await txmanager.putTx(tx3)
    let txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    compareStoredTxs(tx, txByNonce)
    let tx2ByNonce = await txmanager.getTxByNonce(tx.from, tx2.nonce)
    compareStoredTxs(tx2, tx2ByNonce)
    let tx3ByNonce = await txmanager.getTxByNonce(tx.from, tx3.nonce)
    compareStoredTxs(tx3, tx3ByNonce)
    assert.deepEqual(3, (await txmanager.getAll()).length)
    await txmanager.removeTxsUntilNonce(tx.from, tx2.nonce)
    txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    assert.equal(null, txByNonce)
    tx2ByNonce = await txmanager.getTxByNonce(tx.from, tx2.nonce)
    assert.equal(null, tx2ByNonce)
    tx3ByNonce = await txmanager.getTxByNonce(tx.from, tx3.nonce)
    compareStoredTxs(tx3, tx3ByNonce)
    assert.deepEqual(1, (await txmanager.getAll()).length)
  })

  it('should clear txstore', async function () {
    await txmanager.putTx(tx, true)
    await txmanager.putTx(tx2, true)
    await txmanager.putTx(tx3, true)
    await txmanager.clearAll()
    assert.deepEqual([], await txmanager.getAll())
  })

  it('should NOT store tx twice', async function () {
    await txmanager.clearAll()
    await txmanager.putTx(tx)
    await txmanager.putTx(tx, true)
    assert.deepEqual(1, (await txmanager.getAll()).length)
    try {
      await txmanager.putTx(tx, false)
      assert.fail('should fail storing twice')
    } catch (e) {
      assert.include(e.message, 'violates the unique constraint')
    }
    assert.deepEqual(1, (await txmanager.getAll()).length)
  })

  after('remove txstore', cleanFolder)
})
