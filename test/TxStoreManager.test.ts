import fs from 'fs'

import { ServerAction, StoredTransaction } from '../src/relayserver/StoredTransaction'
import { TXSTORE_FILENAME, TxStoreManager } from '../src/relayserver/TxStoreManager'

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
  let tx: StoredTransaction
  let tx2: StoredTransaction
  let tx3: StoredTransaction

  before('create txstore', async function () {
    cleanFolder()
    txmanager = new TxStoreManager({ workdir })
    await txmanager.clearAll()
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    assert.ok(txmanager, 'txstore uninitialized' + txmanager.toString())
    assert.isTrue(fs.existsSync(workdir), 'test txstore dir should exist already')
    tx = {
      from: '',
      to: '',
      gas: 0,
      gasPrice: 0,
      data: '',
      nonce: 111,
      txId: '123456',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlockNumber: 0,
      minedBlockNumber: 0,
      attempts: 1
    }
    tx2 = {
      from: '',
      to: '',
      gas: 0,
      gasPrice: 0,
      data: '',
      nonce: 112,
      txId: '1234567',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlockNumber: 0,
      minedBlockNumber: 0,
      attempts: 1
    }
    tx3 =
      {
        from: '',
        to: '',
        gas: 0,
        gasPrice: 0,
        data: '',
        nonce: 113,
        txId: '12345678',
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        minedBlockNumber: 0,
        attempts: 1
      }
  })

  it('should store and get tx by txId', async function () {
    assert.equal(null, await txmanager.getTxById(tx.txId))
    await txmanager.putTx(tx)
    const txById = await txmanager.getTxById(tx.txId)
    assert.equal(tx.txId, txById.txId)
    assert.equal(tx.attempts, txById.attempts)
  })

  it('should get tx by nonce', async function () {
    assert.equal(null, await txmanager.getTxByNonce(tx.from, tx.nonce + 1234))
    const txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    assert.equal(tx.txId, txByNonce.txId)
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
    assert.equal(tx.txId, txByNonce.txId)
    let tx2ByNonce = await txmanager.getTxByNonce(tx.from, tx2.nonce)
    assert.equal(tx2.txId, tx2ByNonce.txId)
    let tx3ByNonce = await txmanager.getTxByNonce(tx.from, tx3.nonce)
    assert.equal(tx3.txId, tx3ByNonce.txId)
    assert.deepEqual(3, (await txmanager.getAll()).length)
    await txmanager.removeTxsUntilNonce(tx.from, tx2.nonce)
    txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    assert.equal(null, txByNonce)
    tx2ByNonce = await txmanager.getTxByNonce(tx.from, tx2.nonce)
    assert.equal(null, tx2ByNonce)
    tx3ByNonce = await txmanager.getTxByNonce(tx.from, tx3.nonce)
    assert.equal(tx3.txId, tx3ByNonce.txId)
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
