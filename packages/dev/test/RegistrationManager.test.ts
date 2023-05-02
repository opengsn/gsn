import { HttpProvider } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import BN from 'bn.js'
import { toChecksumAddress } from 'ethereumjs-util'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

import {
  ContractInteractor,
  LoggerInterface,
  RelayCallGasLimitCalculationHelper,
  constants,
  defaultEnvironment,
  ether,
  toNumber
} from '@opengsn/common'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'
import { RegistrationManager } from '@opengsn/relay/dist/RegistrationManager'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { ServerAction } from '@opengsn/relay/dist/StoredTransaction'
import {
  ServerConfigParams,
  ServerDependencies,
  configureServer,
  serverDefaultConfiguration
} from '@opengsn/relay/dist/ServerConfigParams'
import { TxStoreManager } from '@opengsn/relay/dist/TxStoreManager'

import { deployHub, evmMine, evmMineMany, revert, setNextBlockTimestamp, snapshot } from './TestUtils'

import { LocalhostOne, ServerTestEnvironment } from './ServerTestEnvironment'
import { assertRelayAdded, getTemporaryWorkdirs, getTotalTxCosts, ServerWorkdirs } from './ServerTestUtils'
import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'
import { GasPriceFetcher } from '@opengsn/relay/dist/GasPriceFetcher'

import sinon from 'sinon'
import chai from 'chai'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import { expectEvent } from '@openzeppelin/test-helpers'
import { Web3MethodsBuilder } from '@opengsn/relay/dist/Web3MethodsBuilder'

const TestRelayHub = artifacts.require('TestRelayHub')
const TestToken = artifacts.require('TestToken')

const { oneEther } = constants

const { expect } = chai.use(chaiAsPromised)
chai.use(sinonChai)

const workerIndex = 0

const unstakeDelay = 15000

// @ts-ignore
const currentProviderHost = web3.currentProvider.host
const provider = new StaticJsonRpcProvider(currentProviderHost)

contract('RegistrationManager', function (accounts) {
  const relayOwner = accounts[4]
  const anotherRelayer = accounts[5]

  let env: ServerTestEnvironment
  let relayServer: RelayServer
  let id: string
  let serverWorkdirs: ServerWorkdirs

  before(async function () {
    serverWorkdirs = getTemporaryWorkdirs()
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init({}, { minimumUnstakeDelay: unstakeDelay }, undefined, TestRelayHub)
    env.newServerInstanceNoFunding({}, serverWorkdirs)
    await env.clearServerStorage()
    relayServer = env.relayServer
    await relayServer.init()
  })

  // When running server before staking/funding it, or when balance gets too low
  describe('multi-step server initialization', function () {
    // TODO: It does not make sense for the '_worker' method to expose the reason it does not register
    //       It could expose the types of transactions it has broadcast to simplify logging, testing & debugging.
    //       This means these 2 tests cannot check what they used to and require refactoring.
    it('should wait for balance before setting owner on the StakeManager', async function () {
      let latestBlock = await provider.getBlock('latest')
      let transactionHashes = await relayServer._worker(latestBlock)
      assert.equal(transactionHashes.length, 0)
      const expectedBalance = env.web3.utils.toWei('2', 'ether')
      let managerBalance = await relayServer.getManagerBalance()
      assert.notEqual(managerBalance.cmp(toBN(expectedBalance)), 0)
      await env.web3.eth.sendTransaction({
        to: relayServer.managerAddress,
        from: relayOwner,
        value: expectedBalance
      })
      latestBlock = await provider.getBlock('latest')
      managerBalance = await relayServer.getManagerBalance()
      assert.equal(managerBalance.cmp(toBN(expectedBalance)), 0, 'should have balance now')
      transactionHashes = await relayServer._worker(latestBlock)
      assert.equal(transactionHashes.length, 1, 'should only set owner 1')
      const tx = await web3.eth.getTransaction(transactionHashes[0])
      assert.equal(tx.to, env.stakeManager.address, 'should only set owner 2')
      assert.equal(tx.input.indexOf('0xfece3dd4'), 0, 'should only set owner 3')
      assert.equal(relayServer.isReady(), false, 'relay should not be ready yet')
      await evmMine()
    })

    it('should wait for stake, register and fund workers', async function () {
      let latestBlock = await provider.getBlock('latest')
      const transactionHashes = await relayServer._worker(latestBlock)
      assert.equal(transactionHashes.length, 0)
      assert.equal(relayServer.isReady(), false, 'relay should not be ready yet')
      await env.testToken.mint(oneEther, { from: relayOwner })
      await env.testToken.approve(env.stakeManager.address, oneEther, { from: relayOwner })
      const res = await env.stakeManager.stakeForRelayManager(env.testToken.address, relayServer.managerAddress, unstakeDelay, oneEther, {
        from: relayOwner
      })
      const res2 = await env.stakeManager.authorizeHubByOwner(relayServer.managerAddress, env.relayHub.address, { from: relayOwner })
      assert.ok(res.receipt.status, 'stake failed')
      assert.ok(res2.receipt.status, 'authorize hub failed')
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalanceBefore.toString(), '0')
      latestBlock = await provider.getBlock('latest')
      const receipts = await relayServer._worker(latestBlock)
      await evmMine()
      latestBlock = await provider.getBlock('latest')
      await relayServer._worker(latestBlock)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(relayServer.lastScannedBlock, latestBlock.number)
      assert.equal(relayServer.registrationManager.stakeRequired.currentValue.toString(), oneEther.toString())
      assert.equal(relayServer.registrationManager.ownerAddress, relayOwner)
      assert.equal(workerBalanceAfter.toString(), relayServer.config.workerTargetBalance.toString())
      assert.equal(relayServer.isReady(), true, 'relay not ready?')
      await assertRelayAdded(receipts, relayServer)
    })

    const maxPageSize = Number.MAX_SAFE_INTEGER
    let logger: LoggerInterface
    let managerKeyManager: KeyManager
    let txStoreManager: TxStoreManager
    let contractInteractor: ContractInteractor
    let params: Partial<ServerConfigParams>
    let serverDependencies: ServerDependencies

    it('should start again after restarting process', async () => {
      params = {
        relayHubAddress: env.relayHub.address,
        ownerAddress: env.relayOwner,
        url: LocalhostOne,
        gasPriceFactor: 1,
        runPaymasterReputations: false,
        checkInterval: 100
      }
      logger = createServerLogger('error', '', '')
      managerKeyManager = new KeyManager(1, serverWorkdirs.managerWorkdir)
      const workersKeyManager = new KeyManager(1, serverWorkdirs.workersWorkdir)
      txStoreManager = new TxStoreManager({ workdir: serverWorkdirs.workdir }, logger)
      contractInteractor = new ContractInteractor({
        environment: defaultEnvironment,
        provider: provider,
        logger,
        maxPageSize,
        deployment: {
          managerStakeTokenAddress: env.testToken.address,
          relayHubAddress: env.relayHub.address
        }
      })
      await contractInteractor.init()
      const gasLimitCalculator = new RelayCallGasLimitCalculationHelper(
        logger, contractInteractor, 1, serverDefaultConfiguration.maxAcceptanceBudget
      )
      const gasPriceFetcher = new GasPriceFetcher('', '', contractInteractor, logger)

      const resolvedDeployment = contractInteractor.getDeployment()
      const web3MethodsBuilder = new Web3MethodsBuilder(web3, resolvedDeployment)

      serverDependencies = {
        logger,
        txStoreManager,
        managerKeyManager,
        workersKeyManager,
        contractInteractor,
        gasLimitCalculator,
        web3MethodsBuilder,
        gasPriceFetcher
      }
      const transactionManager = new TransactionManager(serverDependencies, configureServer(params))
      const newRelayServer = new RelayServer(params, transactionManager, serverDependencies)
      await newRelayServer.init()
      const latestBlock = await provider.getBlock('latest')
      await newRelayServer._worker(latestBlock)
      assert.equal(relayServer.isReady(), true, 'relay not ready?')
    })

    it('should call authorizeHubByManager if configured RelayHub address changed after restart', async function () {
      const relayHubInstance = await deployHub(env.stakeManager.address, env.penalizer.address, constants.ZERO_ADDRESS, env.testToken.address, '1')
      const newContractInteractor = new ContractInteractor({
        environment: defaultEnvironment,
        provider,
        logger,
        maxPageSize,
        deployment: {
          managerStakeTokenAddress: env.testToken.address,
          relayHubAddress: relayHubInstance.address
        }
      })
      await newContractInteractor.init()
      // cannot reuse worker as it will rightfully revert on "this worker has a manager"
      const newWorkersKeyManager = new KeyManager(1)
      const newServerDependencies =
        Object.assign({}, serverDependencies, {
          workersKeyManager: newWorkersKeyManager,
          contractInteractor: newContractInteractor
        })
      const newParams = Object.assign({}, params, { relayHubAddress: relayHubInstance.address })
      const transactionManager = new TransactionManager(newServerDependencies, configureServer(newParams))
      const newRelayServer = new RelayServer(newParams, transactionManager, newServerDependencies)
      const sentTransactions = await newRelayServer.init()
      assert.equal(sentTransactions.length, 1)
      await expectEvent.inTransaction(sentTransactions[0], env.stakeManager, 'HubAuthorized', {
        relayManager: toChecksumAddress(newRelayServer.managerAddress),
        relayHub: toChecksumAddress(relayHubInstance.address)
      })
      // worker will not send registrations for 10 blocks and these tests don't create enough transactions
      await evmMineMany(11)
      let latestBlock = await provider.getBlock('latest')
      const registrationSentTransactions = await newRelayServer._worker(latestBlock)
      assert.equal(registrationSentTransactions.length, 2)
      await expectEvent.inTransaction(registrationSentTransactions[0], relayHubInstance, 'RelayWorkersAdded', {
        relayManager: toChecksumAddress(newRelayServer.managerAddress),
        newRelayWorkers: [toChecksumAddress(newWorkersKeyManager.getAddress(0))],
        workersCount: 1
      })
      // @ts-ignore
      await expectEvent.inTransaction(registrationSentTransactions[1], relayHubInstance._secretRegistrarInstance, 'RelayServerRegistered', {
        relayManager: toChecksumAddress(newRelayServer.managerAddress),
        relayHub: toChecksumAddress(relayHubInstance.address)
      })
      await evmMine()
      latestBlock = await provider.getBlock('latest')
      await newRelayServer._worker(latestBlock)
      assert.equal(newRelayServer.isReady(), true, 'relay not ready?')
    })
  })

  describe('configuration change', function () {
    let relayServer: RelayServer

    before(async function () {
      await env.newServerInstance({ refreshStateTimeoutBlocks: 1 }, undefined, unstakeDelay)
      relayServer = env.relayServer
    })

    // TODO: separate this into 4 unit tests for 'isRegistrationValid' and 1 test for 'handlePastEvents'
    it('should re-register server with new configuration', async function () {
      let latestBlock = await provider.getBlock('latest')
      // const receipts = await relayServer._worker(latestBlock.number)
      // await assertRelayAdded(receipts, relayServer)
      // await relayServer._worker(latestBlock.number + 1)

      const block = await provider.getBlock(0)
      let transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, block, toNumber(latestBlock.timestamp), false)
      assert.equal(transactionHashes.length, 0, 'should not re-register if already registered')

      block.number = 1000000

      relayServer.config.url = relayServer.config.url + '1'
      transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, block, toNumber(latestBlock.timestamp), false)
      await assertRelayAdded(transactionHashes, relayServer, false)

      latestBlock = await provider.getBlock('latest')
      await relayServer._worker(latestBlock)

      relayServer.config.url = relayServer.config.url + '1'
      transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, block, toNumber(latestBlock.timestamp), false)
      await assertRelayAdded(transactionHashes, relayServer, false)

      latestBlock = await provider.getBlock('latest')
      await relayServer._worker(latestBlock)

      relayServer.config.url = 'fakeUrl'
      transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, block, toNumber(latestBlock.timestamp), false)
      await assertRelayAdded(transactionHashes, relayServer, false)
    })
  })

  describe('event handlers', function () {
    describe('Withdrawn event', function () {
      async function assertSendBalancesToOwner (
        server: RelayServer,
        managerHubBalanceBefore: BN,
        managerBalanceBefore: BN,
        workerBalanceBefore: BN): Promise<void> {
        const gasPrice = await env.web3.eth.getGasPrice()
        const ownerBalanceBefore = toBN(await env.web3.eth.getBalance(server.registrationManager.ownerAddress!))
        assert.equal(server.registrationManager.stakeRequired.currentValue.toString(), oneEther.toString())
        // TODO: assert on withdrawal block?
        // assert.equal(server.config.withdrawBlock?.toString(), '0')
        const latestBlock = await provider.getBlock('latest')
        const receipts = await server._worker(latestBlock)
        const totalTxCosts: BN = await getTotalTxCosts(receipts, gasPrice)
        const ownerBalanceAfter = toBN(await env.web3.eth.getBalance(server.registrationManager.ownerAddress!))
        assert.equal(
          ownerBalanceAfter.sub(
            ownerBalanceBefore).toString(),
          managerHubBalanceBefore.add(managerBalanceBefore).add(workerBalanceBefore)
            .sub(totalTxCosts).toString(),
          `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) !=
         managerHubBalanceBefore(${managerHubBalanceBefore.toString()}) + managerBalanceBefore(${managerBalanceBefore.toString()}) + workerBalanceBefore(${workerBalanceBefore.toString()})
         - totalTxCosts(${totalTxCosts.toString()})`)
        const managerHubBalanceAfter = await env.relayHub.balanceOf(server.managerAddress)
        const managerBalanceAfter = await server.getManagerBalance()
        const workerBalanceAfter = await server.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceAfter.eqn(0))
        assert.isTrue(managerBalanceAfter.eqn(0))
        assert.isTrue(workerBalanceAfter.eqn(0))
        // TODO
        // assert.isTrue(server.withdrawBlock?.gtn(0))
      }

      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        await env.newServerInstance({ refreshStateTimeoutBlocks: 1 }, undefined, unstakeDelay)
        newServer = env.relayServer
        const latestBlock = await provider.getBlock('latest')
        await newServer._worker(latestBlock)

        await env.relayHub.depositFor(newServer.managerAddress, { value: 1e18.toString() })
        const { receipt } = await env.stakeManager.unlockStake(newServer.managerAddress, { from: relayOwner })
        const minedInBlock = await web3.eth.getBlock(receipt.blockNumber)
        const minedBlockTimestamp = toNumber(minedInBlock.timestamp)
        const removalTime = toBN(unstakeDelay).add(toBN(minedBlockTimestamp)).addn(1)
        await setNextBlockTimestamp(removalTime)
        await env.stakeManager.withdrawStake(newServer.managerAddress, { from: relayOwner })
      })

      afterEach(async function () {
        await revert(id)
      })

      it('send balances to owner when all balances > tx costs', async function () {
        const managerHubBalanceBefore = await env.relayHub.balanceOf(newServer.managerAddress)
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.gtn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        await assertSendBalancesToOwner(newServer, managerHubBalanceBefore, managerBalanceBefore, workerBalanceBefore)
      })

      it('send balances to owner when manager hub balance < tx cost ', async function () {
        const workerAddress = newServer.workerAddress
        const managerHubBalance = await env.relayHub.balanceOf(newServer.managerAddress)
        const method = env.relayHub.contract.methods.withdraw(workerAddress, toHex(managerHubBalance))
        await newServer.transactionManager.sendTransaction({
          signer: newServer.managerAddress,
          serverAction: ServerAction.DEPOSIT_WITHDRAWAL,
          destination: env.relayHub.address,
          creationBlockNumber: 0,
          creationBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          creationBlockTimestamp: 0,
          method
        })
        const managerHubBalanceBefore = await env.relayHub.balanceOf(newServer.managerAddress)
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.eqn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        await assertSendBalancesToOwner(newServer, managerHubBalanceBefore, managerBalanceBefore, workerBalanceBefore)
      })
    })

    describe('HubAuthorized event', function () {
      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        await env.newServerInstance({}, undefined, unstakeDelay)
        newServer = env.relayServer
      })

      afterEach(async function () {
        await revert(id)
      })

      it('set hubAuthorized', async function () {
        const latestBlock = await provider.getBlock('latest')
        await newServer._worker(latestBlock)
        assert.isTrue(newServer.registrationManager.isHubAuthorized, 'Hub should be authorized in server')
      })
    })

    describe('HubUnauthorized event', function () {
      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        await env.newServerInstance({ refreshStateTimeoutBlocks: 1 }, undefined, unstakeDelay)
        newServer = env.relayServer
        const latestBlock = await provider.getBlock('latest')
        await newServer._worker(latestBlock)
        await env.relayHub.depositFor(newServer.managerAddress, { value: 1e18.toString() })
      })

      afterEach(async function () {
        await revert(id)
      })

      it('should not send balance immediately after unauthorize (before unstake delay)', async function () {
        await env.stakeManager.unauthorizeHubByOwner(newServer.managerAddress, env.relayHub.address, { from: relayOwner })
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)

        let latestBlock = await provider.getBlock('latest')

        const receipt = await newServer._worker(latestBlock)
        await evmMine()
        latestBlock = await provider.getBlock('latest')
        const receipt2 = await newServer._worker(latestBlock)

        assert.equal(receipt.length, 0)
        assert.equal(receipt2.length, 0)
        assert.equal(workerBalanceBefore.toString(), await newServer.getWorkerBalance(workerIndex).then(b => b.toString()))
      })

      it('should ignore unauthorizeHub of another hub', async function () {
        await env.stakeManager.setRelayManagerOwner(env.relayOwner, { from: anotherRelayer })
        await env.stakeManager.stakeForRelayManager(env.testToken.address, anotherRelayer, 15000, 0, { from: env.relayOwner })
        await env.stakeManager.authorizeHubByManager(env.relayHub.address, { from: anotherRelayer })
        await env.stakeManager.unauthorizeHubByManager(env.relayHub.address, { from: anotherRelayer })
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)

        let latestBlock = await provider.getBlock('latest')
        const receipts = await newServer._worker(latestBlock)
        await evmMine()
        latestBlock = await provider.getBlock('latest')
        const receipts2 = await newServer._worker(latestBlock)

        const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
        assert.equal(receipts.length, 0)
        assert.equal(receipts2.length, 0)
        assert.equal(workerBalanceBefore.toString(), workerBalanceAfter.toString())
      })

      it('send only workers\' balances to owner (not manager hub,eth balance) - after unstake delay', async function () {
        const { receipt } = await env.stakeManager.unauthorizeHubByOwner(newServer.managerAddress, env.relayHub.address, { from: relayOwner })
        const minedInBlock = await web3.eth.getBlock(receipt.blockNumber)
        const minedBlockTimestamp = toNumber(minedInBlock.timestamp)
        const withdrawalTime = toBN(unstakeDelay).add(toBN(minedBlockTimestamp)).addn(1)

        const managerHubBalanceBefore = await env.relayHub.balanceOf(newServer.managerAddress)
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore: BN = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.gtn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        const ownerBalanceBefore = toBN(await env.web3.eth.getBalance(relayOwner))
        assert.isTrue(newServer.registrationManager.isHubAuthorized, 'Hub should be authorized in server')

        await setNextBlockTimestamp(withdrawalTime)
        await evmMine()
        const latestBlock = await provider.getBlock('latest')
        const receipts = await newServer._worker(latestBlock)
        assert.isFalse(newServer.registrationManager.isHubAuthorized, 'Hub should not be authorized in server')
        const gasPrice = await env.web3.eth.getGasPrice()
        assert.equal(receipts.length, 2)
        // TODO: these two hard-coded indexes are dependent on the order of operations in 'withdrawAllFunds'
        const workerEthTxCost: BN = await getTotalTxCosts([receipts[1]], gasPrice)
        const managerHubSendTxCost = await getTotalTxCosts([receipts[0]], gasPrice)
        const ownerBalanceAfter = toBN(await env.web3.eth.getBalance(relayOwner))
        const managerHubBalanceAfter = await env.relayHub.balanceOf(newServer.managerAddress)
        const managerBalanceAfter = await newServer.getManagerBalance()
        const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceAfter.eqn(0))
        assert.isTrue(workerBalanceAfter.eqn(0))
        assert.equal(managerBalanceAfter.toString(), managerBalanceBefore.sub(managerHubSendTxCost).toString())
        assert.equal(
          ownerBalanceAfter.sub(
            ownerBalanceBefore).toString(),
          managerHubBalanceBefore.add(workerBalanceBefore).sub(workerEthTxCost).toString(),
          `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) !=
         managerHubBalanceBefore(${managerHubBalanceBefore.toString()}) + workerBalanceBefore(${workerBalanceBefore.toString()})
         - workerEthTxCost(${workerEthTxCost.toString()})`)
      })
    })

    it('_handleStakedEvent')
  })

  describe('#_extractDuePendingEvents', () => {
    let rm: RegistrationManager
    let extracted: any[]

    before(async () => {
      if (!relayServer.initialized) {
        await relayServer.init()
      }

      rm = relayServer.registrationManager;

      (rm as any).delayedEvents = [
        { time: 1, eventData: 'event1' },
        { time: 2, eventData: 'event2' },
        { time: 3, eventData: 'event3' }
      ]
      extracted = rm._extractDuePendingEvents(2) as any
    })
    it('should extract events which are due (lower or equal block number)', function () {
      assert.deepEqual(extracted, ['event1', 'event2'])
    })

    it('should leave future events in the delayedEvents list', function () {
      assert.deepEqual((rm as any).delayedEvents, [{ time: 3, eventData: 'event3' }])
    })
  })

  describe('#attemptRegistration()', function () {
    let newServer: RelayServer

    describe('without re-registration', function () {
      beforeEach(async function () {
        id = (await snapshot()).result
        // await env.newServerInstance({}, undefined, unstakeDelay)
        env.newServerInstanceNoFunding({})
        await env.relayServer.init()
        newServer = env.relayServer
        await env.fundServer()
        const latestBlock = await provider.getBlock('latest')
        await newServer._worker(latestBlock)
        // stake and authorize after '_worker' - so the relay only sets owner
        await env.stakeAndAuthorizeHub(ether('1'), unstakeDelay)
        // TODO: this is horrible!!!
        newServer.registrationManager.isStakeLocked = true
        newServer.registrationManager.isHubAuthorized = true
        newServer.registrationManager.stakeRequired.requiredValue = toBN(0)
        newServer.registrationManager.balanceRequired.requiredValue = toBN(0)
        await newServer.registrationManager.refreshStake(latestBlock.number, latestBlock.hash, toNumber(latestBlock.timestamp))
        assert.equal(newServer.registrationManager.stakeRequired.currentValue.toString(), oneEther.toString())
        assert.equal(newServer.registrationManager.ownerAddress, relayOwner, 'owner should be set after refreshing stake')
      })

      afterEach(async function () {
        await revert(id)
      })

      it('should register server and add workers', async function () {
        let allStoredTransactions = await newServer.txStoreManager.getAll()
        assert.equal(allStoredTransactions.length, 1)
        assert.equal(allStoredTransactions[0].serverAction, ServerAction.SET_OWNER)
        const receipts = await newServer.registrationManager.attemptRegistration(0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
        await assertRelayAdded(receipts, newServer)
        allStoredTransactions = await newServer.txStoreManager.getAll()
        assert.equal(allStoredTransactions.length, 3)
        assert.equal(allStoredTransactions[0].serverAction, ServerAction.SET_OWNER)
        assert.equal(allStoredTransactions[1].serverAction, ServerAction.ADD_WORKER)
        assert.equal(allStoredTransactions[2].serverAction, ServerAction.REGISTER_SERVER)
      })
    })

    describe('RelayHub/StakeManager misconfiguration', function () {
      const errorMessage1 = 'Relay manager is staked on StakeManager but not on RelayHub.'
      const errorMessage2 = 'Minimum stake/minimum unstake delay/stake token misconfigured?'
      let latestBlock: any
      beforeEach(async function () {
        id = (await snapshot()).result
        // await env.newServerInstance({}, undefined, unstakeDelay)
        env.newServerInstanceNoFunding({})
        await env.relayServer.init()
        newServer = env.relayServer
        sinon.spy(newServer.logger, 'error')
        await env.fundServer()
        latestBlock = await env.web3.eth.getBlock('latest')
        await newServer._worker(latestBlock)
        newServer.registrationManager.isStakeLocked = true
        newServer.registrationManager.isHubAuthorized = true
        newServer.registrationManager.stakeRequired.requiredValue = toBN(0)
        newServer.registrationManager.balanceRequired.requiredValue = toBN(0)
      })

      afterEach(async function () {
        await revert(id)
      })

      it('should not attempt registration if unstake delay is too low on hub', async function () {
        await env.stakeAndAuthorizeHub(ether('1'), unstakeDelay - 1)
        await newServer.registrationManager.refreshStake(latestBlock.number, latestBlock.hash, toNumber(latestBlock.timestamp))
        const receipts = await newServer.registrationManager.attemptRegistration(0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
        assert.equal(receipts.length, 0)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage1)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage2)
      })

      it('should not attempt registration if stake amount is too low on hub', async function () {
        await env.stakeAndAuthorizeHub(ether('0.1'), unstakeDelay)
        await newServer.registrationManager.refreshStake(latestBlock.number, latestBlock.hash, toNumber(latestBlock.timestamp))
        const receipts = await newServer.registrationManager.attemptRegistration(0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
        assert.equal(receipts.length, 0)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage1)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage2)
      })

      it('should not attempt registration if incorrect token is staked on hub', async function () {
        const wrongToken = await TestToken.new()
        const stake = ether('10')
        await wrongToken.mint(stake, { from: env.relayOwner })
        await wrongToken.approve(env.stakeManager.address, stake, { from: env.relayOwner })
        await env.stakeManager.stakeForRelayManager(wrongToken.address, env.relayServer.managerAddress, unstakeDelay, stake, {
          from: env.relayOwner
        })
        await env.stakeManager.authorizeHubByOwner(env.relayServer.managerAddress, env.relayHub.address, {
          from: env.relayOwner
        })
        await newServer.registrationManager.refreshStake(latestBlock.number, latestBlock.hash, toNumber(latestBlock.timestamp))
        const receipts = await newServer.registrationManager.attemptRegistration(0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
        assert.equal(receipts.length, 0)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage1)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage2)
      })

      it('should not attempt registration incorrect token is staked on hub', async function () {})
    })
  })

  // note: relies on first 'before' to initialize server
  describe('#assertRegistered()', function () {
    before(function () {
      relayServer.registrationManager.stakeRequired._requiredValue = toBN(1e20)
    })

    it('should return false if the stake requirement is not satisfied', async function () {
      const isRegistered = await relayServer.registrationManager.isRegistered()
      assert.isFalse(isRegistered)
    })
  })
})
