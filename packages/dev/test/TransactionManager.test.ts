import { StaticJsonRpcProvider, Block } from '@ethersproject/providers'
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx'
import { PrefixedHexString, toBuffer } from 'ethereumjs-util'
import { Mutex } from 'async-mutex'
import * as ethUtils from 'ethereumjs-util'

import { evmMine, evmMineMany, increaseTime } from './TestUtils'
import { HttpProvider } from 'web3-core'
import { ServerTestEnvironment } from './ServerTestEnvironment'
import { SignedTransaction } from '@opengsn/relay/dist/KeyManager'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'

contract('TransactionManager', function (accounts) {
  const dbPruneTxAfterBlocks = 12
  const dbPruneTxAfterSeconds = 100
  let transactionManager: TransactionManager
  let env: ServerTestEnvironment

  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

  before(async function () {
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init()
    await env.newServerInstance({
      dbPruneTxAfterBlocks,
      dbPruneTxAfterSeconds,
      refreshStateTimeoutBlocks: 1
    })
    transactionManager = env.relayServer.transactionManager
  })

  describe('_resolveNewGasPrice()', function () {
    it('should return new gas fees when both below maxFeePerGas', async function () {
      const maxFeePerGas = 1e10
      const maxPriorityFeePerGas = 1e9
      const newFees = await transactionManager._resolveNewGasPrice(maxFeePerGas, maxPriorityFeePerGas, 0, 0)
      assert.equal(newFees.newMaxFee, maxFeePerGas * transactionManager.config.retryGasPriceFactor)
      assert.equal(newFees.newMaxPriorityFee, maxPriorityFeePerGas * transactionManager.config.retryGasPriceFactor)
      assert.isFalse(newFees.isMaxGasPriceReached)
    })
    it('should return new gas fees when new maxFee above maxFeePerGas', async function () {
      const maxFeePerGas = parseInt(transactionManager.config.maxMaxFeePerGas) - 1
      const maxPriorityFeePerGas = 1e9
      const newFees = await transactionManager._resolveNewGasPrice(maxFeePerGas, maxPriorityFeePerGas, 0, 0)
      assert.equal(newFees.newMaxFee.toString(), transactionManager.config.maxMaxFeePerGas)
      assert.equal(newFees.newMaxPriorityFee, maxPriorityFeePerGas * transactionManager.config.retryGasPriceFactor)
      assert.isTrue(newFees.isMaxGasPriceReached)
    })
    it('should return new gas fees when new maxPriorityFee above maxFee', async function () {
      const maxFeePerGas = 1e9
      const maxPriorityFeePerGas = parseInt(transactionManager.config.maxMaxFeePerGas) - 1
      assert.isTrue(maxFeePerGas < maxPriorityFeePerGas)
      const newFees = await transactionManager._resolveNewGasPrice(maxFeePerGas, maxPriorityFeePerGas, 0, 0)
      assert.equal(newFees.newMaxFee, maxFeePerGas * transactionManager.config.retryGasPriceFactor)
      assert.equal(newFees.newMaxPriorityFee, newFees.newMaxFee)
      assert.isFalse(newFees.isMaxGasPriceReached)
    })
    it('should return new gas fees when both below their min values', async function () {
      const maxPriorityFeePerGas = 1e8
      const maxFeePerGas = 1e9
      const minMaxPriorityFeePerGas = 1e10
      const minMaxFeePerGas = 1e11
      const newFees = await transactionManager._resolveNewGasPrice(maxFeePerGas, maxPriorityFeePerGas, minMaxPriorityFeePerGas, minMaxFeePerGas)
      assert.equal(newFees.newMaxFee, minMaxFeePerGas)
      assert.equal(newFees.newMaxPriorityFee, minMaxPriorityFeePerGas)
      assert.isFalse(newFees.isMaxGasPriceReached)
    })
    it('should set maxPriorityFee to maxFee if it is higher', async function () {
      const maxPriorityFeePerGas = 1e9
      const maxFeePerGas = 1e8
      const minMaxPriorityFeePerGas = 1e11
      const minMaxFeePerGas = 1e10
      const newFees = await transactionManager._resolveNewGasPrice(maxFeePerGas, maxPriorityFeePerGas, minMaxPriorityFeePerGas, minMaxFeePerGas)
      assert.equal(newFees.newMaxFee, minMaxFeePerGas)
      assert.equal(newFees.newMaxPriorityFee, minMaxFeePerGas)
      assert.isFalse(newFees.isMaxGasPriceReached)
    })
  })

  describe('nonce counter asynchronous access protection', function () {
    let _pollNonceOrig: (signer: string) => Promise<number>
    let nonceMutexOrig: Mutex
    let signTransactionOrig: (signer: string, tx: TypedTransaction) => SignedTransaction
    before(function () {
      _pollNonceOrig = transactionManager.pollNonce
      transactionManager.pollNonce = async function (signer) {
        return await this.contractInteractor.getTransactionCount(signer, 'pending')
      }
    })
    after(function () {
      transactionManager.pollNonce = _pollNonceOrig
    })

    /**
     * This is not so much a test but a sanity check that RelayServer code produces two distinct transactions
     * unless mutex is implemented.
     */
    it('should fail if nonce is not mutexed', async function () {
      nonceMutexOrig = transactionManager.nonceMutex
      transactionManager.nonceMutex = {
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
      } catch (e: any) {
        console.log(e)
        assert.include(e.message, 'violates the unique constraint')
        // there may be multiple fields marked as 'unique', this checks that 'nonceSigner' is the one that throws
        assert.deepEqual(e.key, { nonce: 0, signer: env.relayServer.workerAddress })
        // since we forced the server to create an illegal tx with an already used nonce, we decrease the nonce
        transactionManager.nonces[1]--
      } finally {
        transactionManager.nonceMutex = nonceMutexOrig
      }
    })

    it('should handle nonce atomically', async function () {
      // noinspection ES6MissingAwait - done on purpose
      const promises = [env.relayTransaction(), env.relayTransaction(false, { data: '0xdeadbeef' })]
      await Promise.all(promises)
    })

    it('should not deadlock if server returned error while locked', async function () {
      try {
        signTransactionOrig = transactionManager.workersKeyManager.signTransaction
        transactionManager.workersKeyManager.signTransaction = function () {
          throw new Error('no tx for you')
        }
        try {
          await env.relayTransaction()
        } catch (e: any) {
          assert.include(e.message, 'no tx for you')
          assert.isFalse(transactionManager.nonceMutex.isLocked(), 'nonce mutex not released after exception')
        }
      } finally {
        transactionManager.workersKeyManager.signTransaction = signTransactionOrig
      }
    })
  })

  describe('local storage maintenance', function () {
    let parsedTxHash: PrefixedHexString
    let latestBlock: Block

    beforeEach(async function () {
      await transactionManager.txStoreManager.clearAll()
      transactionManager._initNonces()
      const { signedTx } = await env.relayTransaction()
      parsedTxHash = ethUtils.bufferToHex((TransactionFactory.fromSerializedData(toBuffer(signedTx), transactionManager.rawTxOptions)).hash())
      await evmMine()
      latestBlock = await ethersProvider.getBlock('latest')
      // important part is marking a transaction as mined
      await env.relayServer._worker(latestBlock)
    })

    it('should remove confirmed transactions from the recent transactions storage', async function () {
      await transactionManager.removeArchivedTransactions(latestBlock)
      let storedTransactions = await transactionManager.txStoreManager.getAll()
      assert.equal(storedTransactions[0].txId, parsedTxHash)
      await evmMineMany(dbPruneTxAfterBlocks)
      await increaseTime(dbPruneTxAfterSeconds)
      const newLatestBlock = await env.web3.eth.getBlock('latest')
      await transactionManager.removeArchivedTransactions(newLatestBlock)
      storedTransactions = await transactionManager.txStoreManager.getAll()
      assert.deepEqual([], storedTransactions)
    })

    it('should remove stale boosted unconfirmed transactions', async function () {
      await transactionManager.removeArchivedTransactions(latestBlock)
      let storedTransactions = await transactionManager.txStoreManager.getAll()
      const oldTransaction = storedTransactions[0]
      assert.equal(storedTransactions.length, 1)
      assert.equal(oldTransaction.txId, parsedTxHash)
      // Forcing the manager to store a boosted transaction
      // Ganache is on auto-mine, so the server will throw after broadcasting on nonce error, after storing the boosted tx.
      try {
        await transactionManager.resendTransaction(
          oldTransaction, latestBlock, oldTransaction.maxFeePerGas * 2, oldTransaction.maxPriorityFeePerGas * 2, false)
      } catch (e: any) {
        assert.include(e.message, 'Nonce too low. Expected nonce to be')
      }
      storedTransactions = await transactionManager.txStoreManager.getAll()
      assert.equal(storedTransactions.length, 1)
      assert.notEqual(storedTransactions[0].txId, parsedTxHash)
      await evmMineMany(dbPruneTxAfterBlocks)
      await increaseTime(dbPruneTxAfterSeconds)
      const newLatestBlock = await env.web3.eth.getBlock('latest')
      await transactionManager.removeArchivedTransactions(newLatestBlock)
      storedTransactions = await transactionManager.txStoreManager.getAll()
      assert.deepEqual([], storedTransactions)
    })
  })
})
