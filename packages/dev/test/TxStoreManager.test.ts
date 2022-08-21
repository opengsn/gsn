import fs from 'fs'

import { ServerAction, StoredTransaction } from '@opengsn/relay/dist/StoredTransaction'
import { TXSTORE_FILENAME, TxStoreManager } from '@opengsn/relay/dist/TxStoreManager'
import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'
import { toHex } from 'web3-utils'
import { Logger } from 'winston'
import sinon from 'sinon'
import { serverDefaultConfiguration } from '@opengsn/relay/dist/ServerConfigParams'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sinonChai from 'sinon-chai'
import { sleep } from '@opengsn/common'

const { expect, assert } = chai.use(chaiAsPromised).use(sinonChai)

// NOTICE: this dir is removed in 'after', do not use this in any other test
const workdir = '/tmp/gsn/test/txstore_manager'
const txStoreFilePath = `${workdir}/${TXSTORE_FILENAME}`

function cleanFolder (): void {
  if (fs.existsSync(txStoreFilePath)) {
    fs.unlinkSync(txStoreFilePath)
  }
  if (fs.existsSync(workdir)) {
    // @ts-ignore
    fs.rmSync(workdir, {
      recursive: true,
      force: true
    })
  }
}

contract('TxStoreManager', function (accounts) {
  let txmanager: TxStoreManager
  let tx: StoredTransaction
  let tx2: StoredTransaction
  let tx3: StoredTransaction
  let logger: Logger

  before('create txstore', async function () {
    logger = createServerLogger('error', '', '')
    cleanFolder()
    txmanager = new TxStoreManager({ workdir }, logger)
    await txmanager.clearAll()
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    assert.ok(txmanager, 'txstore uninitialized' + txmanager.toString())
    assert.isTrue(fs.existsSync(workdir), 'test txstore dir should exist already')
    tx = {
      from: '',
      to: '',
      gas: 0,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      data: '',
      nonce: 111,
      value: toHex(1e18),
      txId: '123456',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlock: {
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        number: 0,
        timestamp: 0
      },
      minedBlock: {
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        number: 10,
        timestamp: 100
      },
      attempts: 1,
      rawSerializedTx: '0xdeadbeef'
    }
    tx2 = {
      from: '',
      to: '',
      gas: 0,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      data: '',
      nonce: 112,
      value: toHex(1e18),
      txId: '1234567',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlock: {
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        number: 0,
        timestamp: 0
      },
      minedBlock: {
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        number: 20,
        timestamp: 200
      },
      attempts: 1,
      rawSerializedTx: '0xdeadbeef'
    }
    tx3 =
      {
        from: '',
        to: '',
        gas: 0,
        maxFeePerGas: 0,
        maxPriorityFeePerGas: 0,
        data: '',
        nonce: 113,
        value: toHex(1e18),
        txId: '12345678',
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlock: {
          hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          number: 0,
          timestamp: 0
        },
        minedBlock: {
          hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          number: 30,
          timestamp: 300
        },
        attempts: 1,
        rawSerializedTx: '0xdeadbeef'
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

  it('should remove txs until block and time', async function () {
    await txmanager.putTx(tx2)
    await txmanager.putTx(tx3)
    let txByNonce = await txmanager.getTxByNonce(tx.from, tx.nonce)
    assert.equal(tx.txId, txByNonce.txId)
    let tx2ByNonce = await txmanager.getTxByNonce(tx.from, tx2.nonce)
    assert.equal(tx2.txId, tx2ByNonce.txId)
    let tx3ByNonce = await txmanager.getTxByNonce(tx.from, tx3.nonce)
    assert.equal(tx3.txId, tx3ByNonce.txId)
    assert.deepEqual(3, (await txmanager.getAll()).length)
    await txmanager.removeArchivedTransactions(20, 200)
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
    } catch (e: any) {
      assert.include(e.message, 'violates the unique constraint')
    }
    assert.deepEqual(1, (await txmanager.getAll()).length)
  })

  it('should compact txstore file', async function () {
    const txStoreStringFile = '{"$$indexCreated":{"fieldName":"txId","unique":true,"sparse":false}}\n' +
      '{"$$indexCreated":{"fieldName":"nonceSigner","unique":true,"sparse":false}}\n' +
      '{"from":"","to":"","gas":0,"gasPrice":0,"data":"","nonce":111,"value":"0xde0b6b3a7640000","txId":"123456","serverAction":3,"creationBlockNumber":0,"minedBlockNumber":0,"attempts":1,"nonceSigner":{"nonce":111,"signer":""},"_id":"jY4JcN9yBl9iQnTd","createdAt":{"$$date":1634512480542},"updatedAt":{"$$date":1634512480542}}\n' +
      '{"from":"","to":"","gas":0,"gasPrice":0,"data":"","nonce":112,"value":"0xde0b6b3a7640000","txId":"1234567","serverAction":3,"creationBlockNumber":0,"minedBlockNumber":0,"attempts":1,"nonceSigner":{"nonce":112,"signer":""},"_id":"OUgaFNbNrbpQdefG","createdAt":{"$$date":1634512480543},"updatedAt":{"$$date":1634512480543}}\n' +
      '{"from":"","to":"","gas":0,"gasPrice":0,"data":"","nonce":113,"value":"0xde0b6b3a7640000","txId":"12345678","serverAction":3,"creationBlockNumber":0,"minedBlockNumber":0,"attempts":1,"nonceSigner":{"nonce":113,"signer":""},"_id":"93HrwOrI27LxKMO4","createdAt":{"$$date":1634512480543},"updatedAt":{"$$date":1634512480543}}\n' +
      '{"$$deleted":true,"_id":"93HrwOrI27LxKMO4"}\n' +
      '{"$$deleted":true,"_id":"OUgaFNbNrbpQdefG"}\n' +
      '{"$$deleted":true,"_id":"jY4JcN9yBl9iQnTd"}\n'
    fs.writeFileSync(txStoreFilePath, txStoreStringFile)
    let linesCount = (fs.readFileSync(txStoreFilePath, 'utf8')).split('\n').length
    assert.equal(9, linesCount)
    const clock = sinon.useFakeTimers(Date.now())
    try {
      txmanager = new TxStoreManager({
        workdir,
        autoCompactionInterval: serverDefaultConfiguration.dbAutoCompactionInterval
      }, logger)
      // @ts-ignore
      sinon.spy(txmanager.txstore, 'compactDatafile')
      await clock.tickAsync(serverDefaultConfiguration.dbAutoCompactionInterval)
      // @ts-ignore
      expect(txmanager.txstore.compactDatafile).to.have.been.calledOnce
      clock.restore()
      await sleep(500)
      linesCount = (fs.readFileSync(txStoreFilePath, 'utf8')).split('\n').length
      assert.equal(3, linesCount)
    } finally {
      clock.restore()
    }
  })

  after('remove txstore', cleanFolder)
})
