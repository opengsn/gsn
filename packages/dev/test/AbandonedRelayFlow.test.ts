import BN from 'bn.js'

import { RelayHubInstance, RelayRegistrarInstance, StakeManagerInstance, TestTokenInstance } from '@opengsn/contracts'
import { constants, defaultEnvironment, splitRelayUrlForRegistrar } from '@opengsn/common'
import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'

import { deployHub, increaseTime } from './TestUtils'

const RelayRegistrar = artifacts.require('RelayRegistrar')
const StakeManager = artifacts.require('StakeManager')
const TestToken = artifacts.require('TestToken')
const TestRelayHub = artifacts.require('TestRelayHub')

const devAddress = '0x9999999999999999999999999999999999999999'

contract('Abandoned Relay Flow', function ([_, relayManager, relayOwner, relayWorker]: string[]) {
  const oneEther = ether('1')
  const baseRelayFee = '10000'
  const pctRelayFee = '10'
  const url = 'http://relay.com'

  let relayHubInstance: RelayHubInstance
  let testToken: TestTokenInstance
  let stakeManager: StakeManagerInstance
  let relayRegistrar: RelayRegistrarInstance

  async function mintApproveSetOwnerStake (token: TestTokenInstance = testToken, stake: BN = oneEther, unstakeDelay: number = 15000): Promise<void> {
    await token.mint(stake, { from: relayOwner })
    await token.approve(stakeManager.address, stake, { from: relayOwner })
    await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
    await stakeManager.stakeForRelayManager(token.address, relayManager, unstakeDelay, stake, {
      from: relayOwner
    })
  }

  beforeEach(async function () {
    testToken = await TestToken.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, constants.BURN_ADDRESS)
    await mintApproveSetOwnerStake()
    relayHubInstance = await deployHub(
      stakeManager.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, testToken.address, oneEther.toString(),
      { abandonedRelayEscheatmentDelay: 1000, devAddress }, undefined, TestRelayHub)
    await relayHubInstance.depositFor(relayManager, {
      value: oneEther
    })
    relayRegistrar = await RelayRegistrar.at(await relayHubInstance.getRelayRegistrar())
    await stakeManager.authorizeHubByOwner(relayManager, relayHubInstance.address, { from: relayOwner })
    await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
    await relayRegistrar.registerRelayServer(relayHubInstance.address, baseRelayFee, pctRelayFee, splitRelayUrlForRegistrar(url), { from: relayManager })
  })

  it('should allow contract owner to set relay as abandoned on the StakeManager', async function () {
    let stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.equal(stakeInfo.abandonedTime.toString(), '0')
    const res = await stakeManager.markRelayAbandoned(relayManager)
    expectEvent.inLogs(res.logs, 'RelayAbandoned', {
      relayManager,
      isMarkedAbandoned: true
    })
    stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    const transactionReceipt = await web3.eth.getTransaction(res.tx)
    const block = await web3.eth.getBlock(transactionReceipt.blockNumber!)
    assert.equal(stakeInfo.abandonedTime.toString(), block.timestamp.toString())
  })

  it('should allow relay owner to unmark relay as abandoned on the StakeManager', async function () {
    await stakeManager.markRelayAbandoned(relayManager)
    let stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.notEqual(stakeInfo.abandonedTime.toString(), '0')
    const res = await stakeManager.revokeAbandonedStatus(relayManager, { from: relayOwner })
    expectEvent.inLogs(res.logs, 'RelayAbandoned', {
      relayManager,
      abandonedSince: '0',
      isMarkedAbandoned: false
    })
    stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.equal(stakeInfo.abandonedTime.toString(), '0')
  })

  it('should not allow contract owner to confiscate stake of not abandoned relay', async function () {
    await expectRevert(stakeManager.escheatAbandonedRelayStake(relayManager), 'relay manager not abandoned yet')
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(500)
    await expectRevert(stakeManager.escheatAbandonedRelayStake(relayManager), 'relay manager not abandoned yet')
  })

  it('should not allow contract owner to confiscate balance of not abandoned relay', async function () {
    await expectRevert(relayHubInstance.escheatAbandonedRelayBalance(relayManager), 'relay manager not abandoned yet')
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(500)
    await expectRevert(relayHubInstance.escheatAbandonedRelayBalance(relayManager), 'relay manager not abandoned yet')
  })

  it('should allow contract owner to confiscate balance of abandoned relay', async function () {
    const devAddressBalanceBefore = await relayHubInstance.balanceOf(devAddress)
    const relayManagerBalanceBefore = await relayHubInstance.balanceOf(relayManager)
    assert.equal(devAddressBalanceBefore.toString(), '0')
    assert.equal(relayManagerBalanceBefore.toString(), oneEther.toString())
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(10000)
    await relayHubInstance.escheatAbandonedRelayBalance(relayManager)
    const devAddressBalanceAfter = await relayHubInstance.balanceOf(devAddress)
    const relayManagerBalanceAfter = await relayHubInstance.balanceOf(relayManager)
    assert.equal(devAddressBalanceAfter.toString(), oneEther.toString())
    assert.equal(relayManagerBalanceAfter.toString(), '0')
  })

  it('should allow contract owner to confiscate stake of abandoned relay', async function () {
    await stakeManager.setDevAddress(devAddress)
    const devAddressBalanceBefore = await testToken.balanceOf(devAddress)
    const relayManagerStakeBefore = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.equal(devAddressBalanceBefore.toString(), '0')
    assert.equal(relayManagerStakeBefore.stake.toString(), oneEther.toString())
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(10000)
    const res = await stakeManager.escheatAbandonedRelayStake(relayManager)
    const devAddressBalanceAfter = await testToken.balanceOf(devAddress)
    const relayManagerStakeAfter = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.equal(devAddressBalanceAfter.toString(), oneEther.toString())
    assert.equal(relayManagerStakeAfter.stake.toString(), '0')

    expectEvent.inLogs(res.logs, 'AbandonedRelayManagerStakeEscheated', {
      relayManager,
      token: testToken.address,
      amount: oneEther
    })
  })

  it('verifyRelayAbandoned should return if relay is abandoned')
  it('verifyRelayAbandoned should revert if relay is abandoned')

  it('should allow contract owner to delete registration information of abandoned relay', async function () {
    const info = await relayRegistrar.getRelayInfo(relayHubInstance.address, relayManager)
    assert.equal(info.relayManager.toLowerCase(), relayManager.toLowerCase())
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(10000)
    const res = await relayRegistrar.deleteAbandonedRelayServer([relayHubInstance.address], relayManager)
    expectEvent.inLogs(res.logs, 'RelayServerRemoved', {
      relayManager,
      relayHub: relayHubInstance.address
    })
    await expectRevert(relayRegistrar.getRelayInfo(relayHubInstance.address, relayManager), 'relayManager not found')
  })
})
