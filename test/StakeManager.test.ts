import sourceMapSupport from 'source-map-support'
import { balance, ether, expectEvent, expectRevert, constants } from '@openzeppelin/test-helpers'
import { expect } from 'chai'
import { evmMineMany } from './testutils'
import BN from 'bn.js'

import { StakeManagerInstance } from '../types/truffle-contracts'

// There seems to be a bug/conflict between libraries trying to install source map support.
// This patch can ensure the right one is the lats one to be applied.
// Be careful as this can have unpredicted consequences.
// @ts-ignore (this is a value I patched into the sourceMapSupport, it does not exist in type declaration)
sourceMapSupport.install({ errorFormatterForce: true })

const StakeManager = artifacts.require('StakeManager')

contract('StakeManager', function ([_, registree, anyRelayHub, owner, nonOwner]) {
  const initialUnstakeDelay = new BN(4)
  const initialStake = ether('1')
  let stakeManager: StakeManagerInstance

  function testCanStake (registree: string): void {
    it('should allow owner to stake for unowned addresses', async function () {
      const { logs } = await stakeManager.stakeForAddress(registree, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      expectEvent.inLogs(logs, 'StakeAdded', {
        registree,
        owner,
        stake: initialStake,
        unstakeDelay: initialUnstakeDelay
      })
    })
  }

  function testStakeNotValid (): void {
    it('should report registree stake as not valid', async function () {
      const isRegistreeStaked = await stakeManager.isRegistreeStaked(registree, 0, 0, { from: anyRelayHub })
      expect(isRegistreeStaked).to.be.false
    })
  }

  function testCanPenalize (): void {
    it('should allow to penalize hub', async function () {
      const beneficiaryBalanceTracker = await balance.tracker(nonOwner)
      const stakeManagerBalanceTracker = await balance.tracker(stakeManager.address)
      const remainingStake = new BN(100)
      const penaltyAmount = initialStake.sub(remainingStake)
      const { logs } = await stakeManager.penalizeRegistree(registree, nonOwner, penaltyAmount, {
        from: anyRelayHub
      })
      const expectedReward = penaltyAmount.divn(2)
      expectEvent.inLogs(logs, 'StakePenalized', {
        registree,
        beneficiary: nonOwner,
        reward: expectedReward
      })
      const relayOwnerGain = await beneficiaryBalanceTracker.delta()
      const stakeManagerLoss = await stakeManagerBalanceTracker.delta()
      expect(relayOwnerGain).to.be.bignumber.equal(expectedReward)
      expect(stakeManagerLoss).to.be.bignumber.equal(penaltyAmount.neg())

      // @ts-ignore
      const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
        await stakeManager.stakes(registree)
      expect(actualOwner).to.equal(owner)
      expect(actualStake).to.be.bignumber.equal(remainingStake)
      expect(actualUnstakeDelay).to.be.bignumber.equal(initialUnstakeDelay)
    })
  }

  describe('with no stake for relay server', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new()
    })

    testStakeNotValid()

    it('should not allow not owner to schedule unlock', async function () {
      await expectRevert(
        stakeManager.unlockStake({ from: owner }),
        'not owner'
      )
    })

    it('registrees cannot stake for themselves', async function () {
      await expectRevert(
        stakeManager.stakeForAddress(registree, initialUnstakeDelay, {
          value: initialStake,
          from: registree
        }),
        'registree cannot stake for itself'
      )
    })

    testCanStake(registree)
  })

  describe('with stake deposited for relay server', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new()
      await stakeManager.stakeForAddress(registree, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
    })

    it('should not allow to penalize hub', async function () {
      await expectRevert(
        stakeManager.penalizeRegistree(registree, nonOwner, initialStake, { from: anyRelayHub }),
        'hub not authorized'
      )
    })

    it('should allow querying owner\'s registree', async function () {
      const actualRegistree = await stakeManager.registrees(owner)
      expect(actualRegistree).to.equal(registree)
    })

    it('should allow querying registree\'s stake', async function () {
      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
        await stakeManager.stakes(registree)
      expect(actualOwner).to.equal(owner)
      expect(actualStake).to.be.bignumber.equal(initialStake)
      expect(actualUnstakeDelay).to.be.bignumber.equal(initialUnstakeDelay)
    })

    it('should not allow owner to stake for a different registree', async function () {
      await expectRevert(
        stakeManager.stakeForAddress(nonOwner, initialUnstakeDelay, { from: owner }),
        'different stake exists'
      )
    })

    it('should not allow one registree stake', async function () {
      await expectRevert(
        stakeManager.stakeForAddress(nonOwner, initialUnstakeDelay, { from: registree }),
        'sender is a registree itself'
      )
    })

    it('owner can increase the relay stake', async function () {
      const addedStake = ether('2')
      const stake = initialStake.add(addedStake)
      const { logs } = await stakeManager.stakeForAddress(registree, initialUnstakeDelay, {
        value: addedStake,
        from: owner
      })
      expectEvent.inLogs(logs, 'StakeAdded', {
        registree,
        stake,
        unstakeDelay: initialUnstakeDelay
      })

      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { stake: actualStake } = await stakeManager.stakes(registree)
      expect(actualStake).to.be.bignumber.equal(initialStake.add(addedStake))
    })

    it('should allow owner to increase the unstake delay', async function () {
      const newUnstakeDelay = new BN(5)
      const { logs } = await stakeManager.stakeForAddress(registree, newUnstakeDelay, { from: owner })
      expectEvent.inLogs(logs, 'StakeAdded', {
        registree,
        stake: initialStake,
        unstakeDelay: newUnstakeDelay
      })
      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { unstakeDelay: actualUnstakeDelay } = await stakeManager.stakes(registree)
      expect(actualUnstakeDelay).to.be.bignumber.equal(newUnstakeDelay)
    })

    it('should not allow owner to decrease the unstake delay', async function () {
      await expectRevert(
        stakeManager.stakeForAddress(registree, initialUnstakeDelay.subn(1), { from: owner }),
        'unstakeDelay cannot be decreased'
      )
    })

    it('not owner cannot stake for owned registree address', async function () {
      await expectRevert(
        stakeManager.stakeForAddress(registree, initialUnstakeDelay, { from: nonOwner }),
        'not owner'
      )
    })

    it('should not allow owner to withdraw stakes when not scheduled', async function () {
      await expectRevert(stakeManager.withdrawStake({ from: owner }), 'Withdrawal is not scheduled')
    })

    it('should allow registree to authorize new relay hub', async function () {
      const { logs } = await stakeManager.authorizeHub(anyRelayHub, { from: owner })
      expectEvent.inLogs(logs, 'HubAuthorized', {
        registree,
        relayHub: anyRelayHub
      })
    })

    describe('should not allow not owner to call to', function () {
      it('authorize hub', async function () {
        await expectRevert(stakeManager.authorizeHub(anyRelayHub, { from: nonOwner }), 'not owner')
      })
      it('unauthorize hub', async function () {
        await expectRevert(stakeManager.unauthorizeHub(anyRelayHub, { from: nonOwner }), 'not owner')
      })
      it('unlock stake', async function () {
        await expectRevert(stakeManager.unlockStake({ from: nonOwner }), 'not owner')
      })
      it('withdraw stake', async function () {
        await expectRevert(stakeManager.withdrawStake({ from: nonOwner }), 'not owner')
      })
    })
  })

  describe('with authorized hub', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new()
      await stakeManager.stakeForAddress(registree, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await stakeManager.authorizeHub(anyRelayHub, { from: owner })
    })

    it('should allow querying registree\'s authorized hubs', async function () {
      const authorizedHubWithdrawal = await stakeManager.authorizedHubs(registree, anyRelayHub)
      const notAuthorizedHubWithdrawal = await stakeManager.authorizedHubs(registree, nonOwner)
      const uint32FF = new BN('f'.repeat(64), 'hex')
      expect(authorizedHubWithdrawal).to.be.bignumber.equal(uint32FF)
      expect(notAuthorizedHubWithdrawal).to.be.bignumber.equal(new BN(0))
    })

    it('should report registree stake as valid for the authorized hub', async function () {
      const isRegistreeStaked = await stakeManager.isRegistreeStaked(registree, 0, 0, { from: anyRelayHub })
      expect(isRegistreeStaked).to.be.true
    })

    describe('should report registree stake as not valid for', function () {
      it('not authorized hub', async function () {
        const isRegistreeStaked = await stakeManager.isRegistreeStaked(registree, 0, 0, { from: nonOwner })
        expect(isRegistreeStaked).to.be.false
      })
      it('not staked registree', async function () {
        const isRegistreeStaked = await stakeManager.isRegistreeStaked(nonOwner, 0, 0, { from: anyRelayHub })
        expect(isRegistreeStaked).to.be.false
      })
      it('minimum stake amount above actual', async function () {
        const isRegistreeStaked = await stakeManager.isRegistreeStaked(registree, (1e20).toString(), 0, { from: anyRelayHub })
        expect(isRegistreeStaked).to.be.false
      })
      it('minimum unstake delay above actual', async function () {
        const isRegistreeStaked = await stakeManager.isRegistreeStaked(registree, 0, 1e10, { from: anyRelayHub })
        expect(isRegistreeStaked).to.be.false
      })
    })

    it('should not allow to penalize for more than the registree stake', async function () {
      await expectRevert(
        stakeManager.penalizeRegistree(registree, nonOwner, initialStake.muln(2), { from: anyRelayHub }),
        'penalty exceeds stake'
      )
    })

    testCanPenalize()

    it('should allow registree to unauthorize an authorized hub', async function () {
      const { logs, receipt } = await stakeManager.unauthorizeHub(anyRelayHub, { from: owner })
      const removalBlock = initialUnstakeDelay.addn(receipt.blockNumber)
      expectEvent.inLogs(logs, 'HubUnauthorized', {
        registree,
        relayHub: anyRelayHub,
        removalBlock
      })
    })

    it('should not allow owner to unauthorize non-authorized hub', async function () {
      await expectRevert(stakeManager.unauthorizeHub(nonOwner, { from: owner }), 'hub not authorized')
    })

    it('should allow owner to schedule stake unlock', async function () {
      const { logs, receipt } = await stakeManager.unlockStake({ from: owner })
      const withdrawBlock = initialUnstakeDelay.addn(receipt.blockNumber)
      expectEvent.inLogs(logs, 'StakeUnlocked', {
        registree,
        owner,
        withdrawBlock
      })
    })
  })

  describe('with scheduled deauthorization of an authorized hub', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new()
      await stakeManager.stakeForAddress(registree, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await stakeManager.authorizeHub(anyRelayHub, { from: owner })
      await stakeManager.unauthorizeHub(anyRelayHub, { from: owner })
    })

    testCanPenalize()

    it('should not allow owner to unauthorize hub again', async function () {
      await expectRevert(stakeManager.unauthorizeHub(anyRelayHub, { from: owner }), 'hub not authorized')
    })

    describe('after grace period elapses', function () {
      beforeEach(async function () {
        await evmMineMany(initialUnstakeDelay)
      })

      it('should not allow to penalize hub', async function () {
        await expectRevert(
          stakeManager.penalizeRegistree(registree, nonOwner, initialStake, { from: anyRelayHub }),
          'hub authorization expired'
        )
      })
    })
  })

  describe('with scheduled unlock while hub still authorized', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new()
      await stakeManager.stakeForAddress(registree, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await stakeManager.authorizeHub(anyRelayHub, { from: owner })
      await stakeManager.unlockStake({ from: owner })
    })

    testStakeNotValid()
    it('should not allow owner to schedule unlock again', async function () {
      await expectRevert(
        stakeManager.unlockStake({ from: owner }),
        'already pending'
      )
    })

    it('should not allow owner to withdraw stakes before it is due', async function () {
      await expectRevert(stakeManager.withdrawStake({ from: owner }), 'Withdrawal is not due')
    })

    testCanPenalize()

    it('should allow to withdraw stake after unstakeDelay', async function () {
      await evmMineMany(initialUnstakeDelay)
      const relayOwnerBalanceTracker = await balance.tracker(owner)
      const stakeManagerBalanceTracker = await balance.tracker(stakeManager.address)

      // We call unstake with a gasPrice of zero to accurately measure the balance change in the relayOwner
      const { logs } = await stakeManager.withdrawStake({
        from: owner,
        gasPrice: 0
      })
      expectEvent.inLogs(logs, 'StakeWithdrawn', {
        registree,
        amount: initialStake
      })

      const relayOwnerGain = await relayOwnerBalanceTracker.delta()
      const stakeManagerLoss = await stakeManagerBalanceTracker.delta()
      expect(relayOwnerGain).to.be.bignumber.equal(initialStake)
      expect(stakeManagerLoss).to.be.bignumber.equal(initialStake.neg())
    })

    describe('with stake withdrawn', function () {
      beforeEach(async function () {
        await evmMineMany(initialUnstakeDelay)
        await stakeManager.withdrawStake({ from: owner })
      })

      it('should have no memory of removed registree', async function () {
        // @ts-ignore (typechain does not declare names or iterator for return types)
        const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
          await stakeManager.stakes(registree)
        expect(actualOwner).to.equal(constants.ZERO_ADDRESS)
        expect(actualStake).to.be.bignumber.equal(new BN(0))
        expect(actualUnstakeDelay).to.be.bignumber.equal(new BN(0))
      })

      testCanStake(nonOwner)
    })
  })
})
