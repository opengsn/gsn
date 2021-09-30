import {
  createStoredTransaction,
  ServerAction,
  StoredTransaction,
  StoredTransactionMetadata,
  StoredTransactionSerialized
} from '@opengsn/relay/dist/StoredTransaction'
import { Transaction } from '@ethereumjs/tx'
import { bufferToHex, toBuffer } from 'ethereumjs-util'

contract('StoredTransaction', function (accounts) {
  let tx: Transaction
  let metadata: StoredTransactionMetadata
  let serialized: StoredTransactionSerialized
  let storedTx: StoredTransaction

  before('create txstore', async function () {
    metadata = {
      from: '0x7C2fffBCcFe1f109A960F55c325438F83b974Ab8',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlockNumber: 0,
      minedBlockNumber: 0,
      attempts: 1
    }
    serialized = {
      to: '0x0E25E343655040C643feC98A34D6339b995ECc80'.toLowerCase(),
      gas: 21000,
      gasPrice: 1e9,
      data: '0x12345678',
      nonce: 111,
      txId: '0x6d3e12be85443f6ee57379ca2495b0ebb58f78a7e42f90e5fa67f991af605121',
      value: bufferToHex(toBuffer(1e18))
    }
    storedTx = { ...serialized, ...metadata }
    tx = new Transaction({
      to: '0x0E25E343655040C643feC98A34D6339b995ECc80'.toLowerCase(),
      gasLimit: 21000,
      gasPrice: 1e9,
      data: '0x12345678',
      nonce: 111,
      value: 1e18
    })
  })

  it('should store all tx fields', async function () {
    const newStoredTx = createStoredTransaction(tx, metadata)
    assert.deepEqual(newStoredTx, storedTx)
    assert.equal(parseInt(newStoredTx.value, 16), 1e18)
  })
})
