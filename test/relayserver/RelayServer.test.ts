/* global artifacts describe */
// @ts-ignore
import { HttpProvider } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'

import { GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { SendTransactionDetails, SignedTransactionDetails } from '../../src/relayserver/TransactionManager'
import { ServerConfigParams } from '../../src/relayserver/ServerConfigParams'
import { TestPaymasterConfigurableMisbehaviorInstance } from '../../types/truffle-contracts'
import { defaultEnvironment } from '../../src/common/Environments'
import { sleep } from '../../src/common/Utils'

import { evmMine, evmMineMany, INCORRECT_ECDSA_SIGNATURE, revert, snapshot } from '../TestUtils'
import { LocalhostOne, ServerTestEnvironment } from './ServerTestEnvironment'
import { RelayTransactionRequest } from '../../src/common/types/RelayTransactionRequest'
import { assertRelayAdded, getTotalTxCosts } from './ServerTestUtils'
import { PrefixedHexString } from 'ethereumjs-tx'
import { ServerAction } from '../../src/relayserver/StoredTransaction'

const { expect, assert } = chai.use(chaiAsPromised).use(sinonChai)

const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

contract('RelayServer', function (accounts) {
  const alertedBlockDelay = 0
  const baseRelayFee = '12'

  let id: string
  let globalId: string
  let env: ServerTestEnvironment

  before(async function () {
    globalId = (await snapshot()).result
    const relayClientConfig: Partial<GSNConfig> = {
      preferredRelays: [LocalhostOne],
      maxRelayNonceGap: 0
    }

    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init(relayClientConfig)
    const overrideParams: Partial<ServerConfigParams> = {
      alertedBlockDelay,
      baseRelayFee
    }
    await env.newServerInstance(overrideParams)
    await env.clearServerStorage()
  })

  after(async function () {
    await revert(globalId)
    await env.clearServerStorage()
  })

  describe('#init()', function () {
    it('should initialize relay params (chainId, networkId, gasPrice)', async function () {
      const env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
      await env.init({})
      await env.newServerInstanceNoInit()
      const relayServerToInit = env.relayServer
      const chainId = await env.web3.eth.getChainId()
      const networkId = await env.web3.eth.net.getId()
      assert.notEqual(relayServerToInit.chainId, chainId)
      assert.notEqual(relayServerToInit.networkId, networkId)
      assert.equal(relayServerToInit.isReady(), false)
      await relayServerToInit.init()
      assert.equal(relayServerToInit.isReady(), false, 'relay should not be ready yet')
      assert.equal(relayServerToInit.chainId, chainId)
      assert.equal(relayServerToInit.networkId, networkId)
    })
  })

  describe.skip('#_worker()', function () {
  })

  describe('#isReady after exception', () => {
    let relayServer: RelayServer
    before(async () => {
      relayServer = env.relayServer
      // force "ready
      assert.equal(relayServer.isReady(), true)
      const stub = sinon.stub(relayServer.contractInteractor, 'getBlock').rejects(Error('simulate getBlock failed'))
      try {
        await relayServer.intervalHandler()
      } finally {
        // remove stub
        stub.restore()
      }
    })

    it('should set "deferReadiness" after exception', async () => {
      assert.equal(relayServer.isReady(), false)
    })

    it('after setReadyState(true), should stay non ready', () => {
      relayServer.setReadyState(true)
      assert.equal(relayServer.isReady(), false)
    })

    it('should become ready after processing few blocks', async () => {
      await evmMineMany(1)
      await relayServer.intervalHandler()
      assert.equal(relayServer.isReady(), false)
      await evmMineMany(1)
      await relayServer.intervalHandler()
      await evmMineMany(1)
      await relayServer.intervalHandler()
      assert.equal(relayServer.isReady(), true)
    })
  })

  describe('validation', function () {
    describe('#validateInput()', function () {
      it('should fail to relay with wrong relay worker', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.relayWorker = accounts[1]
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message, `Wrong worker address: ${accounts[1]}`)
        }
      })

      it('should fail to relay with unacceptable gasPrice', async function () {
        const wrongGasPrice = '100'
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.gasPrice = wrongGasPrice
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message,
            `Unacceptable gasPrice: relayServer's gasPrice:${env.relayServer.gasPrice} request's gasPrice: ${wrongGasPrice}`)
        }
      })

      it('should fail to relay with wrong hub address', async function () {
        const wrongHubAddress = '0xdeadface'
        const req = await env.createRelayHttpRequest()
        req.metadata.relayHubAddress = wrongHubAddress
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message,
            `Wrong hub address.\nRelay server's hub address: ${env.relayServer.config.relayHubAddress}, request's hub address: ${wrongHubAddress}\n`)
        }
      })
    })

    describe('#validateFees()', function () {
      describe('with trusted forwarder', function () {
        before(async function () {
          await env.relayServer._initTrustedPaymasters([env.paymaster.address])
        })

        after(async function () {
          await env.relayServer._initTrustedPaymasters([])
        })

        it('#_itTrustedForwarder', function () {
          assert.isFalse(env.relayServer._isTrustedPaymaster(accounts[1]), 'identify untrusted paymaster')
          assert.isTrue(env.relayServer._isTrustedPaymaster(env.paymaster.address), 'identify trusted paymaster')
        })

        it('should bypass fee checks and not throw if given trusted paymasters', async function () {
          const req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.baseRelayFee = (parseInt(env.relayServer.config.baseRelayFee) - 1).toString()
          env.relayServer.validateFees(req)
        })
      })

      describe('without trusted forwarder', function () {
        it('should fail to relay with wrong baseRelayFee', async function () {
          const req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.baseRelayFee = (parseInt(env.relayServer.config.baseRelayFee) - 1).toString()
          try {
            env.relayServer.validateFees(req)
            assert.fail()
          } catch (e) {
            assert.include(e.message, 'Unacceptable baseRelayFee:')
          }
        })

        it('should fail to relay with wrong pctRelayFee', async function () {
          const wrongPctRelayFee = (env.relayServer.config.pctRelayFee - 1).toString()
          const req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.pctRelayFee = wrongPctRelayFee
          try {
            env.relayServer.validateFees(req)
            assert.fail()
          } catch (e) {
            assert.include(e.message, 'Unacceptable pctRelayFee:')
          }
        })
      })

      describe('#validateMaxNonce()', function () {
        before(async function () {
          // this is a new worker account - create transaction
          await evmMineMany(1)
          const latestBlock = (await env.web3.eth.getBlock('latest')).number
          await env.relayServer._worker(latestBlock)
          const signer = env.relayServer.workerAddress
          await env.relayServer.transactionManager.sendTransaction({
            signer,
            serverAction: ServerAction.VALUE_TRANSFER,
            gasLimit: defaultEnvironment.mintxgascost,
            destination: accounts[0],
            creationBlockNumber: 0
          })
        })

        it('should not throw with relayMaxNonce above current nonce', async function () {
          await env.relayServer.validateMaxNonce(1000)
        })

        it('should throw exception with relayMaxNonce below current nonce', async function () {
          try {
            await env.relayServer.validateMaxNonce(0)
            assert.fail()
          } catch (e) {
            assert.include(e.message, 'Unacceptable relayMaxNonce:')
          }
        })
      })
    })

    describe('#validatePaymasterGasLimits()', function () {
      it('should fail to relay with invalid paymaster', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.paymaster = accounts[1]
        try {
          await env.relayServer.validatePaymasterGasLimits(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message, `not a valid paymaster contract: ${accounts[1]}`)
        }
      })

      it('should fail to relay when paymaster\'s balance too low', async function () {
        id = (await snapshot()).result
        const req = await env.createRelayHttpRequest()
        try {
          await env.paymaster.withdrawAll(accounts[0])
          await env.relayServer.validatePaymasterGasLimits(req)
          assert.fail()
        } catch (e) {
          assert.include(e.message, 'paymaster balance too low')
        } finally {
          await revert(id)
        }
      })

      describe('relay max exposure to paymaster rejections', function () {
        const paymasterExpectedAcceptanceBudget = 150000
        let rejectingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
        let req: RelayTransactionRequest

        before(async function () {
          rejectingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
          await rejectingPaymaster.setTrustedForwarder(env.forwarder.address)
          await rejectingPaymaster.setRelayHub(env.relayHub.address)
          await rejectingPaymaster.deposit({ value: env.web3.utils.toWei('1', 'ether') })
          req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.paymaster = rejectingPaymaster.address
        })

        it('should reject a transaction from paymaster returning above configured max exposure', async function () {
          await rejectingPaymaster.setGreedyAcceptanceBudget(true)
          try {
            await env.relayServer.validatePaymasterGasLimits(req)
            assert.fail()
          } catch (e) {
            assert.include(e.message, 'paymaster acceptance budget too high')
          }
        })

        it('should accept a transaction from paymaster returning below configured max exposure', async function () {
          await rejectingPaymaster.setGreedyAcceptanceBudget(false)
          const gasLimits = await rejectingPaymaster.getGasLimits()
          assert.equal(parseInt(gasLimits.acceptanceBudget), paymasterExpectedAcceptanceBudget)
          await env.relayServer.validatePaymasterGasLimits(req)
        })

        it('should accept a transaction from trusted paymaster returning above configured max exposure', async function () {
          await rejectingPaymaster.setGreedyAcceptanceBudget(true)
          const req = await env.createRelayHttpRequest()
          try {
            await env.relayServer._initTrustedPaymasters([rejectingPaymaster.address])
            const gasLimits = await rejectingPaymaster.getGasLimits()
            assert.equal(parseInt(gasLimits.acceptanceBudget), paymasterExpectedAcceptanceBudget * 9)
            await env.relayServer.validatePaymasterGasLimits(req)
          } finally {
            await env.relayServer._initTrustedPaymasters([])
          }
        })
      })
    })

    describe('#validateViewCallSucceeds()', function () {
      it('should fail to relay rejected transaction', async function () {
        const req = await env.createRelayHttpRequest()
        req.metadata.signature = INCORRECT_ECDSA_SIGNATURE
        try {
          await env.relayServer.validateViewCallSucceeds(req, 150000, 2000000)
          assert.fail()
        } catch (e) {
          assert.include(e.message, 'Paymaster rejected in server: FWD: signature mismatch')
        }
      })
    })
  })

  describe('#createRelayTransaction()', function () {
    before(async function () {
      await env.relayServer.txStoreManager.clearAll()
    })

    it('should relay transaction', async function () {
      const req = await env.createRelayHttpRequest()
      assert.equal((await env.relayServer.txStoreManager.getAll()).length, 0)
      await env.relayServer.createRelayTransaction(req)
      const pendingTransactions = await env.relayServer.txStoreManager.getAll()
      assert.equal(pendingTransactions.length, 1)
      assert.equal(pendingTransactions[0].serverAction, ServerAction.RELAY_CALL)
      // TODO: add asserts here!!!
    })
  })

  describe('relay workers/manager rebalancing', function () {
    let relayServer: RelayServer
    const workerIndex = 0
    const gasPrice = 1e9.toString()
    let beforeDescribeId: string
    const txCost = toBN(defaultEnvironment.mintxgascost * parseInt(gasPrice))

    // TODO: not needed, worker is not funded at this point!
    before('deplete worker balance', async function () {
      relayServer = env.relayServer
      beforeDescribeId = (await snapshot()).result
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.workerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost,
        gasPrice: gasPrice,
        creationBlockNumber: 0,
        value: toHex((await relayServer.getWorkerBalance(workerIndex)).sub(txCost))
      })
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.lt(toBN(relayServer.config.workerMinBalance)),
        'worker balance should be lower than min balance')
    })

    after(async function () {
      await revert(beforeDescribeId)
    })

    beforeEach(async function () {
      id = (await snapshot()).result
      await relayServer.transactionManager.txStoreManager.clearAll()
    })

    afterEach(async function () {
      await revert(id)
      relayServer.transactionManager._initNonces()
      await relayServer.transactionManager.txStoreManager.clearAll()
    })

    it('should not replenish when all balances are sufficient', async function () {
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: relayServer.config.managerTargetBalance
      })
      await env.web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.workerAddress, value: relayServer.config.workerTargetBalance })
      const currentBlockNumber = await env.web3.eth.getBlockNumber()
      const receipts = await relayServer.replenishServer(workerIndex, 0)
      assert.deepEqual(receipts, [])
      assert.equal(currentBlockNumber, await env.web3.eth.getBlockNumber())
    })

    it('should withdraw hub balance to manager first, then use eth balance to fund workers', async function () {
      await env.relayHub.depositFor(relayServer.managerAddress, { value: 1e18.toString() })
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost,
        gasPrice: gasPrice,
        value: toHex((await relayServer.getManagerBalance()).sub(txCost))
      })
      assert.equal((await relayServer.getManagerBalance()).toString(), '0')
      await env.web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.managerAddress, value: relayServer.config.managerTargetBalance - 1e7 })
      const managerHubBalanceBefore = await env.relayHub.balanceOf(relayServer.managerAddress)
      const managerEthBalanceBefore = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance.toString()).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.gte(refill), 'manager hub balance should be sufficient to replenish worker')
      assert.isTrue(managerEthBalanceBefore.lt(toBN(relayServer.config.managerTargetBalance.toString())),
        'manager eth balance should be lower than target to withdraw hub balance')
      const receipts = await relayServer.replenishServer(workerIndex, 0)
      const totalTxCosts = await getTotalTxCosts(receipts, await env.web3.eth.getGasPrice())
      const managerHubBalanceAfter = await env.relayHub.balanceOf(relayServer.managerAddress)
      assert.isTrue(managerHubBalanceAfter.eqn(0), 'manager hub balance should be zero')
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
      const managerEthBalanceAfter = await relayServer.getManagerBalance()
      assert.isTrue(managerEthBalanceAfter.eq(managerEthBalanceBefore.add(managerHubBalanceBefore).sub(refill).sub(totalTxCosts)),
        'manager eth balance should increase by hub balance minus txs costs')
    })

    it('should fund from manager eth balance when sufficient without withdrawing from hub when balance too low', async function () {
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: 1e18
      })
      const managerHubBalanceBefore = await env.relayHub.balanceOf(relayServer.managerAddress)
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.gte(refill), 'manager eth balance should be sufficient to replenish worker')
      await relayServer.replenishServer(workerIndex, 0)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
    })

    it('should emit \'funding needed\' when both eth and hub balances are too low', async function () {
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost,
        gasPrice: gasPrice.toString(),
        value: toHex((await relayServer.getManagerBalance()).sub(txCost))
      })
      const managerHubBalanceBefore = await env.relayHub.balanceOf(relayServer.managerAddress)
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.lt(refill), 'manager eth balance should be insufficient to replenish worker')
      let fundingNeededEmitted = false
      relayServer.on('fundingNeeded', () => {
        fundingNeededEmitted = true
      })
      await relayServer.replenishServer(workerIndex, 0)
      assert.isTrue(fundingNeededEmitted, 'fundingNeeded not emitted')
    })
  })

  describe('server keepalive re-registration', function () {
    const registrationBlockRate = 100
    const refreshStateTimeoutBlocks = 1
    let relayServer: RelayServer

    before(async function () {
      await env.newServerInstance({
        registrationBlockRate,
        refreshStateTimeoutBlocks
      })
      relayServer = env.relayServer
      sinon.spy(relayServer.registrationManager, 'handlePastEvents')
    })

    it('should re-register server only if registrationBlockRate passed from any tx', async function () {
      let latestBlock = await env.web3.eth.getBlock('latest')
      let receipts = await relayServer._worker(latestBlock.number)
      const receipts2 = await relayServer._worker(latestBlock.number + 1)
      expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, sinon.match.any, sinon.match.any, false)
      assert.equal(receipts.length, 0, 'should not re-register if already registered')
      assert.equal(receipts2.length, 0, 'should not re-register if already registered')
      await evmMineMany(registrationBlockRate)
      latestBlock = await env.web3.eth.getBlock('latest')
      receipts = await relayServer._worker(latestBlock.number)
      expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, sinon.match.any, sinon.match.any, true)
      await assertRelayAdded(receipts, relayServer, false)
    })
  })

  describe('listener task', function () {
    let relayServer: RelayServer
    let origWorker: (blockNumber: number) => Promise<PrefixedHexString[]>
    let started: boolean
    beforeEach(function () {
      relayServer = env.relayServer
      origWorker = relayServer._worker
      started = false
      relayServer._worker = async function () {
        await Promise.resolve()
        started = true
        this.emit('error', new Error('GOTCHA'))
        return []
      }
    })
    afterEach(function () {
      relayServer._worker = origWorker
    })
    it.skip('should start block listener', async function () {
      relayServer.start()
      await evmMine()
      await sleep(200)
      assert.isTrue(started, 'could not start task correctly')
    })
    it.skip('should stop block listener', async function () {
      relayServer.stop()
      await evmMine()
      await sleep(200)
      assert.isFalse(started, 'could not stop task correctly')
    })
  })

  describe('Function testing', function () {
    let relayServer: RelayServer

    before(function () {
      relayServer = env.relayServer
    })
    it('_workerSemaphore', async function () {
      assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false first')
      const workerOrig = relayServer._worker
      let shouldRun = true
      try {
        relayServer._worker = async function (): Promise<PrefixedHexString[]> {
          // eslint-disable-next-line no-unmodified-loop-condition
          while (shouldRun) {
            await sleep(200)
          }
          return []
        }
        const latestBlock = await env.web3.eth.getBlock('latest')
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        relayServer._workerSemaphore(latestBlock.number)
        assert.isTrue(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be true after')
        shouldRun = false
        await sleep(200)
        assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false after')
      } finally {
        relayServer._worker = workerOrig
      }
    })
  })

  describe('alerted state as griefing mitigation', function () {
    const alertedBlockDelay = 100
    const refreshStateTimeoutBlocks = 1
    let rejectingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
    let newServer: RelayServer

    beforeEach('should enter an alerted state for a configured blocks delay after paymaster rejecting an on-chain tx', async function () {
      id = (await snapshot()).result
      await env.newServerInstance({
        alertedBlockDelay,
        refreshStateTimeoutBlocks
      })
      newServer = env.relayServer
      rejectingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await rejectingPaymaster.setTrustedForwarder(env.forwarder.address)
      await rejectingPaymaster.setRelayHub(env.relayHub.address)
      await rejectingPaymaster.deposit({ value: env.web3.utils.toWei('1', 'ether') })
      await attackTheServer(newServer)
    })
    afterEach(async function () {
      await revert(id)
      newServer.transactionManager._initNonces()
    })

    async function attackTheServer (server: RelayServer): Promise<void> {
      const _sendTransactionOrig = server.transactionManager.sendTransaction
      server.transactionManager.sendTransaction = async function ({ signer, method, destination, value = '0x', gasLimit, gasPrice }: SendTransactionDetails): Promise<SignedTransactionDetails> {
        await rejectingPaymaster.setRevertPreRelayCall(true)
        // @ts-ignore
        return (await _sendTransactionOrig.call(server.transactionManager, ...arguments))
      }
      const req = await env.createRelayHttpRequest({ paymaster: rejectingPaymaster.address })
      await env.relayServer.createRelayTransaction(req)
      // await relayTransaction(relayTransactionParams2, options2, { paymaster: rejectingPaymaster.address }, false)
      const currentBlock = await env.web3.eth.getBlock('latest')
      await server._worker(currentBlock.number)
      assert.isTrue(server.alerted, 'server not alerted')
      assert.equal(server.alertedBlock, currentBlock.number, 'server alerted block incorrect')
    }

    it('should delay transactions in alerted state', async function () {
      newServer.config.minAlertedDelayMS = 300
      newServer.config.maxAlertedDelayMS = 350
      const timeBefore = Date.now()
      const req = await env.createRelayHttpRequest()
      await env.relayServer.createRelayTransaction(req)
      // await relayTransaction(relayTransactionParams, options)
      const timeAfter = Date.now()
      assert.isTrue((timeAfter - timeBefore) > 300, 'checking that enough time passed')
    })

    it('should exit alerted state after the configured blocks delay', async function () {
      await evmMineMany(newServer.config.alertedBlockDelay - 1)
      let latestBlock = await env.web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      assert.isTrue(newServer.alerted, 'server not alerted')
      await evmMineMany(2)
      latestBlock = await env.web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      assert.isFalse(newServer.alerted, 'server alerted')
    })
  })
})
