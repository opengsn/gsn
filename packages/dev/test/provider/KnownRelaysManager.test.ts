import sinon from 'sinon'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'
import { ether } from '@openzeppelin/test-helpers'

import { KnownRelaysManager, DefaultRelayFilter } from '@opengsn/provider/dist/KnownRelaysManager'
import {
  ContractInteractor,
  LoggerInterface,
  RelayInfoUrl,
  RegistrarRelayInfo,
  constants,
  defaultEnvironment,
  registerForwarderForGsn,
  splitRelayUrlForRegistrar
} from '@opengsn/common'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRecipientInstance, TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { configureGSN, deployHub, startRelay, stopRelay } from '../TestUtils'
import { prepareTransaction } from './RelayProvider.test'

import { createClientLogger } from '@opengsn/logger/dist/ClientWinstonLogger'

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestToken = artifacts.require('TestToken')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const Forwarder = artifacts.require('Forwarder')
const RelayRegistrar = artifacts.require('RelayRegistrar')

export async function stake (testToken: TestTokenInstance, stakeManager: StakeManagerInstance, relayHub: RelayHubInstance, manager: string, owner: string): Promise<void> {
  const stake = ether('1')
  await testToken.mint(stake, { from: owner })
  await testToken.approve(stakeManager.address, stake, { from: owner })
  await stakeManager.setRelayManagerOwner(owner, { from: manager })
  await stakeManager.stakeForRelayManager(testToken.address, manager, 15000, stake, {
    from: owner
  })
  await stakeManager.authorizeHubByOwner(manager, relayHub.address, { from: owner })
}

export async function register (relayHub: RelayHubInstance, manager: string, worker: string, url: string, baseRelayFee?: string, pctRelayFee?: string): Promise<void> {
  await relayHub.addRelayWorkers([worker], { from: manager })
  const relayRegistrar = await RelayRegistrar.at(await relayHub.getRelayRegistrar())
  await relayRegistrar.registerRelayServer(relayHub.address, splitRelayUrlForRegistrar(url), { from: manager })
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
    workerRelayWorkersAdded2,
    workerRelayServerRegistered,
    workerNotActive
  ]) {
  const pastEventsQueryMaxPageSize = 10

  describe('#_fetchRecentlyActiveRelayManagers()', function () {
    let config: GSNConfig
    let logger: LoggerInterface
    let contractInteractor: ContractInteractor
    let stakeManager: StakeManagerInstance
    let penalizer: PenalizerInstance
    let relayHub: RelayHubInstance
    let testRecipient: TestRecipientInstance
    let testToken: TestTokenInstance
    let paymaster: TestPaymasterConfigurableMisbehaviorInstance
    const gas = 4e6

    before(async function () {
      testToken = await TestToken.new()
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
      penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, ether('1').toString())
      config = configureGSN({
        loggerConfiguration: { logLevel: 'error' },
        pastEventsQueryMaxPageSize
      })
      logger = createClientLogger(config.loggerConfiguration)
      const maxPageSize = Number.MAX_SAFE_INTEGER
      contractInteractor = new ContractInteractor({
        environment: defaultEnvironment,
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
      await stake(testToken, stakeManager, relayHub, activeRelayWorkersAdded, owner)
      await stake(testToken, stakeManager, relayHub, activeRelayServerRegistered, owner)
      await stake(testToken, stakeManager, relayHub, activePaymasterRejected, owner)
      await stake(testToken, stakeManager, relayHub, activeTransactionRelayed, owner)
      await stake(testToken, stakeManager, relayHub, notActiveRelay, owner)
      const txPaymasterRejected = await prepareTransaction(testRecipient, other, workerPaymasterRejected, paymaster.address, web3)
      const txTransactionRelayed = await prepareTransaction(testRecipient, other, workerTransactionRelayed, paymaster.address, web3)
      const relayRegistrar = await RelayRegistrar.at(await relayHub.getRelayRegistrar())

      /** events that are not supposed to be visible to the manager */
      await relayHub.addRelayWorkers([workerRelayServerRegistered], {
        from: activeRelayServerRegistered
      })
      await relayHub.addRelayWorkers([workerRelayWorkersAdded], {
        from: activeRelayWorkersAdded
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
      await relayRegistrar.registerRelayServer(relayHub.address, splitRelayUrlForRegistrar('aaa'), { from: activeTransactionRelayed })
      await relayRegistrar.registerRelayServer(relayHub.address, splitRelayUrlForRegistrar('bbb'), { from: activePaymasterRejected })
      await relayRegistrar.registerRelayServer(relayHub.address, splitRelayUrlForRegistrar('ccc'), { from: activeRelayWorkersAdded })

      /** events that are supposed to be visible to the manager */
      await relayRegistrar.registerRelayServer(relayHub.address, splitRelayUrlForRegistrar('ddd'), { from: activeRelayServerRegistered })
      await relayHub.addRelayWorkers([workerRelayWorkersAdded2], {
        from: activeRelayWorkersAdded
      })
      await relayHub.relayCall(10e6, txTransactionRelayed.relayRequest, txTransactionRelayed.signature, '0x', {
        from: workerTransactionRelayed,
        gas,
        gasPrice: txTransactionRelayed.relayRequest.relayData.maxFeePerGas
      })
      await paymaster.setReturnInvalidErrorCode(true)
      await relayHub.relayCall(10e6, txPaymasterRejected.relayRequest, txPaymasterRejected.signature, '0x', {
        from: workerPaymasterRejected,
        gas,
        gasPrice: txPaymasterRejected.relayRequest.relayData.maxFeePerGas
      })
    })

    it('should contain all relay managers from chain',
      async function () {
        const knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, config)
        const infos = await knownRelaysManager.getRelayInfoForManagers()
        const actual = infos.map(info => info.relayManager)
        assert.equal(actual.length, 4)
        assert.equal(actual[0], activeTransactionRelayed)
        assert.equal(actual[1], activePaymasterRejected)
        assert.equal(actual[2], activeRelayWorkersAdded)
        assert.equal(actual[3], activeRelayServerRegistered)
      })

    describe('#getRelaysShuffledForTransaction()', function () {
      it('should separate relays that have recent failures into a third class', async function () {
        const knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, Object.assign({}, config, { preferredRelays: ['http://localhost:8090'] }))
        await knownRelaysManager.refresh()
        assert.equal(knownRelaysManager.allRelayers.length, 4)
        knownRelaysManager.saveRelayFailure(100, activeTransactionRelayed, 'aaa')
        knownRelaysManager.saveRelayFailure(100, activePaymasterRejected, 'bbb')
        knownRelaysManager.saveRelayFailure(100, activeRelayWorkersAdded, 'ccc')
        const shuffled = await knownRelaysManager.getRelaysShuffledForTransaction()
        assert.equal(shuffled[0].length, 1)
        assert.equal(shuffled[0][0].relayUrl, 'http://localhost:8090', 'wrong preffered relay URL')
        assert.equal(shuffled[1].length, 1)
        assert.equal(shuffled[1][0].relayUrl, 'ddd', 'wrong good relay url')
        assert.equal(shuffled[2].length, 3)
        assert.isDefined(shuffled[2].find(it => it.relayUrl === 'aaa'), 'wrong bad relay url')
        assert.isDefined(shuffled[2].find(it => it.relayUrl === 'bbb'), 'wrong bad relay url')
        assert.isDefined(shuffled[2].find(it => it.relayUrl === 'ccc'), 'wrong bad relay url')
      })

      describe('#_refreshFailures()', function () {
        let knownRelaysManager: KnownRelaysManager
        let lastErrorTime: number
        before(function () {
          knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, configureGSN({}))
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
    })
  })
})

contract('KnownRelaysManager 2', function (accounts) {
  let contractInteractor: ContractInteractor
  let logger: LoggerInterface

  before(async function () {
    logger = createClientLogger({ logLevel: 'error' })
    const maxPageSize = Number.MAX_SAFE_INTEGER
    contractInteractor = new ContractInteractor({
      environment: defaultEnvironment,
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
    let testToken: TestTokenInstance
    let relayHub: RelayHubInstance
    let config: GSNConfig

    before(async function () {
      testToken = await TestToken.new()
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
      penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, ether('1').toString())
      config = configureGSN({
        preferredRelays: ['http://localhost:8090']
      })
      const deployment = { relayHubAddress: relayHub.address }

      await testToken.mint(ether('1'), { from: accounts[1] })
      await testToken.approve(stakeManager.address, ether('1'), { from: accounts[1] })
      relayProcess = await startRelay(relayHub.address, testToken, stakeManager, {
        stake: 1e18.toString(),
        url: 'asd',
        dbPruneTxAfterBlocks: 1,
        relayOwner: accounts[1],
        relaylog: process.env.relaylog,
        ethereumNodeUrl: (web3.currentProvider as HttpProvider).host
      })
      const maxPageSize = Number.MAX_SAFE_INTEGER
      contractInteractor = new ContractInteractor({
        environment: defaultEnvironment,
        provider: web3.currentProvider as HttpProvider,
        logger,
        maxPageSize,
        deployment
      })
      await contractInteractor.init()
      knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, config)
      await stake(testToken, stakeManager, relayHub, accounts[1], accounts[0])
      await stake(testToken, stakeManager, relayHub, accounts[2], accounts[0])
      await stake(testToken, stakeManager, relayHub, accounts[3], accounts[0])
      await stake(testToken, stakeManager, relayHub, accounts[4], accounts[0])
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
      assert.deepEqual(activeRelays.map((r: any) => r.relayUrl),
        [
          'http://localhost:8090',
          'stakeAndAuthorization1',
          'stakeAndAuthorization2'
        ])
    })

    it('should use \'relayFilter\' to remove unsuitable relays', async function () {
      const relayFilter = (registrarRelayInfo: RegistrarRelayInfo): boolean => {
        return registrarRelayInfo.relayUrl.includes('2')
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
