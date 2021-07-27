import Web3 from 'web3'
import { HttpProvider } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import BN from 'bn.js'

import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'
import { RegistrationManager } from '@opengsn/relay/dist/RegistrationManager'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { ServerAction } from '@opengsn/relay/dist/StoredTransaction'
import { configureServer, ServerConfigParams, ServerDependencies } from '@opengsn/relay/dist/ServerConfigParams'
import { TxStoreManager } from '@opengsn/relay/dist/TxStoreManager'
import { constants } from '@opengsn/common/dist/Constants'

import { evmMine, evmMineMany, revert, snapshot } from './TestUtils'

import { LocalhostOne, ServerTestEnvironment } from './ServerTestEnvironment'
import { assertRelayAdded, getTemporaryWorkdirs, getTotalTxCosts, ServerWorkdirs } from './ServerTestUtils'
import { createServerLogger } from '@opengsn/relay/dist/ServerWinstonLogger'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'
import { GasPriceFetcher } from '@opengsn/relay/dist/GasPriceFetcher'
import { ether } from '@opengsn/common/dist'
import sinon from 'sinon'
import chai from 'chai'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'

const { oneEther } = constants

const { expect } = chai.use(chaiAsPromised)
chai.use(sinonChai)

const workerIndex = 0

const unstakeDelay = 50
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
    await env.init({}, { minimumUnstakeDelay: unstakeDelay })
    env.newServerInstanceNoFunding({}, serverWorkdirs)
    await env.clearServerStorage()
    relayServer = env.relayServer
  })

  // When running server before staking/funding it, or when balance gets too low
  describe('multi-step server initialization', function () {
    // TODO: It does not make sense for the '_worker' method to expose the reason it does not register
    //       It could expose the types of transactions it has broadcast to simplify logging, testing & debugging.
    //       This means these 2 tests cannot check what they used to and require refactoring.
    it('should wait for balance before setting owner on the StakeManager', async function () {
      let latestBlock = await env.web3.eth.getBlock('latest')
      let transactionHashes = await relayServer._worker(latestBlock.number)
      assert.equal(transactionHashes.length, 0)
      const expectedBalance = env.web3.utils.toWei('2', 'ether')
      let managerBalance = await relayServer.getManagerBalance()
      assert.notEqual(managerBalance.cmp(toBN(expectedBalance)), 0)
      await env.web3.eth.sendTransaction({
        to: relayServer.managerAddress,
        from: relayOwner,
        value: expectedBalance
      })
      latestBlock = await env.web3.eth.getBlock('latest')
      managerBalance = await relayServer.getManagerBalance()
      assert.equal(managerBalance.cmp(toBN(expectedBalance)), 0, 'should have balance now')
      transactionHashes = await relayServer._worker(latestBlock.number)
      assert.equal(transactionHashes.length, 1, 'should only set owner')
      const tx = await web3.eth.getTransaction(transactionHashes[0])
      assert.equal(tx.to, env.stakeManager.address, 'should only set owner')
      assert.equal(tx.input.indexOf('0xfece3dd4'), 0, 'should only set owner')
      assert.equal(relayServer.isReady(), false, 'relay should not be ready yet')
      await evmMine()
    })

    it('should wait for stake, register and fund workers', async function () {
      let latestBlock = await env.web3.eth.getBlock('latest')
      const transactionHashes = await relayServer._worker(latestBlock.number)
      assert.equal(transactionHashes.length, 0)
      assert.equal(relayServer.isReady(), false, 'relay should not be ready yet')
      const res = await env.stakeManager.stakeForRelayManager(relayServer.managerAddress, unstakeDelay, {
        from: relayOwner,
        value: oneEther
      })
      const res2 = await env.stakeManager.authorizeHubByOwner(relayServer.managerAddress, env.relayHub.address, { from: relayOwner })
      assert.ok(res.receipt.status, 'stake failed')
      assert.ok(res2.receipt.status, 'authorize hub failed')
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalanceBefore.toString(), '0')
      latestBlock = await env.web3.eth.getBlock('latest')
      const receipts = await relayServer._worker(latestBlock.number)
      await relayServer._worker(latestBlock.number + 1)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(relayServer.lastScannedBlock, latestBlock.number + 1)
      assert.deepEqual(relayServer.registrationManager.stakeRequired.currentValue, oneEther)
      assert.equal(relayServer.registrationManager.ownerAddress, relayOwner)
      assert.equal(workerBalanceAfter.toString(), relayServer.config.workerTargetBalance.toString())
      assert.equal(relayServer.isReady(), true, 'relay not ready?')
      await assertRelayAdded(receipts, relayServer)
    })

    it('should start again after restarting process', async () => {
      const params: Partial<ServerConfigParams> = {
        relayHubAddress: env.relayHub.address,
        ownerAddress: env.relayOwner,
        url: LocalhostOne,
        baseRelayFee: '0',
        pctRelayFee: 0,
        gasPriceFactor: 1,
        runPaymasterReputations: false,
        checkInterval: 100
      }
      const logger = createServerLogger('error', '', '')
      const managerKeyManager = new KeyManager(1, serverWorkdirs.managerWorkdir)
      const workersKeyManager = new KeyManager(1, serverWorkdirs.workersWorkdir)
      const txStoreManager = new TxStoreManager({ workdir: serverWorkdirs.workdir }, logger)
      const serverWeb3provider = new Web3.providers.HttpProvider((web3.currentProvider as HttpProvider).host)
      const maxPageSize = Number.MAX_SAFE_INTEGER
      const contractInteractor = new ContractInteractor({
        provider: serverWeb3provider,
        logger,
        maxPageSize,
        deployment: { paymasterAddress: env.paymaster.address }
      })
      await contractInteractor.init()
      const gasPriceFetcher = new GasPriceFetcher('', '', contractInteractor, logger)

      const serverDependencies: ServerDependencies = {
        logger,
        txStoreManager,
        managerKeyManager,
        workersKeyManager,
        contractInteractor,
        gasPriceFetcher
      }
      const transactionManager = new TransactionManager(serverDependencies, configureServer(params))
      const newRelayServer = new RelayServer(params, transactionManager, serverDependencies)
      await newRelayServer.init()
      const latestBlock = await env.web3.eth.getBlock('latest')
      await newRelayServer._worker(latestBlock.number)
      assert.equal(relayServer.isReady(), true, 'relay not ready?')
    })
  })

  // When running server after both staking & funding it
  // Skipping this test: there is no way after OG-401 to stake for server without it running & calling 'setOwner'
  // There is no point in artificially simulating this situation IMO
  describe.skip('single step server initialization', function () {
    beforeEach(async function () {
      id = (await snapshot()).result
    })

    afterEach(async function () {
      await revert(id)
    })

    let newServer: RelayServer
    it('should initialize relay after staking and funding it', async function () {
      await env.newServerInstance({}, undefined, unstakeDelay)
      newServer = env.relayServer
      await newServer.init()
      assert.equal(newServer.registrationManager.ownerAddress, undefined)
      await newServer.registrationManager.refreshStake()
      assert.deepEqual(newServer.registrationManager.stakeRequired.currentValue, oneEther)
      assert.equal(newServer.registrationManager.ownerAddress, relayOwner, 'owner should be set after refreshing stake')

      const expectedGasPrice = parseInt(await env.web3.eth.getGasPrice()) * newServer.config.gasPriceFactor
      assert.equal(newServer.isReady(), false)
      assert.equal(newServer.lastScannedBlock, 0)
      const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalanceBefore.toString(), '0')
      const latestBlock = await env.web3.eth.getBlock('latest')
      const receipts = await newServer._worker(latestBlock.number)
      await newServer._worker(latestBlock.number + 1)
      assert.equal(newServer.lastScannedBlock, latestBlock.number + 1)
      assert.equal(newServer.minGasPrice, expectedGasPrice)
      assert.equal(newServer.isReady(), true, 'relay no ready?')
      const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
      assert.deepEqual(newServer.registrationManager.stakeRequired.currentValue, oneEther)
      assert.equal(newServer.registrationManager.ownerAddress, relayOwner)
      assert.equal(workerBalanceAfter.toString(), newServer.config.workerTargetBalance.toString())
      await assertRelayAdded(receipts, newServer)
    })

    after('txstore cleanup', async function () {
      await newServer.transactionManager.txStoreManager.clearAll()
      assert.deepEqual([], await newServer.transactionManager.txStoreManager.getAll())
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
      let latestBlock = await env.web3.eth.getBlock('latest')
      // const receipts = await relayServer._worker(latestBlock.number)
      // await assertRelayAdded(receipts, relayServer)
      // await relayServer._worker(latestBlock.number + 1)

      let transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, 0, false)
      assert.equal(transactionHashes.length, 0, 'should not re-register if already registered')

      relayServer.config.baseRelayFee = (parseInt(relayServer.config.baseRelayFee) + 1).toString()
      transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, 0, false)
      await assertRelayAdded(transactionHashes, relayServer, false)

      latestBlock = await env.web3.eth.getBlock('latest')
      await relayServer._worker(latestBlock.number)

      relayServer.config.pctRelayFee++
      transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, 0, false)
      await assertRelayAdded(transactionHashes, relayServer, false)

      latestBlock = await env.web3.eth.getBlock('latest')
      await relayServer._worker(latestBlock.number)

      relayServer.config.url = 'fakeUrl'
      transactionHashes = await relayServer.registrationManager.handlePastEvents([], latestBlock.number, 0, false)
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
        const latestBlock = await env.web3.eth.getBlock('latest')
        const receipts = await server._worker(latestBlock.number)
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
        const latestBlock = await env.web3.eth.getBlock('latest')
        await newServer._worker(latestBlock.number)
        await newServer._worker(latestBlock.number + 1)

        await env.relayHub.depositFor(newServer.managerAddress, { value: 1e18.toString() })
        await env.stakeManager.unlockStake(newServer.managerAddress, { from: relayOwner })
        await evmMineMany(unstakeDelay)
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
        const method = env.relayHub.contract.methods.withdraw(toHex(managerHubBalance), workerAddress)
        const gasLimit = await newServer.transactionManager.attemptEstimateGas('Withdraw', method, newServer.managerAddress)
        await newServer.transactionManager.sendTransaction({
          signer: newServer.managerAddress,
          serverAction: ServerAction.DEPOSIT_WITHDRAWAL,
          destination: env.relayHub.address,
          creationBlockNumber: 0,
          gasLimit,
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
        const latestBlock = await env.web3.eth.getBlock('latest')
        await newServer._worker(latestBlock.number)
        assert.isTrue(newServer.registrationManager.isHubAuthorized, 'Hub should be authorized in server')
      })
    })

    describe('HubUnauthorized event', function () {
      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        await env.newServerInstance({ refreshStateTimeoutBlocks: 1 }, undefined, unstakeDelay)
        newServer = env.relayServer
        const latestBlock = await env.web3.eth.getBlock('latest')
        await newServer._worker(latestBlock.number)
        await newServer._worker(latestBlock.number + 1)
        await env.relayHub.depositFor(newServer.managerAddress, { value: 1e18.toString() })
      })

      afterEach(async function () {
        await revert(id)
      })

      it('should not send balance immediately after unauthorize (before unstake delay)', async function () {
        await env.stakeManager.unauthorizeHubByOwner(newServer.managerAddress, env.relayHub.address, { from: relayOwner })
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)

        await evmMineMany(unstakeDelay - 3)
        const latestBlock = await env.web3.eth.getBlock('latest')

        const receipt = await newServer._worker(latestBlock.number)
        const receipt2 = await newServer._worker(latestBlock.number + 1)

        assert.equal(receipt.length, 0)
        assert.equal(receipt2.length, 0)
        assert.equal(workerBalanceBefore.toString(), await newServer.getWorkerBalance(workerIndex).then(b => b.toString()))
      })

      it('should ignore unauthorizeHub of another hub', async function () {
        await env.stakeManager.setRelayManagerOwner(env.relayOwner, { from: anotherRelayer })
        await env.stakeManager.stakeForRelayManager(anotherRelayer, 1000, { from: env.relayOwner })
        await env.stakeManager.authorizeHubByManager(env.relayHub.address, { from: anotherRelayer })
        await env.stakeManager.unauthorizeHubByManager(env.relayHub.address, { from: anotherRelayer })
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)

        await evmMineMany(unstakeDelay)
        const latestBlock = await env.web3.eth.getBlock('latest')
        const receipts = await newServer._worker(latestBlock.number)
        const receipts2 = await newServer._worker(latestBlock.number + 1)

        const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
        assert.equal(receipts.length, 0)
        assert.equal(receipts2.length, 0)
        assert.equal(workerBalanceBefore.toString(), workerBalanceAfter.toString())
      })

      it('send only workers\' balances to owner (not manager hub,eth balance) - after unstake delay', async function () {
        await env.stakeManager.unauthorizeHubByOwner(newServer.managerAddress, env.relayHub.address, { from: relayOwner })

        const managerHubBalanceBefore = await env.relayHub.balanceOf(newServer.managerAddress)
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore: BN = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.gtn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        const ownerBalanceBefore = toBN(await env.web3.eth.getBalance(relayOwner))
        assert.isTrue(newServer.registrationManager.isHubAuthorized, 'Hub should be authorized in server')
        await evmMineMany(unstakeDelay)
        const latestBlock = await env.web3.eth.getBlock('latest')
        const receipts = await newServer._worker(latestBlock.number)
        assert.isFalse(newServer.registrationManager.isHubAuthorized, 'Hub should not be authorized in server')
        const gasPrice = await env.web3.eth.getGasPrice()
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
        { block: 1, eventData: 'event1' },
        { block: 2, eventData: 'event2' },
        { block: 3, eventData: 'event3' }
      ]
      extracted = rm._extractDuePendingEvents(2) as any
    })
    it('should extract events which are due (lower or equal block number)', function () {
      assert.deepEqual(extracted, ['event1', 'event2'])
    })

    it('should leave future events in the delayedEvents list', function () {
      assert.deepEqual((rm as any).delayedEvents, [{ block: 3, eventData: 'event3' }])
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
        const latestBlock = await env.web3.eth.getBlock('latest')
        await newServer._worker(latestBlock.number)
        // stake and authorize after '_worker' - so the relay only sets owner
        await env.stakeAndAuthorizeHub(ether('1'), unstakeDelay)
        // TODO: this is horrible!!!
        newServer.registrationManager.isStakeLocked = true
        newServer.registrationManager.isHubAuthorized = true
        newServer.registrationManager.stakeRequired.requiredValue = toBN(0)
        newServer.registrationManager.balanceRequired.requiredValue = toBN(0)
        await newServer.registrationManager.refreshStake()
        assert.deepEqual(newServer.registrationManager.stakeRequired.currentValue, oneEther)
        assert.equal(newServer.registrationManager.ownerAddress, relayOwner, 'owner should be set after refreshing stake')
        assert.equal(newServer.config.registrationBlockRate, 0)
      })

      afterEach(async function () {
        await revert(id)
      })

      it('should register server and add workers', async function () {
        let allStoredTransactions = await newServer.txStoreManager.getAll()
        assert.equal(allStoredTransactions.length, 1)
        assert.equal(allStoredTransactions[0].serverAction, ServerAction.SET_OWNER)
        const receipts = await newServer.registrationManager.attemptRegistration(0)
        await assertRelayAdded(receipts, newServer)
        allStoredTransactions = await newServer.txStoreManager.getAll()
        assert.equal(allStoredTransactions.length, 3)
        assert.equal(allStoredTransactions[0].serverAction, ServerAction.SET_OWNER)
        assert.equal(allStoredTransactions[1].serverAction, ServerAction.ADD_WORKER)
        assert.equal(allStoredTransactions[2].serverAction, ServerAction.REGISTER_SERVER)
      })
    })
    describe('RelayHub/StakeManager misconfiguration', function () {
      const errorMessage = 'Relay manager is staked on StakeManager but not on RelayHub.\n' +
        'Minimum stake/minimum unstake delay misconfigured?'
      beforeEach(async function () {
        id = (await snapshot()).result
        // await env.newServerInstance({}, undefined, unstakeDelay)
        env.newServerInstanceNoFunding({})
        await env.relayServer.init()
        newServer = env.relayServer
        sinon.spy(newServer.logger, 'error')
        await env.fundServer()
        const latestBlock = await env.web3.eth.getBlock('latest')
        await newServer._worker(latestBlock.number)
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
        await newServer.registrationManager.refreshStake()
        const receipts = await newServer.registrationManager.attemptRegistration(0)
        assert.equal(receipts.length, 0)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage)
      })

      it('should not attempt registration if stake amount is too low on hub', async function () {
        await env.stakeAndAuthorizeHub(ether('0.1'), unstakeDelay)
        await newServer.registrationManager.refreshStake()
        const receipts = await newServer.registrationManager.attemptRegistration(0)
        assert.equal(receipts.length, 0)
        expect(newServer.logger.error).to.have.been.calledWith(errorMessage)
      })
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
