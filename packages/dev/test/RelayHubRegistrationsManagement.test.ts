import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'

import {
  PenalizerInstance,
  RelayHubInstance,
  RelayRegistrarInstance,
  StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance, TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { deployHub } from './TestUtils'
import { defaultEnvironment, constants, splitRelayUrlForRegistrar } from '@opengsn/common'

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestToken = artifacts.require('TestToken')
const RelayRegistrar = artifacts.require('RelayRegistrar')

contract('RelayHub Relay Management', function ([_, relayOwner, relayManager, relayWorker1, relayWorker2, relayWorker3]) {
  const stake = ether('2')
  const relayUrl = splitRelayUrlForRegistrar('http://new-relay.com')

  let relayHub: RelayHubInstance
  let relayRegistrar: RelayRegistrarInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let stakeManager: StakeManagerInstance
  let testToken: TestTokenInstance
  let penalizer: PenalizerInstance

  beforeEach(async function () {
    testToken = await TestToken.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString())
    relayRegistrar = await RelayRegistrar.at(await relayHub.getRelayRegistrar())
    paymaster = await TestPaymasterEverythingAccepted.new()
    await paymaster.setRelayHub(relayHub.address)
  })

  context('without stake for relayManager', function () {
    it('should not allow relayManager to add relay workers', async function () {
      await expectRevert(
        relayHub.addRelayWorkers([relayWorker1], {
          from: relayManager
        }),
        'relay manager not staked')
    })

    context('after stake unlocked for relayManager', function () {
      beforeEach(async function () {
        await testToken.mint(stake, { from: relayOwner })
        await testToken.approve(stakeManager.address, stake, { from: relayOwner })
        await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
        await stakeManager.stakeForRelayManager(testToken.address, relayManager, 15000, stake, {
          from: relayOwner
        })
        await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
        await relayHub.addRelayWorkers([relayWorker1], { from: relayManager })
        await stakeManager.unauthorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      })

      it('should not allow relayManager to register a relay server', async function () {
        await expectRevert(
          relayRegistrar.registerRelayServer(relayHub.address, relayUrl, { from: relayManager }),
          'this hub is not authorized by SM')
      })
    })
  })

  context('with stake for relayManager and no active workers added', function () {
    beforeEach(async function () {
      await testToken.mint(stake, { from: relayOwner })
      await testToken.approve(stakeManager.address, stake, { from: relayOwner })
      await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
      await stakeManager.stakeForRelayManager(testToken.address, relayManager, 15000, stake, {
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
    })

    it('should not allow relayManager to register a relay server', async function () {
      await expectRevert(
        relayRegistrar.registerRelayServer(relayHub.address, relayUrl, { from: relayManager }),
        'no relay workers')
    })

    it('should allow relayManager to add multiple workers', async function () {
      const newRelayWorkers = [relayWorker1, relayWorker2, relayWorker3]
      const { logs } = await relayHub.addRelayWorkers(newRelayWorkers, { from: relayManager })
      expectEvent.inLogs(logs, 'RelayWorkersAdded', {
        relayManager,
        newRelayWorkers,
        workersCount: '3'
      })
    })

    it('should not allow relayManager to register already registered workers', async function () {
      await relayHub.addRelayWorkers([relayWorker1], { from: relayManager })
      await expectRevert(
        relayHub.addRelayWorkers([relayWorker1], { from: relayManager }),
        'this worker has a manager')
    })
  })

  context('with stake for relay manager and active relay workers', function () {
    beforeEach(async function () {
      await testToken.mint(stake, { from: relayOwner })
      await testToken.approve(stakeManager.address, stake, { from: relayOwner })
      await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
      await stakeManager.stakeForRelayManager(testToken.address, relayManager, 15000, stake, {
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      await relayHub.addRelayWorkers([relayWorker1], { from: relayManager })
    })

    it('should not allow relayManager to exceed allowed number of workers', async function () {
      const newRelayWorkers = []
      for (let i = 0; i < 11; i++) {
        newRelayWorkers.push(relayWorker1)
      }
      await expectRevert(
        relayHub.addRelayWorkers(newRelayWorkers, { from: relayManager }),
        'too many workers')
    })

    it('should allow relayManager to update transaction fee and url', async function () {
      const { logs } = await relayRegistrar.registerRelayServer(relayHub.address, relayUrl, { from: relayManager })
      expectEvent.inLogs(logs, 'RelayServerRegistered', {
        relayManager,
        relayUrl
      })
    })
  })
})
