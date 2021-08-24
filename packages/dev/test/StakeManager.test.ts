import { balance, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { expect } from 'chai'
import { evmMineMany } from './TestUtils'
import BN from 'bn.js'

import { StakeManagerInstance } from '@opengsn/contracts/types/truffle-contracts'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'

const StakeManager = artifacts.require('StakeManager')

contract('StakeManager', function ([_, relayManager, anyRelayHub, owner, nonOwner, secondRelayManager]) {
  const initialUnstakeDelay = new BN(4)
  const initialStake = ether('1')
  let stakeManager: StakeManagerInstance

  function testNotOwnerCannotStake (): void {
    it('should not allow not owner to stake for owned relayManager address', async function () {
      await expectRevert(
        stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, { from: nonOwner }),
        'not owner'
      )
    })
  }

  function testOwnerCanStake (): void {
    it('should allow owner to stake for unowned addresses', async function () {
      const { logs } = await stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      expectEvent.inLogs(logs, 'StakeAdded', {
        relayManager,
        owner,
        stake: initialStake,
        unstakeDelay: initialUnstakeDelay
      })
    })
  }

  function testStakeNotValid (): void {
    it('should report relayManager stake as not valid', async function () {
      const isRelayManagerStaked = await stakeManager.isRelayManagerStaked(relayManager, anyRelayHub, 0, 0)
      expect(isRelayManagerStaked).to.be.false
    })
  }

  function testCanPenalize (): void {
    it('should allow to penalize hub', async function () {
      const beneficiaryBalanceTracker = await balance.tracker(nonOwner)
      const stakeManagerBalanceTracker = await balance.tracker(stakeManager.address)
      const remainingStake = new BN(100)
      const penaltyAmount = initialStake.sub(remainingStake)
      const { logs } = await stakeManager.penalizeRelayManager(relayManager, nonOwner, penaltyAmount, {
        from: anyRelayHub
      })
      const expectedReward = penaltyAmount.divn(2)
      expectEvent.inLogs(logs, 'StakePenalized', {
        relayManager,
        beneficiary: nonOwner,
        reward: expectedReward
      })
      const relayOwnerGain = await beneficiaryBalanceTracker.delta()
      const stakeManagerLoss = await stakeManagerBalanceTracker.delta()
      expect(relayOwnerGain).to.be.bignumber.equal(expectedReward)
      expect(stakeManagerLoss).to.be.bignumber.equal(penaltyAmount.neg())

      // @ts-ignore
      const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
        await stakeManager.stakes(relayManager)
      expect(actualOwner).to.equal(owner)
      expect(actualStake).to.be.bignumber.equal(remainingStake)
      expect(actualUnstakeDelay).to.be.bignumber.equal(initialUnstakeDelay)
    })
  }

  describe('with no stake for relay server', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    })

    testStakeNotValid()

    it('should not allow anyone to stake before owner is set', async function () {
      await expectRevert(
        stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, {
          value: initialStake,
          from: owner
        }),
        'not owner'
      )
    })

    it('should allow manager to set its owner', async function () {
      const { logs } = await stakeManager.setRelayManagerOwner(owner, { from: relayManager })
      expectEvent.inLogs(logs, 'OwnerSet', {
        relayManager,
        owner
      })
    })

    it('should not allow manager to change its owner', async function () {
      await stakeManager.setRelayManagerOwner(owner, { from: relayManager })
      await expectRevert(
        stakeManager.setRelayManagerOwner(owner, {
          from: relayManager
        }),
        'already owned'
      )
    })
    it('should not allow not owner to schedule unlock', async function () {
      await expectRevert(
        stakeManager.unlockStake(relayManager, { from: nonOwner }),
        'not owner'
      )
    })

    context('with owner set', function () {
      beforeEach(async function () {
        await stakeManager.setRelayManagerOwner(owner, { from: relayManager })
      })

      it('should not allow owner to stake with an unstake delay exceeding maximum', async function () {
        await expectRevert(
          stakeManager.stakeForRelayManager(relayManager, defaultEnvironment.maxUnstakeDelay + 1, {
            value: initialStake,
            from: owner
          }),
          'unstakeDelay too big'
        )
      })

      testOwnerCanStake()
    })
  })

  describe('with stake deposited for relay server', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      await stakeManager.setRelayManagerOwner(owner, { from: relayManager })
      await stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
    })

    it('should not allow to penalize hub', async function () {
      await expectRevert(
        stakeManager.penalizeRelayManager(relayManager, nonOwner, initialStake, { from: anyRelayHub }),
        'hub not authorized'
      )
    })

    it('should allow querying relayManager\'s stake', async function () {
      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { stake: actualStake, unstakeDelay: actualUnstakeDelay, owner: actualOwner } =
        await stakeManager.stakes(relayManager)
      expect(actualOwner).to.equal(owner)
      expect(actualStake).to.be.bignumber.equal(initialStake)
      expect(actualUnstakeDelay).to.be.bignumber.equal(initialUnstakeDelay)
    })

    it('should allow owner to stake for a second manager', async function () {
      await stakeManager.setRelayManagerOwner(owner, { from: secondRelayManager })
      const { logs } = await stakeManager.stakeForRelayManager(secondRelayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      expectEvent.inLogs(logs, 'StakeAdded', {
        relayManager: secondRelayManager,
        owner,
        stake: initialStake,
        unstakeDelay: initialUnstakeDelay
      })
    })

    it('owner can increase the relay stake', async function () {
      const addedStake = ether('2')
      const stake = initialStake.add(addedStake)
      const { logs } = await stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, {
        value: addedStake,
        from: owner
      })
      expectEvent.inLogs(logs, 'StakeAdded', {
        relayManager,
        stake,
        unstakeDelay: initialUnstakeDelay
      })

      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { stake: actualStake } = await stakeManager.stakes(relayManager)
      expect(actualStake).to.be.bignumber.equal(initialStake.add(addedStake))
    })

    it('should allow owner to increase the unstake delay', async function () {
      const newUnstakeDelay = new BN(5)
      const { logs } = await stakeManager.stakeForRelayManager(relayManager, newUnstakeDelay, { from: owner })
      expectEvent.inLogs(logs, 'StakeAdded', {
        relayManager,
        stake: initialStake,
        unstakeDelay: newUnstakeDelay
      })
      // @ts-ignore (typechain does not declare names or iterator for return types)
      const { unstakeDelay: actualUnstakeDelay } = await stakeManager.stakes(relayManager)
      expect(actualUnstakeDelay).to.be.bignumber.equal(newUnstakeDelay)
    })

    it('should not allow owner to decrease the unstake delay', async function () {
      await expectRevert(
        stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay.subn(1), { from: owner }),
        'unstakeDelay cannot be decreased'
      )
    })

    testNotOwnerCannotStake()

    it('should not allow owner to withdraw stakes when not scheduled', async function () {
      await expectRevert(stakeManager.withdrawStake(relayManager, { from: owner }), 'Withdrawal is not scheduled')
    })

    it('should allow relayOwner to authorize new relay hub', async function () {
      const { logs } = await stakeManager.authorizeHubByOwner(relayManager, anyRelayHub, { from: owner })
      expectEvent.inLogs(logs, 'HubAuthorized', {
        relayManager,
        relayHub: anyRelayHub
      })
    })

    it('should allow relayManager to authorize new relay hub', async function () {
      const { logs } = await stakeManager.authorizeHubByManager(anyRelayHub, { from: relayManager })
      expectEvent.inLogs(logs, 'HubAuthorized', {
        relayManager,
        relayHub: anyRelayHub
      })
    })

    describe('should not allow not owner to call to', function () {
      it('unlock stake', async function () {
        await expectRevert(stakeManager.unlockStake(relayManager, { from: nonOwner }), 'not owner')
      })
      it('withdraw stake', async function () {
        await expectRevert(stakeManager.withdrawStake(relayManager, { from: nonOwner }), 'not owner')
      })
    })

    describe('should not allow not owner to call to', function () {
      it('authorize hub by owner', async function () {
        await expectRevert(stakeManager.authorizeHubByOwner(relayManager, anyRelayHub, { from: nonOwner }), 'not owner')
      })
      it('unauthorize hub by owner', async function () {
        await expectRevert(stakeManager.unauthorizeHubByOwner(relayManager, anyRelayHub, { from: nonOwner }), 'not owner')
      })
    })

    describe('should not allow not manager to call to', function () {
      it('authorize hub by manager', async function () {
        await expectRevert(stakeManager.authorizeHubByManager(anyRelayHub, { from: nonOwner }), 'not manager')
      })
      it('unauthorize hub by manager', async function () {
        await expectRevert(stakeManager.unauthorizeHubByManager(anyRelayHub, { from: nonOwner }), 'not manager')
      })
    })
  })

  describe('with authorized hub', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      await stakeManager.setRelayManagerOwner(owner, { from: relayManager })
      await stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await stakeManager.authorizeHubByOwner(relayManager, anyRelayHub, { from: owner })
    })

    it('should allow querying relayManager\'s authorized hubs', async function () {
      const authorizedHubWithdrawal = await stakeManager.authorizedHubs(relayManager, anyRelayHub)
      const notAuthorizedHubWithdrawal = await stakeManager.authorizedHubs(relayManager, nonOwner)
      const uint32FF = new BN('f'.repeat(64), 'hex')
      expect(authorizedHubWithdrawal).to.be.bignumber.equal(uint32FF)
      expect(notAuthorizedHubWithdrawal).to.be.bignumber.equal(new BN(0))
    })

    it('should report relayManager stake as valid for the authorized hub', async function () {
      const isRelayManagerStaked = await stakeManager.isRelayManagerStaked(relayManager, anyRelayHub, 0, 0)
      expect(isRelayManagerStaked).to.be.true
    })

    describe('should report relayManager stake as not valid for', function () {
      it('not authorized hub', async function () {
        const isRelayManagerStaked = await stakeManager.isRelayManagerStaked(relayManager, nonOwner, 0, 0)
        expect(isRelayManagerStaked).to.be.false
      })
      it('not staked relayManager', async function () {
        const isRelayManagerStaked = await stakeManager.isRelayManagerStaked(nonOwner, anyRelayHub, 0, 0)
        expect(isRelayManagerStaked).to.be.false
      })
      it('minimum stake amount above actual', async function () {
        const isRelayManagerStaked = await stakeManager.isRelayManagerStaked(relayManager, anyRelayHub, (1e20).toString(), 0)
        expect(isRelayManagerStaked).to.be.false
      })
      it('minimum unstake delay above actual', async function () {
        const isRelayManagerStaked = await stakeManager.isRelayManagerStaked(relayManager, anyRelayHub, 0, 1e10)
        expect(isRelayManagerStaked).to.be.false
      })
    })

    it('should not allow to penalize for more than the relayManager stake', async function () {
      await expectRevert(
        stakeManager.penalizeRelayManager(relayManager, nonOwner, initialStake.muln(2), { from: anyRelayHub }),
        'penalty exceeds stake'
      )
    })

    testCanPenalize()

    it('should allow relayOwner to unauthorize an authorized hub', async function () {
      const { logs, receipt } = await stakeManager.unauthorizeHubByOwner(relayManager, anyRelayHub, { from: owner })
      const removalBlock = initialUnstakeDelay.addn(receipt.blockNumber)
      expectEvent.inLogs(logs, 'HubUnauthorized', {
        relayManager,
        relayHub: anyRelayHub,
        removalBlock
      })
    })

    it('should allow relayManager to unauthorize an authorized hub', async function () {
      const { logs, receipt } = await stakeManager.unauthorizeHubByManager(anyRelayHub, { from: relayManager })
      const removalBlock = initialUnstakeDelay.addn(receipt.blockNumber)
      expectEvent.inLogs(logs, 'HubUnauthorized', {
        relayManager,
        relayHub: anyRelayHub,
        removalBlock
      })
    })

    it('should not allow owner to unauthorize non-authorized hub', async function () {
      await expectRevert(stakeManager.unauthorizeHubByOwner(relayManager, nonOwner, { from: owner }), 'hub not authorized')
    })

    it('should allow owner to schedule stake unlock', async function () {
      const { logs, receipt } = await stakeManager.unlockStake(relayManager, { from: owner })
      const withdrawBlock = initialUnstakeDelay.addn(receipt.blockNumber)
      expectEvent.inLogs(logs, 'StakeUnlocked', {
        relayManager,
        owner,
        withdrawBlock
      })
    })
  })

  describe('with scheduled deauthorization of an authorized hub', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      await stakeManager.setRelayManagerOwner(owner, { from: relayManager })
      await stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await stakeManager.authorizeHubByOwner(relayManager, anyRelayHub, { from: owner })
      await stakeManager.unauthorizeHubByOwner(relayManager, anyRelayHub, { from: owner })
    })

    testCanPenalize()

    it('should not allow owner to unauthorize hub again', async function () {
      await expectRevert(stakeManager.unauthorizeHubByOwner(relayManager, anyRelayHub, { from: owner }), 'hub not authorized')
    })

    describe('after grace period elapses', function () {
      beforeEach(async function () {
        await evmMineMany(initialUnstakeDelay.toNumber())
      })

      it('should not allow to penalize hub', async function () {
        await expectRevert(
          stakeManager.penalizeRelayManager(relayManager, nonOwner, initialStake, { from: anyRelayHub }),
          'hub authorization expired'
        )
      })
    })
  })

  describe('with scheduled unlock while hub still authorized', function () {
    beforeEach(async function () {
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      await stakeManager.setRelayManagerOwner(owner, { from: relayManager })
      await stakeManager.stakeForRelayManager(relayManager, initialUnstakeDelay, {
        value: initialStake,
        from: owner
      })
      await stakeManager.authorizeHubByOwner(relayManager, anyRelayHub, { from: owner })
      await stakeManager.unlockStake(relayManager, { from: owner })
    })

    testStakeNotValid()
    it('should not allow owner to schedule unlock again', async function () {
      await expectRevert(
        stakeManager.unlockStake(relayManager, { from: owner }),
        'already pending'
      )
    })

    it('should not allow owner to withdraw stakes before it is due', async function () {
      await expectRevert(stakeManager.withdrawStake(relayManager, { from: owner }), 'Withdrawal is not due')
    })

    testCanPenalize()

    it('should allow to withdraw stake after unstakeDelay', async function () {
      await evmMineMany(initialUnstakeDelay.toNumber())
      const relayOwnerBalanceTracker = await balance.tracker(owner)
      const stakeManagerBalanceTracker = await balance.tracker(stakeManager.address)

      const gasPrice = 10
      const res = await stakeManager.withdrawStake(relayManager, {
        from: owner,
        gasPrice: 10
      })
      expectEvent.inLogs(res.logs, 'StakeWithdrawn', {
        relayManager,
        amount: initialStake
      })

      const relayOwnerGain = await relayOwnerBalanceTracker.delta()
      const stakeManagerLoss = await stakeManagerBalanceTracker.delta()
      expect(relayOwnerGain).to.be.bignumber.equal(initialStake.subn(gasPrice * res.receipt.gasUsed))
      expect(stakeManagerLoss).to.be.bignumber.equal(initialStake.neg())
    })

    describe('with stake withdrawn', function () {
      beforeEach(async function () {
        await evmMineMany(initialUnstakeDelay.toNumber())
        await stakeManager.withdrawStake(relayManager, { from: owner })
      })

      it('should remove stake, unstake delay of removed relayManager, but remember the owner', async function () {
        // @ts-ignore (typechain does not declare names or iterator for return types)
        const { stake: actualStake, unstakeDelay: actualUnstakeDelay, withdrawBlock: actualBlock, owner: actualOwner } =
          await stakeManager.stakes(relayManager)
        // relay owner and unstake delay are kept
        expect(actualOwner).to.equal(owner)
        expect(actualUnstakeDelay).to.be.bignumber.equal(initialUnstakeDelay)

        // staked amount and withdrawal block are reset
        expect(actualStake).to.be.bignumber.equal(new BN(0))
        expect(actualBlock).to.be.bignumber.equal(new BN(0))
      })

      testNotOwnerCannotStake()

      testOwnerCanStake()
    })
  })
})
