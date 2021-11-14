import {
  createStoredTransaction,
  ServerAction,
  StoredTransaction,
  StoredTransactionMetadata,
  StoredTransactionSerialized
} from '@opengsn/relay/dist/StoredTransaction'
import { FeeMarketEIP1559Transaction } from '@ethereumjs/tx'
import { bufferToHex, toBuffer } from 'ethereumjs-util'

contract('StoredTransaction', function (accounts) {
  let tx: FeeMarketEIP1559Transaction
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
      maxFeePerGas: 1e9,
      maxPriorityFeePerGas: 1e9,
      data: '0x12345678',
      nonce: 111,
      txId: '0x437a03ff976c96807aad1bc895f1535292e4ddf798fd8232600d89912961fc57',
      value: bufferToHex(toBuffer(1e18))
    }
    storedTx = { ...serialized, ...metadata }
    tx = new FeeMarketEIP1559Transaction({
      to: '0x0E25E343655040C643feC98A34D6339b995ECc80'.toLowerCase(),
      gasLimit: 21000,
      maxFeePerGas: 1e9,
      maxPriorityFeePerGas: 1e9,
      data: '0x12345678',
      nonce: 111,
      value: 1e18
    })
    tx = tx.sign(Buffer.from('bb8183929e188ef9ea90a909eafd9a67374c6e209874cb3af468e1bcc33fa2c7', 'hex'))
  })

  it('should store all tx fields', async function () {
    const newStoredTx = createStoredTransaction(tx, metadata)
    assert.deepEqual(newStoredTx, storedTx)
    assert.equal(parseInt(newStoredTx.value, 16), 1e18)
  })
})
