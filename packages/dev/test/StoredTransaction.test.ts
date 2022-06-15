import {
  createStoredTransaction,
  ServerAction,
  StoredTransaction,
  StoredTransactionMetadata,
  StoredTransactionSerialized
} from '@opengsn/relay/dist/StoredTransaction'
import { FeeMarketEIP1559Transaction, Transaction } from '@ethereumjs/tx'

contract('StoredTransaction', function (accounts) {
  let tx: FeeMarketEIP1559Transaction
  let legacyTx: Transaction
  let metadata: StoredTransactionMetadata
  let serialized: StoredTransactionSerialized
  let storedTx: StoredTransaction
  let storedFromLegacyTx: StoredTransaction
  const privateKey = Buffer.from('bb8183929e188ef9ea90a909eafd9a67374c6e209874cb3af468e1bcc33fa2c7', 'hex')

  before('create txstore', async function () {
    metadata = {
      from: '0x7C2fffBCcFe1f109A960F55c325438F83b974Ab8',
      serverAction: ServerAction.VALUE_TRANSFER,
      creationBlock: {
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        number: 0,
        timestamp: 0
      },
      minedBlock: {
        hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        number: 0,
        timestamp: 0
      },
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
      value: `0x0${1e18.toString(16)}`,
      rawSerializedTx: '0x02f876016f843b9aca00843b9aca00825208940e25e343655040c643fec98a34d6339b995ecc80880de0b6b3a76400008412345678c001a08d95a36ebc19f8d33022f69895d9b3495a0289938420e11c9e1594f8417eb45ea0667a8a25f581d8dc5bc5ab84dcd400cdb1e7111261dcb94e4ee2ed1f8ecf6f6c'
    }
    storedTx = { ...serialized, ...metadata }
    storedFromLegacyTx = {
      ...serialized,
      ...metadata,
      txId: '0xa0a6b19c7b6cad00eedb0442f55afa636b985a3b2477a1fc073c685ba3e4326b',
      rawSerializedTx: '0xf86f6f843b9aca00825208940e25e343655040c643fec98a34d6339b995ecc80880de0b6b3a7640000841234567826a06647f584fe474338226573fc664e55f9a31d8e4cba7a03a433071b2805b726afa014dddb6465ac7a68d4be2a46e65ab40eb322a402a335d7847472fdbeb66045de'
    }
    tx = new FeeMarketEIP1559Transaction({
      to: '0x0E25E343655040C643feC98A34D6339b995ECc80'.toLowerCase(),
      gasLimit: 21000,
      maxFeePerGas: 1e9,
      maxPriorityFeePerGas: 1e9,
      data: '0x12345678',
      nonce: 111,
      value: `0x0${1e18.toString(16)}`
    })
    tx = tx.sign(privateKey)
    legacyTx = new Transaction({
      to: '0x0E25E343655040C643feC98A34D6339b995ECc80'.toLowerCase(),
      gasLimit: 21000,
      gasPrice: 1e9,
      data: '0x12345678',
      nonce: 111,
      value: `0x0${1e18.toString(16)}`
    })
    legacyTx = legacyTx.sign(privateKey)
  })

  it('should store all tx fields when passing type 2 tx', async function () {
    const newStoredTx = createStoredTransaction(tx, metadata)
    assert.deepEqual(newStoredTx, storedTx)
    assert.equal(parseInt(newStoredTx.value, 16), 1e18)
  })
  it('should store all tx fields when passing legacy tx', async function () {
    const newStoredTx = createStoredTransaction(legacyTx, metadata)
    assert.deepEqual(newStoredTx, storedFromLegacyTx)
    assert.equal(parseInt(newStoredTx.value, 16), 1e18)
  })
})
