import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { toBN } from 'web3-utils'
import Mutex from 'async-mutex/lib/Mutex'
import * as ethUtils from 'ethereumjs-util'

import { deployHub, evmMineMany, revert, snapshot } from '../TestUtils'
import { RelayServer } from '../../src/relayserver/RelayServer'
import {
  assertTransactionRelayed,
  bringUpNewRelay,
  LocalhostOne,
  NewRelayParams,
  PrepareRelayRequestOption,
  relayTransaction,
  RelayTransactionParams
} from './ServerTestUtils'
import { Address } from '../../src/relayclient/types/Aliases'
import Web3 from 'web3'
import { HttpProvider } from 'web3-core'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { TestPaymasterEverythingAcceptedInstance } from '../../types/truffle-contracts'
import { GsnRequestType } from '../../src/common/EIP712/TypedRequestData'
import { GSNConfig } from '../../src/relayclient/GSNConfigurator'

const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestRecipient = artifacts.require('TestRecipient')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Forwarder = artifacts.require('Forwarder')

contract('TransactionManager', function (accounts) {
  let id: string
  let _web3: Web3
  let relayServer: RelayServer
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let gasLess: Address
  let gasLess2: Address
  let relayTransactionParams: RelayTransactionParams
  let options: PrepareRelayRequestOption
  let options2: PrepareRelayRequestOption
  let recipientAddress: Address
  let paymasterAddress: Address

  before(async function () {
    const ethereumNodeUrl = (web3.currentProvider as HttpProvider).host
    _web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))

    const relayClient = new RelayClient(_web3.currentProvider as HttpProvider, {})

    const stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    const forwarder = await Forwarder.new()
    // register hub's RelayRequest with forwarder, if not already done.
    await forwarder.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    )

    const rhub = await deployHub(stakeManager.address, penalizer.address)
    const relayHubAddress = rhub.address
    const forwarderAddress = forwarder.address
    const partialConfig: Partial<GSNConfig> = {
      relayHubAddress,
      stakeManagerAddress: stakeManager.address
    }
    const newRelayParams: NewRelayParams = {
      alertedBlockDelay: 0,
      ethereumNodeUrl,
      relayHubAddress,
      relayOwner: accounts[0],
      url: LocalhostOne,
      web3,
      stakeManager
    }
    relayServer = await bringUpNewRelay(newRelayParams, partialConfig)

    // initialize server - gas price, stake, owner, etc, whatever
    const latestBlock = await _web3.eth.getBlock('latest')
    await relayServer._worker(latestBlock.number)

    paymaster = await TestPaymasterEverythingAccepted.new({ gas: 1e7 })

    paymasterAddress = paymaster.address

    await paymaster.setRelayHub(relayHubAddress)
    await paymaster.setTrustedForwarder(forwarderAddress)
    await paymaster.deposit({ value: _web3.utils.toWei('1', 'ether') })

    const sr = await TestRecipient.new(forwarderAddress)
    const encodedFunction = sr.contract.methods.emitMessage('hello world').encodeABI()
    recipientAddress = sr.address

    gasLess = await web3.eth.personal.newAccount('password')
    gasLess2 = await _web3.eth.personal.newAccount('password2')

    relayTransactionParams = {
      gasLess,
      recipientAddress,
      relayHubAddress,
      encodedFunction,
      paymasterData: '',
      clientId: '',
      forwarderAddress,
      paymasterAddress,
      relayServer,
      web3,
      relayClient
    }

    options = {
      from: gasLess,
      to: sr.address,
      pctRelayFee: 0,
      baseRelayFee: '0',
      paymaster: paymaster.address
    }

    // two gas-less accounts are needed to prevent race for sender's forwarder nonce
    options2 = {
      ...options,
      from: gasLess2
    }
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
        const promises = [relayTransaction(relayTransactionParams, options), relayTransaction(relayTransactionParams, options2)]
        await Promise.all(promises)
        assert.fail()
      } catch (e) {
        console.log(e)
        assert.include(e.message, 'violates the unique constraint')
        // since we forced the server to create an illegal tx with an already used nonce, we decrease the nonce
        relayServer.transactionManager.nonces[1]--
      } finally {
        relayServer.transactionManager.nonceMutex = nonceMutexOrig
      }
    })

    it('should handle nonce atomically', async function () {
      // noinspection ES6MissingAwait - done on purpose
      const promises = [relayTransaction(relayTransactionParams, options), relayTransaction(relayTransactionParams, options2)]
      await Promise.all(promises)
    })

    it('should not deadlock if server returned error while locked', async function () {
      try {
        signTransactionOrig = relayServer.transactionManager.workersKeyManager.signTransaction
        relayServer.transactionManager.workersKeyManager.signTransaction = function () {
          throw new Error('no tx for you')
        }
        try {
          await relayTransaction(relayTransactionParams, options)
        } catch (e) {
          assert.include(e.message, 'no tx for you')
          assert.isFalse(relayServer.transactionManager.nonceMutex.isLocked(), 'nonce mutex not released after exception')
        }
      } finally {
        relayServer.transactionManager.workersKeyManager.signTransaction = signTransactionOrig
      }
    })
  })

  describe('resend unconfirmed transactions task', function () {
    it('should resend unconfirmed transaction', async function () {
      // First clear db
      await relayServer.transactionManager.txStoreManager.clearAll()
      assert.deepEqual([], await relayServer.transactionManager.txStoreManager.getAll())
      // Send a transaction via the relay, but then revert to a previous snapshot
      id = (await snapshot()).result
      const signedTx = await relayTransaction(relayTransactionParams, options)
      let parsedTxHash = ethUtils.bufferToHex((new Transaction(signedTx, relayServer.transactionManager.rawTxOptions)).hash())
      const receiptBefore = await _web3.eth.getTransactionReceipt(parsedTxHash)
      const minedTxBefore = await _web3.eth.getTransaction(parsedTxHash)
      assert.equal(parsedTxHash, receiptBefore.transactionHash)
      await revert(id)
      // Ensure tx is removed by the revert
      const receiptAfter = await _web3.eth.getTransactionReceipt(parsedTxHash)
      assert.equal(null, receiptAfter)
      // Should not do anything, as not enough time has passed
      let sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      let latestBlock = await _web3.eth.getBlock('latest')
      let resentTx = await relayServer._resendUnconfirmedTransactions(latestBlock.number)
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      // Increase time by hooking Date.now()
      try {
        const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
        // @ts-ignore
        Date.origNow = Date.now
        Date.now = function () {
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
          return Date.origNow() + pendingTransactionTimeout
        }
        // Resend tx, now should be ok
        latestBlock = await _web3.eth.getBlock('latest')
        resentTx = await relayServer._resendUnconfirmedTransactions(latestBlock.number)
        parsedTxHash = ethUtils.bufferToHex((new Transaction(resentTx, relayServer.transactionManager.rawTxOptions)).hash())

        // Validate relayed tx with increased gasPrice
        const minedTxAfter = await _web3.eth.getTransaction(parsedTxHash)
        // BN.muln() does not support floats so to mul by 1.2, we have to mul by 12 and div by 10 to keep precision
        assert.equal(toBN(minedTxAfter.gasPrice).toString(), toBN(minedTxBefore.gasPrice).muln(12).divn(10).toString())
        await assertTransactionRelayed(relayServer, parsedTxHash, gasLess, recipientAddress, paymasterAddress, _web3)
      } finally {
        // Release hook
        // @ts-ignore
        Date.now = Date.origNow
      }
      // Check the tx is removed from the store only after enough blocks
      latestBlock = await _web3.eth.getBlock('latest')
      resentTx = await relayServer._resendUnconfirmedTransactions(latestBlock.number)
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      const confirmationsNeeded = 12
      await evmMineMany(confirmationsNeeded)
      latestBlock = await _web3.eth.getBlock('latest')
      resentTx = await relayServer._resendUnconfirmedTransactions(latestBlock.number)
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
      assert.deepEqual([], sortedTxs)

      // Revert for following tests
      await revert(id)
    })

    it('should resend multiple unconfirmed transactions', async function () {
      // First clear db
      await relayServer.transactionManager.txStoreManager.clearAll()
      assert.deepEqual([], await relayServer.transactionManager.txStoreManager.getAll())
      // Send 3 transactions, separated by 1 min each, and revert the last 2
      const signedTx1 = await relayTransaction(relayTransactionParams, options)
      id = (await snapshot()).result
      // Increase time by hooking Date
      let constructorIncrease = 2 * 60 * 1000 // 1 minute in milliseconds
      let nowIncrease = 0
      const origDate = Date
      try {
        const NewDate = class extends Date {
          constructor () {
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            super(Date.origNow() + constructorIncrease)
          }

          static now (): number {
            return super.now() + nowIncrease
          }

          static origNow (): number {
            return super.now()
          }
        }
        // @ts-ignore
        Date = NewDate // eslint-disable-line no-global-assign
        await relayTransaction(relayTransactionParams, options)
        constructorIncrease = 4 * 60 * 1000 // 4 minutes in milliseconds
        const signedTx3 = await relayTransaction(relayTransactionParams, options)
        await revert(id)
        const nonceBefore = await _web3.eth.getTransactionCount(relayServer.managerAddress)
        // Check tx1 still went fine after revert
        const parsedTxHash1 = ethUtils.bufferToHex((new Transaction(signedTx1, relayServer.transactionManager.rawTxOptions)).hash())
        await assertTransactionRelayed(relayServer, parsedTxHash1, gasLess, recipientAddress, paymasterAddress, _web3)
        // After 10 minutes, tx2 is not resent because tx1 is still unconfirmed
        nowIncrease = 10 * 60 * 1000 // 10 minutes in milliseconds
        constructorIncrease = 0
        let sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
        // console.log('times:', sortedTxs[0].createdAt, sortedTxs[1].createdAt, sortedTxs[2].createdAt )
        assert.equal(sortedTxs[0].txId, parsedTxHash1)
        let latestBlock = await _web3.eth.getBlock('latest')
        let resentTx = await relayServer._resendUnconfirmedTransactions(latestBlock.number)
        assert.equal(null, resentTx)
        assert.equal(nonceBefore, await _web3.eth.getTransactionCount(relayServer.managerAddress))
        sortedTxs = await relayServer.transactionManager.txStoreManager.getAll()
        // console.log('sortedTxs?', sortedTxs)
        assert.equal(sortedTxs[0].txId, parsedTxHash1)
        // Mine a bunch of blocks, so tx1 is confirmed and tx2 is resent
        const confirmationsNeeded = 12
        await evmMineMany(confirmationsNeeded)
        latestBlock = await _web3.eth.getBlock('latest')
        const resentTx2 = await relayServer._resendUnconfirmedTransactions(latestBlock.number)
        const parsedTxHash2 = ethUtils.bufferToHex((new Transaction(resentTx2, relayServer.transactionManager.rawTxOptions)).hash())
        await assertTransactionRelayed(relayServer, parsedTxHash2, gasLess, recipientAddress, paymasterAddress, _web3)
        // Re-inject tx3 into the chain as if it were mined once tx2 goes through
        await _web3.eth.sendSignedTransaction(signedTx3)
        const parsedTxHash3 = ethUtils.bufferToHex((new Transaction(signedTx3, relayServer.transactionManager.rawTxOptions)).hash())
        await assertTransactionRelayed(relayServer, parsedTxHash3, gasLess, recipientAddress, paymasterAddress, _web3)
        // Check that tx3 does not get resent, even after time passes or blocks get mined, and that store is empty
        nowIncrease = 60 * 60 * 1000 // 60 minutes in milliseconds
        await evmMineMany(confirmationsNeeded)
        latestBlock = await _web3.eth.getBlock('latest')
        resentTx = await relayServer._resendUnconfirmedTransactions(latestBlock.number)
        assert.equal(null, resentTx)
        assert.deepEqual([], await relayServer.transactionManager.txStoreManager.getAll())
      } finally {
        // Release hook
        Date = origDate // eslint-disable-line no-global-assign
      }
    })
  })
})
