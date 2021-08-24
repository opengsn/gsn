import { Transaction } from '@ethereumjs/tx'
import { PrefixedHexString, toBuffer } from 'ethereumjs-util'
import Mutex from 'async-mutex/lib/Mutex'
import * as ethUtils from 'ethereumjs-util'

import { evmMineMany } from './TestUtils'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { HttpProvider } from 'web3-core'
import { ServerTestEnvironment } from './ServerTestEnvironment'
import { SignedTransaction } from '@opengsn/relay/dist/KeyManager'

contract('TransactionManager', function (accounts) {
  const confirmationsNeeded = 12
  let relayServer: RelayServer
  let env: ServerTestEnvironment

  before(async function () {
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init()
    await env.newServerInstance()
    relayServer = env.relayServer
  })

  describe('nonce counter asynchronous access protection', function () {
    let _pollNonceOrig: (signer: string) => Promise<number>
    let nonceMutexOrig: Mutex
    let signTransactionOrig: (signer: string, tx: Transaction) => SignedTransaction
    before(function () {
      _pollNonceOrig = relayServer.transactionManager.pollNonce
      relayServer.transactionManager.pollNonce = async function (signer) {
        return await this.contractInteractor.getTransactionCount(signer, 'pending')
      }
    })
    after(function () {
      relayServer.transactionManager.pollNonce = _pollNonceOrig
    })

    /**
     * This is not so much a test but a sanity check that RelayServer code produces two distinct transactions
     * unless mutex is implemented.
     */
    it('should fail if nonce is not mutexed', async function () {
      nonceMutexOrig = relayServer.transactionManager.nonceMutex
      relayServer.transactionManager.nonceMutex = {
        // @ts-ignore
        acquire: function () {
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          return function releaseMutex () {}
        },
        isLocked: () => false
      }
      try {
        // noinspection ES6MissingAwait - done on purpose
        const promises = [env.relayTransaction(), env.relayTransaction(false, { data: '0xdeadbeef' })]
        await Promise.all(promises)
        assert.fail()
      } catch (e) {
        console.log(e)
        assert.include(e.message, 'violates the unique constraint')
        // there may be multiple fields marked as 'unique', this checks that 'nonceSigner' is the one that throws
        assert.deepEqual(e.key, { nonce: 0, signer: env.relayServer.workerAddress })
        // since we forced the server to create an illegal tx with an already used nonce, we decrease the nonce
        relayServer.transactionManager.nonces[1]--
      } finally {
        relayServer.transactionManager.nonceMutex = nonceMutexOrig
      }
    })

    it('should handle nonce atomically', async function () {
      // noinspection ES6MissingAwait - done on purpose
      const promises = [env.relayTransaction(), env.relayTransaction(false, { data: '0xdeadbeef' })]
      await Promise.all(promises)
    })

    it('should not deadlock if server returned error while locked', async function () {
      try {
        signTransactionOrig = relayServer.transactionManager.workersKeyManager.signTransaction
        relayServer.transactionManager.workersKeyManager.signTransaction = function () {
          throw new Error('no tx for you')
        }
        try {
          await env.relayTransaction()
        } catch (e) {
          assert.include(e.message, 'no tx for you')
          assert.isFalse(relayServer.transactionManager.nonceMutex.isLocked(), 'nonce mutex not released after exception')
        }
      } finally {
        relayServer.transactionManager.workersKeyManager.signTransaction = signTransactionOrig
      }
    })
  })

  describe('local storage maintenance', function () {
    let parsedTxHash: PrefixedHexString
    let latestBlock: number

    beforeEach(async function () {
      await relayServer.transactionManager.txStoreManager.clearAll()
      relayServer.transactionManager._initNonces()
      const { signedTx } = await env.relayTransaction()
      parsedTxHash = ethUtils.bufferToHex((Transaction.fromSerializedTx(toBuffer(signedTx), relayServer.transactionManager.rawTxOptions)).hash())
      latestBlock = (await env.web3.eth.getBlock('latest')).number
    })

    it('should remove confirmed transactions from the recent transactions storage', async function () {
      await relayServer.transactionManager.removeConfirmedTransactions(latestBlock)
      let storedTransactions = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(storedTransactions[0].txId, parsedTxHash)
      await evmMineMany(confirmationsNeeded)
      const newLatestBlock = await env.web3.eth.getBlock('latest')
      await relayServer.transactionManager.removeConfirmedTransactions(newLatestBlock.number)
      storedTransactions = await relayServer.transactionManager.txStoreManager.getAll()
      assert.deepEqual([], storedTransactions)
    })

    it('should remove stale boosted unconfirmed transactions', async function () {
      await relayServer.transactionManager.removeConfirmedTransactions(latestBlock)
      let storedTransactions = await relayServer.transactionManager.txStoreManager.getAll()
      const oldTransaction = storedTransactions[0]
      assert.equal(storedTransactions.length, 1)
      assert.equal(oldTransaction.txId, parsedTxHash)
      // Forcing the manager to store a boosted transaction
      // Ganache is on auto-mine, so the server will throw after broadcasting on nonce error, after storing the boosted tx.
      try {
        await relayServer.transactionManager.resendTransaction(
          oldTransaction, latestBlock, oldTransaction.gasPrice * 2, false)
      } catch (e) {
        assert.include(e.message, 'Nonce too low. Expected nonce to be')
      }
      storedTransactions = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(storedTransactions.length, 1)
      assert.notEqual(storedTransactions[0].txId, parsedTxHash)
      await evmMineMany(confirmationsNeeded)
      const newLatestBlock = await env.web3.eth.getBlock('latest')
      await relayServer.transactionManager.removeConfirmedTransactions(newLatestBlock.number)
      storedTransactions = await relayServer.transactionManager.txStoreManager.getAll()
      assert.deepEqual([], storedTransactions)
    })
  })
})
