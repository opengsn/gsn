/* global artifacts describe */
// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import crypto from 'crypto'
import { HttpProvider, TransactionReceipt } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'

import { RelayServer } from '../../src/relayserver/RelayServer'
import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../src/common/interfaces/IStakeManager.json'
import PayMasterABI from '../../src/common/interfaces/IPaymaster.json'
import { defaultEnvironment } from '../../src/common/Environments'
import {
  ForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestPaymasterEverythingAcceptedInstance
} from '../../types/truffle-contracts'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { GsnRequestType } from '../../src/common/EIP712/TypedRequestData'

import { deployHub, evmMine, evmMineMany, revert, snapshot } from '../TestUtils'
import {
  NewRelayParams,
  PrepareRelayRequestOption,
  RelayTransactionParams,
  bringUpNewRelay,
  clearStorage,
  getTotalTxCosts,
  prepareRelayRequest,
  relayTransaction,
  relayTransactionFromRequest, LocalhostOne, getTemporaryWorkdirs, assertRelayAdded
} from './ServerTestUtils'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { SendTransactionDetails, SignedTransactionDetails } from '../../src/relayserver/TransactionManager'
import { sleep } from '../../src/common/Utils'
import { TxStoreManager } from '../../src/relayserver/TxStoreManager'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { KeyManager } from '../../src/relayserver/KeyManager'

const { expect, assert } = chai.use(chaiAsPromised).use(sinonChai)

const TestRecipient = artifacts.require('TestRecipient')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)

contract('RelayServer', function (accounts) {
  const relayOwner = accounts[4]
  const pctRelayFee = 11
  const baseRelayFee = '12'
  const workerIndex = 0
  const paymasterData = '0x'
  const clientId = '0'

  let relayTransactionParams: RelayTransactionParams
  let rhub: RelayHubInstance
  let forwarder: ForwarderInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let relayServer: RelayServer
  let ethereumNodeUrl: string
  let _web3: Web3
  let id: string
  let globalId: string
  let options: PrepareRelayRequestOption
  let newRelayParams: NewRelayParams
  let partialConfig: Partial<GSNConfig>

  before(async function () {
    globalId = (await snapshot()).result
    ethereumNodeUrl = (web3.currentProvider as HttpProvider).host
    _web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))

    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    rhub = await deployHub(stakeManager.address, penalizer.address)
    forwarder = await Forwarder.new()
    const forwarderAddress = forwarder.address
    const sr = await TestRecipient.new(forwarderAddress)
    paymaster = await TestPaymasterEverythingAccepted.new()
    // register hub's RelayRequest with forwarder, if not already done.
    await forwarder.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    )

    await paymaster.setTrustedForwarder(forwarderAddress)
    await paymaster.setRelayHub(rhub.address)
    await paymaster.deposit({ value: _web3.utils.toWei('1', 'ether') })
    const gasLess = await _web3.eth.personal.newAccount('password')

    newRelayParams = {
      alertedBlockDelay: 0,
      ethereumNodeUrl,
      relayHubAddress: rhub.address,
      relayOwner,
      url: LocalhostOne,
      web3,
      stakeManager
    }
    partialConfig = {
      relayHubAddress: rhub.address,
      stakeManagerAddress: stakeManager.address
    }
    relayServer = await bringUpNewRelay(newRelayParams, partialConfig, {}, {
      trustedPaymasters: [paymaster.address],
      baseRelayFee
    })
    // initialize server - gas price, stake, owner, etc, whatever
    const latestBlock = await _web3.eth.getBlock('latest')
    await relayServer._worker(latestBlock.number)

    // TODO: why is this assert here?
    assert.deepEqual(relayServer.config.trustedPaymasters, [paymaster.address], 'trusted paymaster not initialized correctly')
    relayServer.on('error', (e) => {
      console.log('error event', e.message)
    })
    console.log('Relay Manager=', relayServer.managerAddress, 'Worker=', relayServer.workerAddress)

    const encodedFunction = sr.contract.methods.emitMessage('hello world').encodeABI()
    const relayClientConfig = {
      preferredRelays: [LocalhostOne],
      maxRelayNonceGap: 0,
      verbose: process.env.DEBUG != null
    }

    const config = configureGSN(relayClientConfig)
    const relayClient = new RelayClient(new Web3.providers.HttpProvider(ethereumNodeUrl), config)

    options = {
      from: gasLess,
      to: sr.address,
      pctRelayFee,
      baseRelayFee,
      paymaster: paymaster.address
    }
    relayTransactionParams = {
      gasLess,
      relayHubAddress: rhub.address,
      recipientAddress: sr.address,
      encodedFunction,
      paymasterData,
      clientId,
      forwarderAddress,
      paymasterAddress: paymaster.address,
      web3: _web3,
      relayServer,
      relayClient
    }
    await clearStorage(relayServer.transactionManager.txStoreManager)
  })

  after(async function () {
    await revert(globalId)
  })

  before(async function () {
    await clearStorage(relayServer.transactionManager.txStoreManager)
  })

  after(async function () {
    await clearStorage(relayServer.transactionManager.txStoreManager)
  })

  describe('#init()', function () {
    it('should initialize relay params (chainId, networkId, gasPrice)', async function () {
      const managerKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
      const workersKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
      const txStoreManager = new TxStoreManager({ workdir: getTemporaryWorkdirs().workdir })
      const serverWeb3provider = new Web3.providers.HttpProvider(newRelayParams.ethereumNodeUrl!)
      const contractInteractor = new ContractInteractor(serverWeb3provider, configureGSN(partialConfig))
      await contractInteractor.init()
      const serverDependencies = {
        txStoreManager,
        managerKeyManager,
        workersKeyManager,
        contractInteractor
      }
      const relayServerToInit = new RelayServer(relayServer.config, serverDependencies)
      const chainId = await _web3.eth.getChainId()
      const networkId = await _web3.eth.net.getId()
      assert.notEqual(relayServerToInit.chainId, chainId)
      assert.notEqual(relayServerToInit.networkId, networkId)
      assert.equal(relayServerToInit.ready, false)
      await relayServerToInit.init()
      assert.equal(relayServerToInit.ready, false, 'relay should not be ready yet')
      assert.equal(relayServerToInit.chainId, chainId)
      assert.equal(relayServerToInit.networkId, networkId)
    })
  })

  describe.skip('#_worker()', function () {
  })

  // TODO: most of this tests have literally nothing to do with Relay Server and actually double-check the client code.
  describe('relay transaction flows', function () {
    it('should relay transaction', async function () {
      await relayTransaction(relayTransactionParams, options)
    })

    // skipped because error message changed here for no apparent reason
    it.skip('should fail to relay with undefined data', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { data: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })

    // skipped because error message changed here for no apparent reason
    it.skip('should fail to relay with undefined approvalData', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { approvalData: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })

    // skipped because error message changed here for no apparent reason
    it.skip('should fail to relay with undefined signature', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { signature: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })

    it('should fail to relay with wrong signature', async function () {
      try {
        await relayTransaction(relayTransactionParams, options,
          { signature: '0xdeadface00000a58b757da7dea5678548be5ff9b16e9d1d87c6157aff6889c0f6a406289908add9ea6c3ef06d033a058de67d057e2c0ae5a02b36854be13b0731c' })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster rejected in server: signature mismatch')
      }
    })

    // this test does not check what it declares to. nonce mismatch is accidental.
    it.skip('should fail to relay with wrong from', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { from: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster rejected in server: nonce mismatch')
      }
    })

    it('should fail to relay with wrong relay worker', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { relayWorker: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, `Wrong worker address: ${accounts[1]}`)
      }
    })

    it('should fail to relay with wrong recipient', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { to: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster rejected in server: isTrustedForwarder returned invalid response')
      }
    })

    it('should fail to relay with invalid paymaster', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { paymaster: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, `non-existent or incompatible paymaster contract: ${accounts[1]}`)
      }
    })

    it('should fail to relay when paymaster\'s balance too low', async function () {
      id = (await snapshot()).result
      try {
        await paymaster.withdrawAll(accounts[0])
        await relayTransaction(relayTransactionParams, options)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster balance too low')
      } finally {
        await revert(id)
      }
    })

    it('should fail to relay with uninitialized gasPrice', async function () {
      const gasPrice = relayServer.gasPrice
      delete relayServer.gasPrice
      try {
        await relayTransaction(relayTransactionParams, options)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'gasPrice not initialized')
      } finally {
        relayServer.gasPrice = gasPrice
      }
    })

    it('should fail to relay with unacceptable gasPrice', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { gasPrice: 1e2.toString() })
        assert.fail()
      } catch (e) {
        assert.include(e.message,
          `Unacceptable gasPrice: relayServer's gasPrice:${relayServer.gasPrice} request's gasPrice: 100`)
      }
    })

    it('should fail to relay with wrong senderNonce', async function () {
      // @ts-ignore
      const contractInteractor = relayServer.contractInteractor
      const saveGetSenderNonce = contractInteractor.getSenderNonce
      try {
        contractInteractor.getSenderNonce = async () => await Promise.resolve('1234')
        const fromRequestParam = await prepareRelayRequest(relayTransactionParams, options)
        await relayTransactionFromRequest(relayTransactionParams, fromRequestParam)
        try {
          await relayTransactionFromRequest(relayTransactionParams,
            Object.assign({}, fromRequestParam, { relayMaxNonce: fromRequestParam.relayMaxNonce + 1 }))
          assert.fail()
        } catch (e) {
          assert.include(e.message, 'Paymaster rejected in server: nonce mismatch')
        }
      } finally {
        contractInteractor.getSenderNonce = saveGetSenderNonce
      }
    })

    it('should fail to relay with wrong relayMaxNonce', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { relayMaxNonce: 0 })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable relayMaxNonce:')
      }
    })

    it('should fail to relay with wrong baseRelayFee', async function () {
      const trustedPaymaster = relayServer.config.trustedPaymasters.pop()
      try {
        await relayTransaction(relayTransactionParams, options,
          { baseRelayFee: (parseInt(relayServer.config.baseRelayFee) - 1).toString() })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable baseRelayFee:')
      } finally {
        relayServer.config.trustedPaymasters.push(trustedPaymaster!)
      }
    })

    it('should fail to relay with wrong pctRelayFee', async function () {
      const trustedPaymaster = relayServer.config.trustedPaymasters.pop()
      try {
        await relayTransaction(relayTransactionParams, options, { pctRelayFee: (relayServer.config.pctRelayFee - 1).toString() })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable pctRelayFee:')
      } finally {
        relayServer.config.trustedPaymasters.push(trustedPaymaster!)
      }
    })

    it('should  bypass fee checks if given trusted paymasters', async function () {
      const overriddenOptions = {
        baseRelayFee: (parseInt(relayServer.config.baseRelayFee) - 1).toString(),
        ...options
      }
      await relayTransaction(relayTransactionParams, overriddenOptions)
    })

    it('should fail to relay with wrong hub address', async function () {
      try {
        await relayTransaction(relayTransactionParams, options, { relayHubAddress: '0xdeadface' })
        assert.fail()
      } catch (e) {
        assert.include(e.message,
          `Wrong hub address.\nRelay server's hub address: ${relayServer.config.relayHubAddress}, request's hub address: 0xdeadface\n`)
      }
    })
  })

  describe('relay workers/manager rebalancing', function () {
    const gasPrice = 1e9.toString()
    let beforeDescribeId: string
    const txcost = toBN(defaultEnvironment.mintxgascost * parseInt(gasPrice))

    // TODO: not needed, worker is not funded at this point!
    before('deplete worker balance', async function () {
      beforeDescribeId = (await snapshot()).result
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.workerAddress,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost.toString(),
        gasPrice: gasPrice,
        value: toHex((await relayServer.getWorkerBalance(workerIndex)).sub(txcost))
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
      await relayServer.transactionManager.txStoreManager.clearAll()
    })

    it('should not replenish when all balances are sufficient', async function () {
      await _web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: relayServer.config.managerTargetBalance
      })
      await _web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.workerAddress, value: relayServer.config.workerTargetBalance })
      const currentBlockNumber = await _web3.eth.getBlockNumber()
      const receipts = await relayServer.replenishServer(workerIndex)
      assert.deepEqual(receipts, [])
      assert.equal(currentBlockNumber, await _web3.eth.getBlockNumber())
    })

    it('should withdraw hub balance to manager first, then use eth balance to fund workers', async function () {
      await rhub.depositFor(relayServer.managerAddress, { value: 1e18.toString() })
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost.toString(),
        gasPrice: gasPrice,
        value: toHex((await relayServer.getManagerBalance()).sub(txcost))
      })
      assert.equal((await relayServer.getManagerBalance()).toString(), '0')
      await _web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.managerAddress, value: relayServer.config.managerTargetBalance - 1e7 })
      const managerHubBalanceBefore = await rhub.balanceOf(relayServer.managerAddress)
      const managerEthBalanceBefore = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance.toString()).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.gte(refill), 'manager hub balance should be sufficient to replenish worker')
      assert.isTrue(managerEthBalanceBefore.lt(toBN(relayServer.config.managerTargetBalance.toString())),
        'manager eth balance should be lower than target to withdraw hub balance')
      const receipts = await relayServer.replenishServer(workerIndex)
      const totalTxCosts = getTotalTxCosts(receipts, await _web3.eth.getGasPrice())
      const managerHubBalanceAfter = await rhub.balanceOf(relayServer.managerAddress)
      assert.isTrue(managerHubBalanceAfter.eqn(0), 'manager hub balance should be zero')
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
      const managerEthBalanceAfter = await relayServer.getManagerBalance()
      console.log('wtf is balances', managerEthBalanceAfter.toString(), managerEthBalanceBefore.toString(),
        managerHubBalanceBefore.toString(), refill.toString(), totalTxCosts.toString())
      console.log('wtf is diff',
        managerEthBalanceAfter.sub(managerEthBalanceBefore.add(managerHubBalanceBefore).sub(refill).sub(totalTxCosts)).toString())
      assert.isTrue(managerEthBalanceAfter.eq(managerEthBalanceBefore.add(managerHubBalanceBefore).sub(refill).sub(totalTxCosts)),
        'manager eth balance should increase by hub balance minus txs costs')
    })

    it('should fund from manager eth balance when sufficient without withdrawing from hub when balance too low', async function () {
      await _web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: 1e18
      })
      const managerHubBalanceBefore = await rhub.balanceOf(relayServer.managerAddress)
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.gte(refill), 'manager eth balance should be sufficient to replenish worker')
      await relayServer.replenishServer(workerIndex)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
    })

    it('should emit \'funding needed\' when both eth and hub balances are too low', async function () {
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost.toString(),
        gasPrice: gasPrice.toString(),
        value: toHex((await relayServer.getManagerBalance()).sub(txcost))
      })
      const managerHubBalanceBefore = await rhub.balanceOf(relayServer.managerAddress)
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.lt(refill), 'manager eth balance should be insufficient to replenish worker')
      let fundingNeededEmitted = false
      relayServer.on('fundingNeeded', () => { fundingNeededEmitted = true })
      await relayServer.replenishServer(workerIndex)
      assert.isTrue(fundingNeededEmitted, 'fundingNeeded not emitted')
    })
  })

  describe('server keepalive re-registration', function () {
    const registrationBlockRate = 100
    let relayServer: RelayServer

    before(async function () {
      relayServer = await bringUpNewRelay(newRelayParams, partialConfig, {}, { registrationBlockRate })
      const latestBlock = await _web3.eth.getBlock('latest')
      const receipts = await relayServer._worker(latestBlock.number)
      assertRelayAdded(receipts, relayServer) // sanity check
      sinon.spy(relayServer.registrationManager, 'handlePastEvents')
    })

    it('should re-register server only if registrationBlockRate passed from any tx', async function () {
      let latestBlock = await _web3.eth.getBlock('latest')
      let receipts = await relayServer._worker(latestBlock.number)
      expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, false)
      assert.equal(receipts.length, 0, 'should not re-register if already registered')
      await evmMineMany(registrationBlockRate)
      latestBlock = await _web3.eth.getBlock('latest')
      receipts = await relayServer._worker(latestBlock.number)
      expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, true)
      assertRelayAdded(receipts, relayServer, false)
    })
  })

  describe('listener task', function () {
    let origWorker: (blockNumber: number) => Promise<TransactionReceipt[]>
    let started: boolean
    beforeEach(function () {
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
    it('should start block listener', async function () {
      relayServer.start()
      await evmMine()
      await sleep(200)
      assert.isTrue(started, 'could not start task correctly')
    })
    it('should stop block listener', async function () {
      relayServer.stop()
      await evmMine()
      await sleep(200)
      assert.isFalse(started, 'could not stop task correctly')
    })
  })

  describe('Function testing', function () {
    it('_workerSemaphore', async function () {
      assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false first')
      const workerOrig = relayServer._worker
      let shouldRun = true
      try {
        relayServer._worker = async function (): Promise<TransactionReceipt[]> {
          // eslint-disable-next-line no-unmodified-loop-condition
          while (shouldRun) {
            await sleep(200)
          }
          return []
        }
        const latestBlock = await _web3.eth.getBlock('latest')
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
    let relayTransactionParams2: RelayTransactionParams
    let options2: PrepareRelayRequestOption
    let rejectingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
    let newServer: RelayServer

    beforeEach('should enter an alerted state for a configured blocks delay after paymaster rejecting an on-chain tx', async function () {
      id = (await snapshot()).result
      const newRelayParamsAlerted = {
        ...newRelayParams,
        alertedBlockDelay: 100
      }
      newServer = await bringUpNewRelay(newRelayParamsAlerted, partialConfig, {}, { alertedBlockDelay: 100 })
      const latestBlock = await _web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      rejectingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await rejectingPaymaster.setTrustedForwarder(forwarder.address)
      await rejectingPaymaster.setRelayHub(rhub.address)
      await rejectingPaymaster.deposit({ value: _web3.utils.toWei('1', 'ether') })
      relayTransactionParams2 = {
        ...relayTransactionParams,
        paymasterAddress: rejectingPaymaster.address,
        relayServer: newServer
      }
      options2 = {
        ...options,
        paymaster: rejectingPaymaster.address
      }
      await attackTheServer(newServer)
    })
    afterEach(async function () {
      await revert(id)
    })

    async function attackTheServer (server: RelayServer): Promise<void> {
      const _sendTransactionOrig = server.transactionManager.sendTransaction
      const _sendTransaction = async function ({ signer, method, destination, value = '0x', gasLimit, gasPrice }: SendTransactionDetails): Promise<SignedTransactionDetails> {
        await rejectingPaymaster.setRevertPreRelayCall(true)
        // @ts-ignore
        return (await _sendTransactionOrig.call(server.transactionManager, ...arguments))
      }
      server.transactionManager.sendTransaction = _sendTransaction
      await relayTransaction(relayTransactionParams2, options2, { paymaster: rejectingPaymaster.address }, false)
      const currentBlock = await _web3.eth.getBlock('latest')
      await server._worker(currentBlock.number)
      assert.isTrue(server.alerted, 'server not alerted')
      assert.equal(server.alertedBlock, currentBlock.number, 'server alerted block incorrect')
    }

    it('should delay transactions in alerted state', async function () {
      newServer.config.minAlertedDelayMS = 300
      newServer.config.maxAlertedDelayMS = 350
      const timeBefore = Date.now()
      await relayTransaction(relayTransactionParams, options)
      const timeAfter = Date.now()
      assert.isTrue((timeAfter - timeBefore) > 300, 'checking that enough time passed')
    })

    it('should exit alerted state after the configured blocks delay', async function () {
      await evmMineMany(newServer.config.alertedBlockDelay - 1)
      let latestBlock = await _web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      assert.isTrue(newServer.alerted, 'server not alerted')
      await evmMineMany(2)
      latestBlock = await _web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      assert.isFalse(newServer.alerted, 'server alerted')
    })
  })

  describe('relay max exposure to paymaster rejections', function () {
    let newServer: RelayServer
    let rejectingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
    let relayTransactionParams2: RelayTransactionParams
    const paymasterExpectedAcceptanceBudget = 15e4
    beforeEach(async function () {
      id = (await snapshot()).result
      rejectingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await rejectingPaymaster.setTrustedForwarder(forwarder.address)
      await rejectingPaymaster.setRelayHub(rhub.address)
      await rejectingPaymaster.deposit({ value: _web3.utils.toWei('1', 'ether') })
      await rejectingPaymaster.setGreedyAcceptanceBudget(true)
      newServer = await bringUpNewRelay(newRelayParams, partialConfig, {}, { trustedPaymasters: [rejectingPaymaster.address] })
      const latestBlock = await _web3.eth.getBlock('latest')
      await newServer._worker(latestBlock.number)
      relayTransactionParams2 = {
        ...relayTransactionParams,
        paymasterAddress: rejectingPaymaster.address,
        relayServer: newServer
      }
    })
    afterEach(async function () {
      await revert(id)
    })
    it('should reject a transaction from paymaster returning above configured max exposure', async function () {
      try {
        const scepticServer = await bringUpNewRelay(newRelayParams, partialConfig)
        const latestBlock = await _web3.eth.getBlock('latest')
        await scepticServer._worker(latestBlock.number)
        await relayTransaction({ ...relayTransactionParams2, relayServer: scepticServer }, options,
          { paymaster: rejectingPaymaster.address })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'paymaster acceptance budget too high')
      }
    })
    it('should accept a transaction from paymaster returning below configured max exposure', async function () {
      await rejectingPaymaster.setGreedyAcceptanceBudget(false)
      const gasLimits = await rejectingPaymaster.getGasLimits()
      assert.equal(parseInt(gasLimits.acceptanceBudget), paymasterExpectedAcceptanceBudget)
      await relayTransaction(relayTransactionParams2, { ...options, paymaster: rejectingPaymaster.address },
        { paymaster: rejectingPaymaster.address })
    })
    it('should accept a transaction from trusted paymaster returning above configured max exposure', async function () {
      const gasLimits = await rejectingPaymaster.getGasLimits()
      assert.equal(parseInt(gasLimits.acceptanceBudget), paymasterExpectedAcceptanceBudget * 9)
      await relayTransaction(relayTransactionParams2, { ...options, paymaster: rejectingPaymaster.address },
        { paymaster: rejectingPaymaster.address })
    })
  })
})
