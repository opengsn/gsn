import Web3 from 'web3'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sinonChai from 'sinon-chai'
import { HttpProvider } from 'web3-core'
import { toBN, toHex } from 'web3-utils'

import { KeyManager } from '../../src/relayserver/KeyManager'
import { TxStoreManager } from '../../src/relayserver/TxStoreManager'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { deployHub, revert, snapshot } from '../TestUtils'
import { IRelayHubInstance, IStakeManagerInstance } from '../../types/truffle-contracts'
import { constants } from '../../src/common/Constants'
import {
  assertRelayAdded,
  bringUpNewRelay,
  clearStorage,
  getTotalTxCosts,
  NewRelayParams,
  getTemporaryWorkdirs, ServerTestConstants, LocalhostOne
} from './ServerTestUtils'
import { ServerConfigParams, ServerDependencies } from '../../src/relayserver/ServerConfigParams'

const { expect } = chai.use(chaiAsPromised).use(sinonChai)
const { oneEther, weekInSec } = constants

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')

const workerIndex = 0

contract('RegistrationManager', function (accounts) {
  const relayOwner = accounts[1]

  let relayServer: RelayServer
  let rhub: IRelayHubInstance
  let stakeManager: IStakeManagerInstance
  let _web3: Web3
  let id: string
  let newRelayParams: NewRelayParams
  let serverTestConstants: ServerTestConstants
  let partialConfig: Partial<GSNConfig>

  // TODO: move to the 'before'
  const ethereumNodeUrl = (web3.currentProvider as HttpProvider).host

  before(async function () {
    const ethereumNodeUrl = (web3.currentProvider as HttpProvider).host
    _web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))
    stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    rhub = await deployHub(stakeManager.address, penalizer.address)
    serverTestConstants = getTemporaryWorkdirs()
    partialConfig = {
      relayHubAddress: rhub.address,
      stakeManagerAddress: stakeManager.address
    }
    newRelayParams = {
      alertedBlockDelay: 0,
      ethereumNodeUrl,
      relayHubAddress: rhub.address,
      relayOwner,
      url: LocalhostOne,
      web3,
      stakeManager
    }
    const managerKeyManager = new KeyManager(1, serverTestConstants.managerWorkdir)
    const workersKeyManager = new KeyManager(1, serverTestConstants.workersWorkdir)
    const txStoreManager = new TxStoreManager({ inMemory: true })
    const serverWeb3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
    const contractInteractor = new ContractInteractor(serverWeb3provider,
      configureGSN({
        relayHubAddress: rhub.address,
        stakeManagerAddress: stakeManager.address
      }))
    await contractInteractor.init()
    const serverDependencies: ServerDependencies = {
      txStoreManager,
      managerKeyManager,
      workersKeyManager,
      contractInteractor
    }
    const params: Partial<ServerConfigParams> = {
      relayHubAddress: rhub.address,
      url: LocalhostOne,
      baseRelayFee: '0',
      pctRelayFee: 0,
      gasPriceFactor: 1,
      devMode: true
    }
    relayServer = new RelayServer(params, serverDependencies)
    await relayServer.init()
    await clearStorage(relayServer.transactionManager.txStoreManager)
  })

  // When running server before staking/funding it, or when balance gets too low
  describe('multi-step server initialization', function () {
    it('should wait for balance', async function () {
      let latestBlock = await _web3.eth.getBlock('latest')
      await expect(
        relayServer._worker(latestBlock.number)
      ).to.be.eventually.rejectedWith('Balance too low - actual:')
      const expectedBalance = _web3.utils.toWei('2', 'ether')
      assert.notEqual((await relayServer.getManagerBalance()).cmp(toBN(expectedBalance)), 0)
      await _web3.eth.sendTransaction({
        to: relayServer.managerAddress,
        from: relayOwner,
        value: expectedBalance
      })
      latestBlock = await _web3.eth.getBlock('latest')
      await expect(
        relayServer._worker(latestBlock.number)
      ).to.be.eventually.rejectedWith('Stake too low - actual:')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
      assert.equal((await relayServer.getManagerBalance()).cmp(toBN(expectedBalance)), 0)
    })

    it('should wait for stake, register and fund workers', async function () {
      let latestBlock = await _web3.eth.getBlock('latest')
      await expect(
        relayServer._worker(latestBlock.number)
      ).to.be.eventually.rejectedWith('Stake too low - actual:')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
      const res = await stakeManager.stakeForAddress(relayServer.managerAddress, weekInSec, {
        from: relayOwner,
        value: oneEther
      })
      const res2 = await stakeManager.authorizeHubByOwner(relayServer.managerAddress, rhub.address, { from: relayOwner })
      assert.ok(res.receipt.status, 'stake failed')
      assert.ok(res2.receipt.status, 'authorize hub failed')
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalanceBefore.toString(), '0')
      latestBlock = await _web3.eth.getBlock('latest')
      const receipts = await relayServer._worker(latestBlock.number)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(relayServer.lastError, null)
      assert.equal(relayServer.lastScannedBlock, latestBlock.number)
      assert.deepEqual(relayServer.registrationManager.stakeRequired.currentValue, oneEther)
      assert.equal(relayServer.registrationManager.ownerAddress, relayOwner)
      assert.equal(workerBalanceAfter.toString(), relayServer.config.workerTargetBalance.toString())
      assert.equal(relayServer.ready, true, 'relay not ready?')
      await assertRelayAdded(receipts, relayServer)
    })

    it('should start again after restarting process', async () => {
      const managerKeyManager = new KeyManager(1, serverTestConstants.managerWorkdir)
      const workersKeyManager = new KeyManager(1, serverTestConstants.workersWorkdir)
      const txStoreManager = new TxStoreManager({ workdir: serverTestConstants.workdir })
      const serverWeb3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
      const contractInteractor = new ContractInteractor(serverWeb3provider,
        configureGSN({
          relayHubAddress: rhub.address,
          stakeManagerAddress: stakeManager.address
        }))
      await contractInteractor.init()
      const serverDependencies: ServerDependencies = {
        txStoreManager,
        managerKeyManager,
        workersKeyManager,
        contractInteractor
      }
      const params: Partial<ServerConfigParams> = {
        relayHubAddress: rhub.address,
        url: LocalhostOne,
        baseRelayFee: '0',
        pctRelayFee: 0,
        gasPriceFactor: 1,
        devMode: true
      }
      const newRelayServer = new RelayServer(params, serverDependencies)
      await newRelayServer.init()
      const latestBlock = await _web3.eth.getBlock('latest')
      await newRelayServer._worker(latestBlock.number)
      assert.equal(relayServer.ready, true, 'relay not ready?')
    })
  })

  // When running server after both staking & funding it
  describe('single step server initialization', function () {
    beforeEach(async function () {
      id = (await snapshot()).result
    })
    afterEach(async function () {
      await revert(id)
    })
    let newServer: RelayServer
    it('should initialize relay after staking and funding it', async function () {
      const partialConfig: Partial<GSNConfig> = {
        relayHubAddress: rhub.address,
        stakeManagerAddress: stakeManager.address
      }
      newServer = await bringUpNewRelay(newRelayParams, partialConfig)
      await newServer.registrationManager.refreshStake()
      assert.deepEqual(newServer.registrationManager.stakeRequired.currentValue, oneEther)
      assert.equal(newServer.registrationManager.ownerAddress, relayOwner, 'owner should be set after refreshing stake')

      const expectedGasPrice = parseInt(await _web3.eth.getGasPrice()) * newServer.config.gasPriceFactor
      assert.equal(newServer.ready, false)
      const expectedLastScannedBlock = await _web3.eth.getBlockNumber()
      assert.equal(newServer.lastScannedBlock, 0)
      const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalanceBefore.toString(), '0')
      const latestBlock = await _web3.eth.getBlock('latest')
      const receipts = await newServer._worker(latestBlock.number)
      assert.equal(newServer.lastScannedBlock, expectedLastScannedBlock)
      assert.equal(newServer.gasPrice, expectedGasPrice)
      assert.equal(newServer.ready, true, 'relay no ready?')
      const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
      assert.equal(newServer.lastError, null)
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
      relayServer = await bringUpNewRelay(newRelayParams, partialConfig)
    })

    it('should re-register server with new configuration', async function () {
      const latestBlock = await _web3.eth.getBlock('latest')
      const receipts = await relayServer._worker(latestBlock.number)
      assertRelayAdded(receipts, relayServer)

      let pastEventsResult = await relayServer.registrationManager.handlePastEvents(latestBlock.number, false)
      assert.equal(pastEventsResult.receipts.length, 0, 'should not re-register if already registered')

      relayServer.config.baseRelayFee = (parseInt(relayServer.config.baseRelayFee) + 1).toString()
      pastEventsResult = await relayServer.registrationManager.handlePastEvents(latestBlock.number, false)
      assertRelayAdded(pastEventsResult.receipts, relayServer, false)

      relayServer.config.pctRelayFee++
      pastEventsResult = await relayServer.registrationManager.handlePastEvents(latestBlock.number, false)
      assertRelayAdded(pastEventsResult.receipts, relayServer, false)

      relayServer.config.url = 'fakeUrl'
      pastEventsResult = await relayServer.registrationManager.handlePastEvents(latestBlock.number, false)
      assertRelayAdded(pastEventsResult.receipts, relayServer, false)
    })
  })

  describe('event handlers', function () {
    describe('Unstaked event', function () {
      async function assertSendBalancesToOwner (
        server: RelayServer,
        managerHubBalanceBefore: BN,
        managerBalanceBefore: BN,
        workerBalanceBefore: BN): Promise<void> {
        const gasPrice = await _web3.eth.getGasPrice()
        const ownerBalanceBefore = toBN(await _web3.eth.getBalance(newServer.registrationManager.ownerAddress!))
        assert.equal(newServer.registrationManager.stakeRequired.currentValue.toString(), oneEther.toString())
        // TODO: assert on withdrawal block?
        // assert.equal(newServer.config.withdrawBlock?.toString(), '0')
        const latestBlock = await _web3.eth.getBlock('latest')
        const receipts = await newServer._worker(latestBlock.number)
        const totalTxCosts = getTotalTxCosts(receipts, gasPrice)
        const ownerBalanceAfter = toBN(await _web3.eth.getBalance(newServer.registrationManager.ownerAddress!))
        assert.equal(
          ownerBalanceAfter.sub(
            ownerBalanceBefore).toString(),
          managerHubBalanceBefore.add(managerBalanceBefore).add(workerBalanceBefore)
            .sub(totalTxCosts).toString(),
          `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) !=
         managerHubBalanceBefore(${managerHubBalanceBefore.toString()}) + managerBalanceBefore(${managerBalanceBefore.toString()}) + workerBalanceBefore(${workerBalanceBefore.toString()})
         - totalTxCosts(${totalTxCosts.toString()})`)
        const managerHubBalanceAfter = await rhub.balanceOf(newServer.managerAddress)
        const managerBalanceAfter = await newServer.getManagerBalance()
        const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceAfter.eqn(0))
        assert.isTrue(managerBalanceAfter.eqn(0))
        assert.isTrue(workerBalanceAfter.eqn(0))
        // TODO
        // assert.isTrue(newServer.withdrawBlock?.gtn(0))
      }

      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        newServer = await bringUpNewRelay(newRelayParams, partialConfig)
        const latestBlock = await _web3.eth.getBlock('latest')
        await newServer._worker(latestBlock.number)

        await rhub.depositFor(newServer.managerAddress, { value: 1e18.toString() })
        await stakeManager.unlockStake(newServer.managerAddress, { from: relayOwner })
      })
      afterEach(async function () {
        await revert(id)
      })
      it('send balances to owner when all balances > tx costs', async function () {
        const managerHubBalanceBefore = await rhub.balanceOf(newServer.managerAddress)
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.gtn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        await assertSendBalancesToOwner(newServer, managerHubBalanceBefore, managerBalanceBefore, workerBalanceBefore)
      })
      it('send balances to owner when manager hub balance < tx cost ', async function () {
        const workerAddress = newServer.workerAddress
        const managerHubBalance = await rhub.balanceOf(newServer.managerAddress)
        const method = rhub.contract.methods.withdraw(toHex(managerHubBalance), workerAddress)
        await newServer.transactionManager.sendTransaction({
          signer: newServer.managerAddress,
          destination: rhub.address,
          method
        })
        const managerHubBalanceBefore = await rhub.balanceOf(newServer.managerAddress)
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
        const partialConfig: Partial<GSNConfig> = {
          relayHubAddress: rhub.address,
          stakeManagerAddress: stakeManager.address
        }
        newServer = await bringUpNewRelay(newRelayParams, partialConfig)
      })
      afterEach(async function () {
        await revert(id)
      })
      it('set hubAuthorized', async function () {
        const latestBlock = await _web3.eth.getBlock('latest')
        await newServer._worker(latestBlock.number)
        assert.isTrue(newServer.registrationManager.isHubAuthorized, 'Hub should be authorized in server')
      })
    })

    describe('HubUnauthorized event', function () {
      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        const partialConfig: Partial<GSNConfig> = {
          relayHubAddress: rhub.address,
          stakeManagerAddress: stakeManager.address
        }
        newServer = await bringUpNewRelay(newRelayParams, partialConfig)
        const latestBlck = await _web3.eth.getBlock('latest')
        await newServer._worker(latestBlck.number)
        await rhub.depositFor(newServer.managerAddress, { value: 1e18.toString() })
      })
      afterEach(async function () {
        await revert(id)
      })
      it('send only manager hub balance and workers\' balances to owner (not manager eth balance)', async function () {
        await stakeManager.unauthorizeHubByOwner(newServer.managerAddress, rhub.address, { from: relayOwner })

        const managerHubBalanceBefore = await rhub.balanceOf(newServer.managerAddress)
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.gtn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        const ownerBalanceBefore = toBN(await _web3.eth.getBalance(relayOwner))
        assert.isTrue(newServer.registrationManager.isHubAuthorized, 'Hub should be authorized in server')
        const latestBlock = await _web3.eth.getBlock('latest')
        const receipts = await newServer._worker(latestBlock.number)
        assert.isFalse(newServer.registrationManager.isHubAuthorized, 'Hub should not be authorized in server')
        const gasPrice = await _web3.eth.getGasPrice()
        // TODO: these two hard-coded indexes are dependent on the order of operations in 'withdrawAllFunds'
        const workerEthTxCost = getTotalTxCosts([receipts[1]], gasPrice)
        const managerHubSendTxCost = getTotalTxCosts([receipts[0]], gasPrice)
        const ownerBalanceAfter = toBN(await _web3.eth.getBalance(relayOwner))
        const managerHubBalanceAfter = await rhub.balanceOf(newServer.managerAddress)
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

  describe('#attemptRegistration()', function () {
    let newServer: RelayServer

    function registrationTests (): void {
      it('should register server and add workers', async function () {
        const receipts = await newServer.registrationManager.attemptRegistration()
        assertRelayAdded(receipts, newServer)
      })
    }

    describe('without re-registration', function () {
      beforeEach(async function () {
        id = (await snapshot()).result
        const partialConfig: Partial<GSNConfig> = {
          relayHubAddress: rhub.address,
          stakeManagerAddress: stakeManager.address
        }
        newServer = await bringUpNewRelay(newRelayParams, partialConfig)
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
      registrationTests()
    })
  })
})
