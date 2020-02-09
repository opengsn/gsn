const { balance, BN, constants, ether, expectEvent, expectRevert, send, time } = require('@openzeppelin/test-helpers')
const { ZERO_ADDRESS } = constants

const { getEip712Signature, getRelayRequest } = require('../src/js/relayclient/utils')

const RelayHub = artifacts.require('RelayHub')
const SampleRecipient = artifacts.require('./test/TestRecipient')
const TestSponsor = artifacts.require('./test/TestSponsorEverythingAccepted')
const TestSponsorStoreContext = artifacts.require('./test/TestSponsorStoreContext')
const TestSponsorConfigurableMisbehavior = artifacts.require('./test/TestSponsorConfigurableMisbehavior')

const { expect } = require('chai')

contract('RelayHub', function ([_, relayOwner, relay, otherRelay, sender, other, dest]) { // eslint-disable-line no-unused-vars
  const RelayCallStatusCodes = {
    OK: new BN('0'),
    RelayedCallFailed: new BN('1'),
    PreRelayedFailed: new BN('2'),
    PostRelayedFailed: new BN('3'),
    RecipientBalanceChanged: new BN('4')
  }

  const PreconditionCheck = {
    OK: new BN('0'),
    WrongSignature: new BN('1'),
    WrongNonce: new BN('2'),
    AcceptRelayedCallReverted: new BN('3'),
    InvalidRecipientStatusCode: new BN('4')
  }

  let relayHub
  let recipient
  let gasSponsor

  beforeEach(async function () {
    relayHub = await RelayHub.new({ gas: 8000000 })
    recipient = await SampleRecipient.new()
    gasSponsor = await TestSponsor.new()
    await recipient.setHub(relayHub.address)
    await gasSponsor.setHub(relayHub.address)
  })

  describe('balances', function () {
    async function testDeposit (sender, sponsor, amount) {
      const senderBalanceTracker = await balance.tracker(sender)
      const relayHubBalanceTracker = await balance.tracker(relayHub.address)

      const { logs } = await relayHub.depositFor(sponsor, { from: sender, value: amount, gasPrice: 0 })
      expectEvent.inLogs(logs, 'Deposited', { sponsor, from: sender, amount })

      expect(await relayHub.balanceOf(sponsor)).to.be.bignumber.equals(amount)
      expect(await senderBalanceTracker.delta()).to.be.bignumber.equals(amount.neg())
      expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equals(amount)
    }

    it('can deposit for self', async function () {
      await testDeposit(other, other, ether('1'))
    })

    it('can deposit for others', async function () {
      await testDeposit(other, recipient.address, ether('1'))
    })

    it('cannot deposit amounts larger than the limit', async function () {
      await expectRevert(
        relayHub.depositFor(recipient.address, { from: other, value: ether('3'), gasPrice: 0 }),
        'deposit too big'
      )
    })

    it('can deposit multiple times and have a total deposit larger than the limit', async function () {
      await relayHub.depositFor(recipient.address, { from: other, value: ether('1'), gasPrice: 0 })
      await relayHub.depositFor(recipient.address, { from: other, value: ether('1'), gasPrice: 0 })
      await relayHub.depositFor(recipient.address, { from: other, value: ether('1'), gasPrice: 0 })

      expect(await relayHub.balanceOf(recipient.address)).to.be.bignumber.equals(ether('3'))
    })

    it('accounts with deposits can withdraw partially', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHub.withdraw(amount.divn(2), dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', { account: other, dest, amount: amount.divn(2) })
    })

    it('accounts with deposits can withdraw all their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHub.withdraw(amount, dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', { account: other, dest, amount })
    })

    it('accounts cannot withdraw more than their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      await expectRevert(relayHub.withdraw(amount.addn(1), dest, { from: other }), 'insufficient funds')
    })
  })

  describe('canRelay & relayCall', function () {
    context('with staked and registered relay', function () {
      const unstakeDelay = time.duration.weeks(4)

      const url = 'http://relay.com'
      const fee = new BN('10') // 10%

      beforeEach(async function () {
        await relayHub.stake(relay, unstakeDelay, { value: ether('2'), from: relayOwner })

        await relayHub.registerRelay(fee, url, { from: relay })
      })

      const message = 'GSN RelayHub'

      const gasPrice = new BN('10')
      const gasLimit = new BN('1000000')
      const senderNonce = new BN('0')

      let txData

      // TODO: this is a piece of legacy structure of this test suite. The signature could afford to be static
      //  throughout the test as there were no moving parts signed. Using multiple sponsors breaks it. Fix later.
      let sharedSigValues
      beforeEach(async function () {
        // truffle-contract doesn't let us create method data from the class, we need an actual instance
        txData = recipient.contract.methods.emitMessage(message).encodeABI()
        sharedSigValues = {
          web3,
          senderAccount: sender,
          senderNonce: senderNonce.toString(),
          target: recipient.address,
          encodedFunction: txData,
          pctRelayFee: fee.toString(),
          gasPrice: gasPrice.toString(),
          gasLimit: gasLimit.toString(),
          relayHub: relayHub.address,
          relayAddress: relay
        }
      })

      context('with funded recipient', function () {
        let gasSponsorWithContext
        let misbehavingSponsor
        let signatureWithContextSponsor
        let signatureWithMisbehavingSponsor
        beforeEach(async function () {
          gasSponsorWithContext = await TestSponsorStoreContext.new()
          misbehavingSponsor = await TestSponsorConfigurableMisbehavior.new()
          await gasSponsorWithContext.setHub(relayHub.address)
          await misbehavingSponsor.setHub(relayHub.address)
          await relayHub.depositFor(gasSponsorWithContext.address, { value: ether('1'), from: other })
          await relayHub.depositFor(misbehavingSponsor.address, { value: ether('1'), from: other })

          signatureWithMisbehavingSponsor = (await getEip712Signature({
            ...sharedSigValues,
            gasSponsor: misbehavingSponsor.address
          })).signature

          signatureWithContextSponsor = (await getEip712Signature({
            ...sharedSigValues,
            gasSponsor: gasSponsorWithContext.address
          })).signature
        })

        it('preRelayedCall receives values returned in acceptRelayedCall', async function () {
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsorWithContext.address)
          const { tx } = await relayHub.relayCall(relayRequest, signatureWithContextSponsor, '0x', {
            from: relay,
            gasPrice,
            gasLimit
          })

          const maxPossibleCharge = await relayHub.maxPossibleCharge(gasLimit, gasPrice, fee)

          await expectEvent.inTransaction(tx, TestSponsorStoreContext, 'SampleRecipientPreCallWithValues', {
            relay,
            from: sender,
            encodedFunction: txData,
            transactionFee: fee,
            gasPrice,
            gasLimit,
            nonce: senderNonce,
            approvalData: null,
            maxPossibleCharge
          })
        })

        it('postRelayedCall receives values returned in acceptRelayedCall', async function () {
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsorWithContext.address)
          const { tx } = await relayHub.relayCall(relayRequest, signatureWithContextSponsor, '0x', {
            from: relay,
            gasPrice,
            gasLimit
          })

          const maxPossibleCharge = await relayHub.maxPossibleCharge(gasLimit, gasPrice, fee)

          await expectEvent.inTransaction(tx, TestSponsorStoreContext, 'SampleRecipientPostCallWithValues', {
            relay,
            from: sender,
            encodedFunction: txData,
            transactionFee: fee,
            gasPrice,
            gasLimit,
            nonce: senderNonce,
            approvalData: null,
            maxPossibleCharge
          })
        })

        it('relaying is aborted if the recipient returns an invalid status code', async function () {
          await misbehavingSponsor.setReturnInvalidErrorCode(true)
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, misbehavingSponsor.address)
          const { logs } = await relayHub.relayCall(relayRequest, signatureWithMisbehavingSponsor, '0x', {
            from: relay,
            gasPrice,
            gasLimit
          })

          expectEvent.inLogs(logs, 'CanRelayFailed', { reason: PreconditionCheck.InvalidRecipientStatusCode })
        })

        describe('recipient balance withdrawal ban', function () {
          let signature
          let misbehavingSponsor
          beforeEach(async function () {
            misbehavingSponsor = await TestSponsorConfigurableMisbehavior.new()
            await misbehavingSponsor.setHub(relayHub.address)
            await relayHub.depositFor(misbehavingSponsor.address, { value: ether('1'), from: other })
            const eip712Sig = await getEip712Signature({
              ...sharedSigValues,
              gasSponsor: misbehavingSponsor.address
            })
            signature = eip712Sig.signature
          })

          it('reverts relayed call if recipient withdraws balance during preRelayedCall', async function () {
            await misbehavingSponsor.setWithdrawDuringPreRelayedCall(true)
            await assertRevertWithRecipientBalanceChanged()
          })

          it('reverts relayed call if recipient withdraws balance during the relayed call', async function () {
            await recipient.setWithdrawDuringRelayedCall(misbehavingSponsor.address)
            await assertRevertWithRecipientBalanceChanged()
          })

          it('reverts relayed call if recipient withdraws balance during postRelayedCall', async function () {
            await misbehavingSponsor.setWithdrawDuringPostRelayedCall(true)
            await assertRevertWithRecipientBalanceChanged()
          })

          async function assertRevertWithRecipientBalanceChanged () {
            const relayRequest = getRelayRequest(
              sender, recipient.address, txData,
              fee, gasPrice, gasLimit, senderNonce,
              relay, misbehavingSponsor.address
            )
            const { logs } = await relayHub.relayCall(relayRequest, signature, '0x', {
              from: relay,
              gasPrice,
              gasLimit
            })
            expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.RecipientBalanceChanged })
          }
        })
      })
    })
  })
})
