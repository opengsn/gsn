import { constants, ether } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'

import KnownRelaysManager, { DefaultRelayScore } from '../../src/relayclient/KnownRelaysManager'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { defaultEnvironment } from '../../src/relayclient/types/Environments'
import {
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRecipientInstance
} from '../../types/truffle-contracts'
import { evmMineMany } from '../TestUtils'
import { prepareTransaction } from './RelayProvider.test'
import RelayRegisteredEventInfo from '../../src/relayclient/types/RelayRegisteredEventInfo'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'
import RelayFailureInfo from '../../src/relayclient/types/RelayFailureInfo'

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

async function stake (stakeManager: StakeManagerInstance, relayHub: RelayHubInstance, manager1: string, owner: string): Promise<void> {
  await stakeManager.stakeForAddress(manager1, 1000, {
    value: ether('1'),
    from: owner
  })
  await stakeManager.authorizeHub(manager1, relayHub.address, { from: owner })
}

async function register (stakeManager: StakeManagerInstance, relayHub: RelayHubInstance, manager: string, worker: string, url: string): Promise<void> {
  await relayHub.addRelayWorkers([worker], { from: manager })
  await relayHub.registerRelayServer('0', '0', url, { from: manager })
}

contract('KnownRelaysManager', function (
  [
    activeRelayWorkersAdded,
    activeRelayServerRegistered,
    activeCanRelayFailed,
    activeTransactionRelayed,
    notActiveRelay,
    workerRelayWorkersAdded,
    workerRelayServerRegistered,
    workerCanRelayFailed,
    workerTransactionRelayed,
    workerNotActive,
    owner,
    other
  ]) {
  const relayLookupWindowBlocks = 100

  describe('#_fetchRecentlyActiveRelayManagers()', function () {
    let config: GSNConfig
    let contractInteractor: ContractInteractor
    let stakeManager: StakeManagerInstance
    let relayHub: RelayHubInstance
    let testRecipient: TestRecipientInstance
    let paymaster: TestPaymasterConfigurableMisbehaviorInstance

    before(async function () {
      stakeManager = await StakeManager.new()
      relayHub = await RelayHub.new(defaultEnvironment.gtxdatanonzero, stakeManager.address, constants.ZERO_ADDRESS)
      config = configureGSN({
        relayHubAddress: relayHub.address,
        relayLookupWindowBlocks
      })
      contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, config)
      testRecipient = await TestRecipient.new()
      paymaster = await TestPaymasterConfigurableMisbehavior.new()
      await paymaster.setHub(relayHub.address)
      await paymaster.deposit({ value: ether('1') })
      await stake(stakeManager, relayHub, activeRelayWorkersAdded, owner)
      await stake(stakeManager, relayHub, activeRelayServerRegistered, owner)
      await stake(stakeManager, relayHub, activeCanRelayFailed, owner)
      await stake(stakeManager, relayHub, activeTransactionRelayed, owner)
      await stake(stakeManager, relayHub, notActiveRelay, owner)
      const txCanRelayFailed = await prepareTransaction(testRecipient, other, workerCanRelayFailed, paymaster.address, web3)
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
      await relayHub.addRelayWorkers([workerCanRelayFailed], {
        from: activeCanRelayFailed
      })
      await relayHub.registerRelayServer('0', '0', '', { from: activeTransactionRelayed })
      await relayHub.registerRelayServer('0', '0', '', { from: activeCanRelayFailed })

      await evmMineMany(relayLookupWindowBlocks)
      /** events that are supposed to be visible to the manager */
      await relayHub.registerRelayServer('0', '0', '', { from: activeRelayServerRegistered })
      await relayHub.addRelayWorkers([workerRelayWorkersAdded], {
        from: activeRelayWorkersAdded
      })
      await relayHub.relayCall(txTransactionRelayed.relayRequest, txTransactionRelayed.signature, '0x', {
        from: workerTransactionRelayed,
        gasPrice: txTransactionRelayed.relayRequest.gasData.gasPrice
      })
      await paymaster.setReturnInvalidErrorCode(true)
      await relayHub.relayCall(txCanRelayFailed.relayRequest, txCanRelayFailed.signature, '0x', {
        from: workerCanRelayFailed,
        gasPrice: txCanRelayFailed.relayRequest.gasData.gasPrice
      })
    })

    it('should contain all relay managers only if their workers were active in the last \'relayLookupWindowBlocks\' blocks', async function () {
      const knownRelaysManager = new KnownRelaysManager(contractInteractor, config)
      const res = await knownRelaysManager._fetchRecentlyActiveRelayManagers()
      const actual = Array.from(res.values())
      assert.equal(actual.length, 4)
      assert.equal(actual[0], activeRelayServerRegistered)
      assert.equal(actual[1], activeRelayWorkersAdded)
      assert.equal(actual[2], activeTransactionRelayed)
      assert.equal(actual[3], activeCanRelayFailed)
    })
  })
})

contract('KnownRelaysManager 2', function (accounts) {
  const contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, configureGSN({}))
  const transactionDetails = {
    gas: '0x10000',
    gasPrice: '0x300000',
    from: '',
    data: '',
    to: '',
    forwarder: '',
    paymaster: ''
  }

  describe('#refresh()', function () {
    let knownRelaysManager: KnownRelaysManager
    let contractInteractor: ContractInteractor
    let stakeManager: StakeManagerInstance
    let relayHub: RelayHubInstance
    let config: GSNConfig

    before(async function () {
      stakeManager = await StakeManager.new()
      relayHub = await RelayHub.new(defaultEnvironment.gtxdatanonzero, stakeManager.address, constants.ZERO_ADDRESS)
      config = configureGSN({
        relayHubAddress: relayHub.address,
        stakeManagerAddress: stakeManager.address
      })
      contractInteractor = new ContractInteractor(web3.currentProvider as HttpProvider, config)
      knownRelaysManager = new KnownRelaysManager(contractInteractor, config)
      await stake(stakeManager, relayHub, accounts[1], accounts[0])
      await stake(stakeManager, relayHub, accounts[2], accounts[0])
      await stake(stakeManager, relayHub, accounts[3], accounts[0])
      await stake(stakeManager, relayHub, accounts[4], accounts[0])
      await register(stakeManager, relayHub, accounts[1], accounts[11], 'stakeAndAuthorization1')
      await register(stakeManager, relayHub, accounts[2], accounts[12], 'stakeAndAuthorization2')
      await register(stakeManager, relayHub, accounts[3], accounts[13], 'stakeUnlocked')
      await register(stakeManager, relayHub, accounts[4], accounts[14], 'hubUnauthorized')

      await stakeManager.unlockStake(accounts[3])
      await stakeManager.unauthorizeHub(accounts[4], relayHub.address)
    })

    it('should consider all relay managers with stake and authorization as active', async function () {
      await knownRelaysManager.refresh()
      const relays = knownRelaysManager.getRelays()
      assert.equal(relays.length, 2)
      assert.equal(relays[0].relayUrl, 'stakeAndAuthorization1')
      assert.equal(relays[1].relayUrl, 'stakeAndAuthorization2')
    })

    it('should use \'relayFilter\' to remove unsuitable relays', async function () {
      const relayFilter = (registeredEventInfo: RelayRegisteredEventInfo): boolean => {
        return registeredEventInfo.relayUrl.includes('2')
      }
      const knownRelaysManagerWithFilter = new KnownRelaysManager(contractInteractor, config, relayFilter)
      await knownRelaysManagerWithFilter.refresh()
      const relays = knownRelaysManagerWithFilter.getRelays()
      assert.equal(relays.length, 1)
      assert.equal(relays[0].relayUrl, 'stakeAndAuthorization2')
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

    const knownRelaysManager = new KnownRelaysManager(contractInteractor, configureGSN({}))

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
        assert.isAbove(relayScoreNoFailures, relayScoreOneFailure)
        assert.isAbove(relayScoreOneFailure, relayScoreTenFailures)
        assert.isAbove(relayScoreLowFees, relayScoreNoFailures)
      })
    })
  })

  describe('getRelaysSortedForTransaction', function () {
    const biasedRelayScore = async function (relay: RelayRegisteredEventInfo, txDetails: GsnTransactionDetails, failures: RelayFailureInfo[]): Promise<number> {
      if (relay.relayUrl === 'alex') {
        return Promise.resolve(1000)
      } else {
        return Promise.resolve(100)
      }
    }
    const knownRelaysManager = new KnownRelaysManager(contractInteractor, configureGSN({}), undefined, biasedRelayScore)
    before(function () {
      const activeRelays = new Set<RelayRegisteredEventInfo>()
      activeRelays.add({
        relayManager: accounts[0],
        relayUrl: 'alex',
        baseRelayFee: '100000000',
        pctRelayFee: '50'
      })
      activeRelays.add({
        relayManager: accounts[0],
        relayUrl: 'joe',
        baseRelayFee: '100',
        pctRelayFee: '5'
      })
      // @ts-ignore
      knownRelaysManager.activeRelays = activeRelays
    })
    it('should use provided score calculation method to sort the known relays', async function () {
      const sortedRelays = await knownRelaysManager.getRelaysSortedForTransaction(transactionDetails)
      assert.equal(sortedRelays[0].relayUrl, 'alex')
      assert.equal(sortedRelays[1].relayUrl, 'joe')
    })
  })
})
