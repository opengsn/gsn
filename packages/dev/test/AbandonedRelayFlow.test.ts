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

  async function getBlockTimestamp (res: Truffle.TransactionResponse<any>): Promise<number | string> {
    const transactionReceipt = await web3.eth.getTransaction(res.tx)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const block = await web3.eth.getBlock(transactionReceipt.blockNumber!)
    return block.timestamp
  }

  beforeEach(async function () {
    const abandonmentDelay = 1000
    const escheatmentDelay = 500
    testToken = await TestToken.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, abandonmentDelay, escheatmentDelay, constants.BURN_ADDRESS, devAddress)
    await mintApproveSetOwnerStake()
    relayHubInstance = await deployHub(
      stakeManager.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, testToken.address, oneEther.toString(),
      { devAddress }, undefined, TestRelayHub)
    await relayHubInstance.depositFor(relayManager, {
      value: oneEther
    })
    relayRegistrar = await RelayRegistrar.at(await relayHubInstance.getRelayRegistrar())
    await stakeManager.authorizeHubByOwner(relayManager, relayHubInstance.address, { from: relayOwner })
    await relayHubInstance.addRelayWorkers([relayWorker], { from: relayManager })
    await relayRegistrar.registerRelayServer(relayHubInstance.address, splitRelayUrlForRegistrar(url), { from: relayManager })
  })

  it('should not allow to mark a relay server with a recent keepalive transaction as abandoned', async function () {
    await expectRevert(stakeManager.markRelayAbandoned(relayManager), 'relay manager was alive recently')
  })

  it('should allow StakeManager contract owner to set relay as abandoned on the StakeManager', async function () {
    await increaseTime(1100)
    let stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.equal(stakeInfo.abandonedTime.toString(), '0')
    const res = await stakeManager.markRelayAbandoned(relayManager)
    expectEvent.inLogs(res.logs, 'RelayServerAbandoned', {
      relayManager
    })
    stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    const blockTimestamp = await getBlockTimestamp(res)
    assert.equal(stakeInfo.abandonedTime.toString(), blockTimestamp.toString())
  })

  it('should allow relay owner to update relay keepalive timestamp on the StakeManager', async function () {
    await increaseTime(1100)
    await stakeManager.markRelayAbandoned(relayManager)
    let stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.notEqual(stakeInfo.abandonedTime.toString(), '0')
    const res = await stakeManager.updateRelayKeepaliveTime(relayManager, { from: relayOwner })
    const blockTimestamp = await getBlockTimestamp(res)
    expectEvent.inLogs(res.logs, 'RelayServerKeepalive', {
      relayManager,
      keepaliveTime: blockTimestamp.toString()
    })
    stakeInfo = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.equal(stakeInfo.abandonedTime.toString(), '0')
  })

  it('should allow relay registrar to update relay keepalive timestamp on the StakeManager', async function () {
    const keepaliveTimeBefore = (await stakeManager.getStakeInfo(relayManager))[0].keepaliveTime
    const res = await relayRegistrar.registerRelayServer(relayHubInstance.address, splitRelayUrlForRegistrar(url), { from: relayManager })
    const blockTimestamp = await getBlockTimestamp(res)
    const keepaliveTimeAfter = (await stakeManager.getStakeInfo(relayManager))[0].keepaliveTime
    assert.notEqual(keepaliveTimeBefore.toString(), blockTimestamp.toString())
    assert.equal(keepaliveTimeAfter.toString(), blockTimestamp.toString())
  })

  it('should not allow incorrect address to update relay keepalive timestamp on the StakeManager', async function () {
    await expectRevert(stakeManager.updateRelayKeepaliveTime(relayManager, { from: relayWorker }), 'must be called by owner or hub')
  })

  it('should not allow contract owner to confiscate stake of not abandoned relay', async function () {
    await expectRevert(stakeManager.escheatAbandonedRelayStake(relayManager), 'relay server not escheatable yet')
    await increaseTime(1100)
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(400)
    await expectRevert(stakeManager.escheatAbandonedRelayStake(relayManager), 'relay server not escheatable yet')
  })

  it('should not allow contract owner to confiscate balance of not abandoned relay', async function () {
    await expectRevert(relayHubInstance.escheatAbandonedRelayBalance(relayManager), 'relay server not escheatable yet')
    await increaseTime(1100)
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(400)
    await expectRevert(relayHubInstance.escheatAbandonedRelayBalance(relayManager), 'relay server not escheatable yet')
  })

  it('should allow contract owner to confiscate balance of abandoned relay', async function () {
    const devAddressBalanceBefore = await relayHubInstance.balanceOf(devAddress)
    const relayManagerBalanceBefore = await relayHubInstance.balanceOf(relayManager)
    assert.equal(devAddressBalanceBefore.toString(), '0')
    assert.equal(relayManagerBalanceBefore.toString(), oneEther.toString())
    await increaseTime(1100)
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(600)
    const res = await relayHubInstance.escheatAbandonedRelayBalance(relayManager)
    const devAddressBalanceAfter = await relayHubInstance.balanceOf(devAddress)
    const relayManagerBalanceAfter = await relayHubInstance.balanceOf(relayManager)
    assert.equal(devAddressBalanceAfter.toString(), oneEther.toString())
    assert.equal(relayManagerBalanceAfter.toString(), '0')

    expectEvent.inLogs(res.logs, 'AbandonedRelayManagerBalanceEscheated', {
      relayManager,
      balance: oneEther
    })
  })

  it('should allow contract owner to confiscate stake of abandoned relay', async function () {
    const devAddressBalanceBefore = await testToken.balanceOf(devAddress)
    const relayManagerStakeBefore = (await stakeManager.getStakeInfo(relayManager))[0]
    assert.equal(devAddressBalanceBefore.toString(), '0')
    assert.equal(relayManagerStakeBefore.stake.toString(), oneEther.toString())
    await increaseTime(1100)
    await stakeManager.markRelayAbandoned(relayManager)
    await increaseTime(600)
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
})
