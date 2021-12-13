import sinon from 'sinon'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'
import { ether } from '@openzeppelin/test-helpers'

import { KnownRelaysManager, DefaultRelayScore, DefaultRelayFilter } from '@opengsn/provider/dist/KnownRelaysManager'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRecipientInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { configureGSN, deployHub, evmMineMany, startRelay, stopRelay } from '../TestUtils'
import { prepareTransaction } from './RelayProvider.test'

import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { RelayInfoUrl, RelayRegisteredEventInfo } from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { createClientLogger } from '@opengsn/provider/dist/ClientWinstonLogger'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { toBN } from 'web3-utils'

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const Forwarder = artifacts.require('Forwarder')

export async function stake (stakeManager: StakeManagerInstance, relayHub: RelayHubInstance, manager: string, owner: string): Promise<void> {
  await stakeManager.setRelayManagerOwner(owner, { from: manager })
  await stakeManager.stakeForRelayManager(manager, 1000, {
    value: ether('1'),
    from: owner
  })
  await stakeManager.authorizeHubByOwner(manager, relayHub.address, { from: owner })
}

export async function register (relayHub: RelayHubInstance, manager: string, worker: string, url: string, baseRelayFee?: string, pctRelayFee?: string): Promise<void> {
  await relayHub.addRelayWorkers([worker], { from: manager })
  await relayHub.registerRelayServer(baseRelayFee ?? '0', pctRelayFee ?? '0', url, { from: manager })
}

contract('KnownRelaysManager', function (
  [
    activeRelayWorkersAdded,
    activeRelayServerRegistered,
    activePaymasterRejected,
    activeTransactionRelayed,
    notActiveRelay,
    workerPaymasterRejected,
    workerTransactionRelayed,
    owner,
    other,
    workerRelayWorkersAdded,
    workerRelayServerRegistered,
    workerNotActive
  ]) {
  const relayLookupWindowBlocks = 100
  const pastEventsQueryMaxPageSize = 10

  describe('#_fetchRecentlyActiveRelayManagers()', function () {
    let config: GSNConfig
    let logger: LoggerInterface
    let contractInteractor: ContractInteractor
    let stakeManager: StakeManagerInstance
    let penalizer: PenalizerInstance
    let relayHub: RelayHubInstance
    let testRecipient: TestRecipientInstance
    let paymaster: TestPaymasterConfigurableMisbehaviorInstance
    const gas = 4e6

    before(async function () {
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      relayHub = await deployHub(stakeManager.address, penalizer.address)
      config = configureGSN({
        loggerConfiguration: { logLevel: 'error' },
        pastEventsQueryMaxPageSize,
        relayLookupWindowBlocks
      })
      logger = createClientLogger(config.loggerConfiguration)
      const maxPageSize = Number.MAX_SAFE_INTEGER
      contractInteractor = new ContractInteractor({
        provider: web3.currentProvider as HttpProvider,
        maxPageSize,
        logger,
        deployment: { relayHubAddress: relayHub.address }
      })
      await contractInteractor.init()

      const forwarderInstance = await Forwarder.new()
      const forwarderAddress = forwarderInstance.address
      testRecipient = await TestRecipient.new(forwarderAddress)
      await registerForwarderForGsn(forwarderInstance)

      paymaster = await TestPaymasterConfigurableMisbehavior.new()
      await paymaster.setTrustedForwarder(forwarderAddress)
      await paymaster.setRelayHub(relayHub.address)
      await paymaster.deposit({ value: ether('1') })
      await stake(stakeManager, relayHub, activeRelayWorkersAdded, owner)
      await stake(stakeManager, relayHub, activeRelayServerRegistered, owner)
      await stake(stakeManager, relayHub, activePaymasterRejected, owner)
      await stake(stakeManager, relayHub, activeTransactionRelayed, owner)
      await stake(stakeManager, relayHub, notActiveRelay, owner)
      const txPaymasterRejected = await prepareTransaction(testRecipient, other, workerPaymasterRejected, paymaster.address, web3)
      const txTransactionRelayed = await prepareTransaction(testRecipient, other, workerTransactionRelayed, paymaster.address, web3)

      /** events that are not supposed to be visible to the manager */
      await relayHub.addRelayWorkers([workerRelayServerRegistered], {
        from: activeRelayServerRegistered
      })
      await relayHub.addRelayWorkers([workerNotActive], {
        from: notActiveRelay
      })
      await relayHub.addRelayWorkers([workerTransactionRelayed], {
        from: activeTransactionRelayed
      })
      await relayHub.addRelayWorkers([workerPaymasterRejected], {
        from: activePaymasterRejected
      })
      await relayHub.registerRelayServer('0', '0', '', { from: activeTransactionRelayed })
      await relayHub.registerRelayServer('0', '0', '', { from: activePaymasterRejected })

      await evmMineMany(relayLookupWindowBlocks)
      /** events that are supposed to be visible to the manager */
      await relayHub.registerRelayServer('0', '0', '', { from: activeRelayServerRegistered })
      await relayHub.addRelayWorkers([workerRelayWorkersAdded], {
        from: activeRelayWorkersAdded
      })
      await relayHub.relayCall(10e6, txTransactionRelayed.relayRequest, txTransactionRelayed.signature, '0x', gas, {
        from: workerTransactionRelayed,
        gas,
        gasPrice: txTransactionRelayed.relayRequest.relayData.gasPrice
      })
      await paymaster.setReturnInvalidErrorCode(true)
      await relayHub.relayCall(10e6, txPaymasterRejected.relayRequest, txPaymasterRejected.signature, '0x', gas, {
        from: workerPaymasterRejected,
        gas,
        gasPrice: txPaymasterRejected.relayRequest.relayData.gasPrice
      })
    })

    it('should contain all relay managers only if their workers were active in the last \'relayLookupWindowBlocks\' blocks',
      async function () {
        const knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, config)
        const res = await knownRelaysManager._fetchRecentlyActiveRelayManagers()
        const actual = Array.from(res.values())
        assert.equal(actual.length, 4)
        assert.equal(actual[0], activeRelayServerRegistered)
        assert.equal(actual[1], activeRelayWorkersAdded)
        assert.equal(actual[2], activeTransactionRelayed)
        assert.equal(actual[3], activePaymasterRejected)
      })
  })
})

contract('KnownRelaysManager 2', function (accounts) {
  let contractInteractor: ContractInteractor
  let logger: LoggerInterface

  const transactionDetails = {
    gas: '0x10000000',
    gasPrice: '0x300000',
    from: '',
    data: '',
    to: '',
    forwarder: '',
    paymaster: ''
  }

  before(async function () {
    logger = createClientLogger({ logLevel: 'error' })
    const maxPageSize = Number.MAX_SAFE_INTEGER
    contractInteractor = new ContractInteractor({
      provider: web3.currentProvider as HttpProvider,
      maxPageSize,
      logger
    })
    await contractInteractor.init()
  })

  describe('#refresh()', function () {
    let relayProcess: ChildProcessWithoutNullStreams
    let knownRelaysManager: KnownRelaysManager
    let contractInteractor: ContractInteractor
    let stakeManager: StakeManagerInstance
    let penalizer: PenalizerInstance
    let relayHub: RelayHubInstance
    let config: GSNConfig

    before(async function () {
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      relayHub = await deployHub(stakeManager.address, penalizer.address)
      config = configureGSN({
        preferredRelays: ['http://localhost:8090']
      })
      const deployment = { relayHubAddress: relayHub.address }
      relayProcess = await startRelay(relayHub.address, stakeManager, {
        stake: 1e18,
        url: 'asd',
        relayOwner: accounts[1],
        ethereumNodeUrl: (web3.currentProvider as HttpProvider).host
      })
      const maxPageSize = Number.MAX_SAFE_INTEGER
      contractInteractor = new ContractInteractor({
        provider: web3.currentProvider as HttpProvider,
        logger,
        maxPageSize,
        deployment
      })
      await contractInteractor.init()
      knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, config)
      await stake(stakeManager, relayHub, accounts[1], accounts[0])
      await stake(stakeManager, relayHub, accounts[2], accounts[0])
      await stake(stakeManager, relayHub, accounts[3], accounts[0])
      await stake(stakeManager, relayHub, accounts[4], accounts[0])
      await register(relayHub, accounts[1], accounts[6], 'stakeAndAuthorization1')
      await register(relayHub, accounts[2], accounts[7], 'stakeAndAuthorization2')
      await register(relayHub, accounts[3], accounts[8], 'stakeUnlocked')
      await register(relayHub, accounts[4], accounts[9], 'hubUnauthorized')

      await stakeManager.unlockStake(accounts[3])
      await stakeManager.unauthorizeHubByOwner(accounts[4], relayHub.address)
    })

    after(async function () {
      await stopRelay(relayProcess)
    })

    it('should consider all relay managers with stake and authorization as active', async function () {
      await knownRelaysManager.refresh()
      const preferredRelays = knownRelaysManager.preferredRelayers
      const activeRelays = knownRelaysManager.allRelayers
      assert.equal(preferredRelays.length, 1)
      assert.equal(preferredRelays[0].relayUrl, 'http://localhost:8090')
      assert.equal(activeRelays.length, 3)
      assert.equal(activeRelays[0].relayUrl, 'http://localhost:8090')
      assert.equal(activeRelays[1].relayUrl, 'stakeAndAuthorization1')
      assert.equal(activeRelays[2].relayUrl, 'stakeAndAuthorization2')
    })

    it('should use \'relayFilter\' to remove unsuitable relays', async function () {
      const relayFilter = (registeredEventInfo: RelayRegisteredEventInfo): boolean => {
        return registeredEventInfo.relayUrl.includes('2')
      }
      const knownRelaysManagerWithFilter = new KnownRelaysManager(contractInteractor, logger, config, relayFilter)
      await knownRelaysManagerWithFilter.refresh()
      const relays = knownRelaysManagerWithFilter.allRelayers
      assert.equal(relays.length, 1)
      assert.equal(relays[0].relayUrl, 'stakeAndAuthorization2')
    })

    it('should use DefaultRelayFilter to remove unsuitable relays when none was provided', async function () {
      const knownRelaysManagerWithFilter = new KnownRelaysManager(contractInteractor, logger, config)
      // @ts-ignore
      assert.equal(knownRelaysManagerWithFilter.relayFilter.toString(), DefaultRelayFilter.toString())
    })

    describe('DefaultRelayFilter', function () {
      it('should filter expensive relayers', function () {
        const eventInfo = { relayUrl: 'url', relayManager: accounts[0] }
        assert.isFalse(DefaultRelayFilter({ ...eventInfo, pctRelayFee: '101', baseRelayFee: 1e16.toString() }))
        assert.isFalse(DefaultRelayFilter({ ...eventInfo, pctRelayFee: '99', baseRelayFee: 2e17.toString() }))
        assert.isFalse(DefaultRelayFilter({ ...eventInfo, pctRelayFee: '101', baseRelayFee: 2e17.toString() }))
        assert.isTrue(DefaultRelayFilter({ ...eventInfo, pctRelayFee: '100', baseRelayFee: 1e17.toString() }))
        assert.isTrue(DefaultRelayFilter({ ...eventInfo, pctRelayFee: '50', baseRelayFee: '0' }))
      })
    })
  })

  describe('#getRelaysSortedForTransaction()', function () {
    const relayInfoLowFee = {
      relayManager: accounts[0],
      relayUrl: 'lowFee',
      baseRelayFee: '1000000',
      pctRelayFee: '10'
    }
    const relayInfoHighFee = {
      relayManager: accounts[0],
      relayUrl: 'highFee',
      baseRelayFee: '100000000',
      pctRelayFee: '50'
    }

    const knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, configureGSN({}))

    describe('#_refreshFailures()', function () {
      let lastErrorTime: number
      before(function () {
        knownRelaysManager.saveRelayFailure(100, 'rm1', 'url1')
        knownRelaysManager.saveRelayFailure(500, 'rm2', 'url2')
        lastErrorTime = Date.now()
        knownRelaysManager.saveRelayFailure(lastErrorTime, 'rm3', 'url3')
      })

      it('should remove the failures that occurred more than \'relayTimeoutGrace\' seconds ago', function () {
        // @ts-ignore
        knownRelaysManager.relayFailures.forEach(failures => {
          assert.equal(failures.length, 1)
        })
        knownRelaysManager._refreshFailures()
        // @ts-ignore
        assert.equal(knownRelaysManager.relayFailures.get('url1').length, 0)
        // @ts-ignore
        assert.equal(knownRelaysManager.relayFailures.get('url2').length, 0)
        // @ts-ignore
        assert.deepEqual(knownRelaysManager.relayFailures.get('url3'), [{
          lastErrorTime,
          relayManager: 'rm3',
          relayUrl: 'url3'
        }])
      })
    })

    describe('DefaultRelayScore', function () {
      const failure = {
        lastErrorTime: 100,
        relayManager: 'rm3',
        relayUrl: 'url3'
      }
      it('should subtract penalty from a relay for each known failure', async function () {
        const relayScoreNoFailures = await DefaultRelayScore(relayInfoHighFee, transactionDetails, [])
        const relayScoreOneFailure = await DefaultRelayScore(relayInfoHighFee, transactionDetails, [failure])
        const relayScoreTenFailures = await DefaultRelayScore(relayInfoHighFee, transactionDetails, Array(10).fill(failure))
        const relayScoreLowFees = await DefaultRelayScore(relayInfoLowFee, transactionDetails, [])
        assert.isTrue(relayScoreNoFailures.gt(relayScoreOneFailure))
        assert.isTrue(relayScoreOneFailure.gt(relayScoreTenFailures))
        assert.isTrue(relayScoreLowFees.gt(relayScoreNoFailures))
      })
      it('should use DefaultRelayScore to remove unsuitable relays when none was provided', async function () {
        const knownRelaysManagerWithFilter = new KnownRelaysManager(contractInteractor, logger, configureGSN({}))
        // @ts-ignore
        assert.equal(knownRelaysManagerWithFilter.scoreCalculator.toString(), DefaultRelayScore.toString())
      })
    })
  })

  describe('getRelaysSortedForTransaction', function () {
    const biasedRelayScore = async function (relay: RelayRegisteredEventInfo): Promise<BN> {
      if (relay.relayUrl === 'alex') {
        return await Promise.resolve(toBN(1000))
      } else {
        return await Promise.resolve(toBN(100))
      }
    }
    const knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, configureGSN({}), undefined, biasedRelayScore)
    before(function () {
      const activeRelays: RelayRegisteredEventInfo[] = [{
        relayManager: accounts[0],
        relayUrl: 'alex',
        baseRelayFee: '100000000',
        pctRelayFee: '50'
      }, {
        relayManager: accounts[0],
        relayUrl: 'joe',
        baseRelayFee: '100',
        pctRelayFee: '5'
      }, {
        relayManager: accounts[1],
        relayUrl: 'joe',
        baseRelayFee: '10',
        pctRelayFee: '4'
      }]
      sinon.stub(knownRelaysManager, 'allRelayers').value(activeRelays)
    })

    it('should use provided score calculation method to sort the known relays', async function () {
      const sortedRelays = (await knownRelaysManager.getRelaysSortedForTransaction(transactionDetails)) as RelayRegisteredEventInfo[][]
      assert.equal(sortedRelays[1][0].relayUrl, 'alex')
      // checking the relayers are sorted AND they cannot overshadow each other's url
      assert.equal(sortedRelays[1][1].relayUrl, 'joe')
      assert.equal(sortedRelays[1][1].baseRelayFee, '100')
      assert.equal(sortedRelays[1][1].pctRelayFee, '5')
      assert.equal(sortedRelays[1][2].relayUrl, 'joe')
      assert.equal(sortedRelays[1][2].baseRelayFee, '10')
      assert.equal(sortedRelays[1][2].pctRelayFee, '4')
    })
  })

  describe('#getAuditors()', function () {
    const auditorsCount = 2
    let knownRelaysManager: KnownRelaysManager
    before(function () {
      const activeRelays: RelayInfoUrl[] = [{ relayUrl: 'alice' }, { relayUrl: 'bob' }, { relayUrl: 'charlie' }, { relayUrl: 'alice' }]
      const preferredRelayers: RelayInfoUrl[] = [{ relayUrl: 'alice' }, { relayUrl: 'david' }]
      knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, configureGSN({ auditorsCount }))
      sinon.stub(knownRelaysManager, 'preferredRelayers').value(preferredRelayers)
      sinon.stub(knownRelaysManager, 'allRelayers').value(activeRelays)
    })

    it('should give correct number of unique random relay URLs', function () {
      const auditors = knownRelaysManager.getAuditors([])
      const unique = auditors.filter((value, index, self) => {
        return self.indexOf(value) === index
      })
      assert.equal(unique.length, auditorsCount)
      assert.equal(auditors.length, auditorsCount)
    })

    it('should give all unique relays URLS if requested more then available', function () {
      // @ts-ignore
      knownRelaysManager.config.auditorsCount = 7
      const auditors = knownRelaysManager.getAuditors([])
      assert.deepEqual(auditors.sort(), ['alice', 'bob', 'charlie', 'david'])
    })

    it('should not include explicitly excluded URLs', function () {
      // @ts-ignore
      knownRelaysManager.config.auditorsCount = 7
      const auditors = knownRelaysManager.getAuditors(['charlie'])
      assert.deepEqual(auditors.sort(), ['alice', 'bob', 'david'])
    })
  })
})
