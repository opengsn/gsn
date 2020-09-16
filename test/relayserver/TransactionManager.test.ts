import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { toBN } from 'web3-utils'
import Mutex from 'async-mutex/lib/Mutex'
import * as ethUtils from 'ethereumjs-util'

import { evmMineMany, revert, snapshot } from '../TestUtils'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { HttpProvider } from 'web3-core'
import { ServerTestEnvironment } from './ServerTestEnvironment'

contract('TransactionManager', function (accounts) {
  const pendingTransactionTimeoutBlocks = 5
  const confirmationsNeeded = 12
  let id: string
  let relayServer: RelayServer
  let env: ServerTestEnvironment

  before(async function () {
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init()
    await env.newServerInstance({ pendingTransactionTimeoutBlocks })
    relayServer = env.relayServer
  })

  describe('nonce sense', function () {
    let _pollNonceOrig: (signer: string) => Promise<number>
    let nonceMutexOrig: Mutex
    let signTransactionOrig: (signer: string, tx: Transaction) => PrefixedHexString
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

    before(async function () {
      await relayServer.transactionManager.txStoreManager.clearAll()
      relayServer.transactionManager._initNonces()
      const { signedTx } = await env.relayTransaction()
      parsedTxHash = ethUtils.bufferToHex((new Transaction(signedTx, relayServer.transactionManager.rawTxOptions)).hash())
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
  })

  describe('resend unconfirmed transactions task', function () {
    before(async function () {
      await relayServer.transactionManager.txStoreManager.clearAll()
      relayServer.transactionManager._initNonces()
      assert.deepEqual([], await relayServer.transactionManager.txStoreManager.getAll())
    })

    it('should resend unconfirmed transaction', async function () {
      // Send a transaction via the relay, but then revert to a previous snapshot
      id = (await snapshot()).result
      const { signedTx } = await env.relayTransaction()
      let parsedTxHash = ethUtils.bufferToHex((new Transaction(signedTx, relayServer.transactionManager.rawTxOptions)).hash())
      const receiptBefore = await env.web3.eth.getTransactionReceipt(parsedTxHash)
      const minedTxBefore = await env.web3.eth.getTransaction(parsedTxHash)
      assert.equal(parsedTxHash, receiptBefore.transactionHash)
      await revert(id)
      // note that 'revert(id)' resets account nonces but transaction manager remembers the old values
      relayServer.transactionManager._initNonces()
      // Ensure tx is removed by the revert
      const receiptAfter = await env.web3.eth.getTransactionReceipt(parsedTxHash)
      assert.equal(null, receiptAfter)
      // Should not do anything, as not enough time has passed
      let sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      let latestBlock = await env.web3.eth.getBlock('latest')
      let allBoostedTransactions = await relayServer._boostStuckPendingTransactions(latestBlock.number)
      assert.equal(allBoostedTransactions.length, 0)
      sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      // Increase time by mining necessary amount of blocks
      await evmMineMany(pendingTransactionTimeoutBlocks)
      // Resend tx, now should be ok
      latestBlock = await env.web3.eth.getBlock('latest')
      allBoostedTransactions = await relayServer._boostStuckPendingTransactions(latestBlock.number)
      assert.equal(allBoostedTransactions.length, 1)
      parsedTxHash = ethUtils.bufferToHex((new Transaction(allBoostedTransactions[0], relayServer.transactionManager.rawTxOptions)).hash())

      // Validate relayed tx with increased gasPrice
      const minedTxAfter = await env.web3.eth.getTransaction(parsedTxHash)
      // BN.muln() does not support floats so to mul by 1.2, we have to mul by 12 and div by 10 to keep precision
      assert.equal(toBN(minedTxAfter.gasPrice).toString(), toBN(minedTxBefore.gasPrice).muln(12).divn(10).toString())
      await env.assertTransactionRelayed(parsedTxHash)
    })

    it('should resend multiple unconfirmed transactions')
  })
})
