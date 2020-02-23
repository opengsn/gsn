const { balance, BN, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

const { getEip712Signature, getRelayRequest, getTransactionGasData } = require('../src/js/relayclient/utils')

const RelayHub = artifacts.require('RelayHub')
const TestSponsor = artifacts.require('./test/TestSponsorEverythingAccepted')
const TestRecipient = artifacts.require('./test/TestRecipient')
const TestSponsorStoreContext = artifacts.require('./test/TestSponsorStoreContext')
const TestSponsorConfigurableMisbehavior = artifacts.require('./test/TestSponsorConfigurableMisbehavior')

const { expect } = require('chai')

const GTXDATANONZERO = 68

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
    relayHub = await RelayHub.new(68, { gas: 10000000 })
    recipient = await TestRecipient.new()
    gasSponsor = await TestSponsor.new()
    await recipient.setHub(relayHub.address)
    await gasSponsor.setHub(relayHub.address)
  })

  it('should retrieve version number', async function () {
    const version = await relayHub.version()
    assert.equal(version, '1.0.0')
  })

  describe('balances', function () {
    async function testDeposit (sender, sponsor, amount) {
      const senderBalanceTracker = await balance.tracker(sender)
      const relayHubBalanceTracker = await balance.tracker(relayHub.address)

      const { logs } = await relayHub.depositFor(sponsor, {
        from: sender,
        value: amount,
        gasPrice: 0
      })
      expectEvent.inLogs(logs, 'Deposited', {
        sponsor,
        from: sender,
        amount
      })

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
        relayHub.depositFor(recipient.address, {
          from: other,
          value: ether('3'),
          gasPrice: 0
        }),
        'deposit too big'
      )
    })

    it('can deposit multiple times and have a total deposit larger than the limit', async function () {
      await relayHub.depositFor(recipient.address, {
        from: other,
        value: ether('1'),
        gasPrice: 0
      })
      await relayHub.depositFor(recipient.address, {
        from: other,
        value: ether('1'),
        gasPrice: 0
      })
      await relayHub.depositFor(recipient.address, {
        from: other,
        value: ether('1'),
        gasPrice: 0
      })

      expect(await relayHub.balanceOf(recipient.address)).to.be.bignumber.equals(ether('3'))
    })

    it('accounts with deposits can withdraw partially', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHub.withdraw(amount.divn(2), dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', {
        account: other,
        dest,
        amount: amount.divn(2)
      })
    })

    it('accounts with deposits can withdraw all their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHub.withdraw(amount, dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', {
        account: other,
        dest,
        amount
      })
    })

    it('accounts cannot withdraw more than their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      await expectRevert(relayHub.withdraw(amount.addn(1), dest, { from: other }), 'insufficient funds')
    })
  })

  describe('canRelay & relayCall', function () {
    const fee = new BN('10') // 10%
    const gasPrice = new BN('10')
    const gasLimit = new BN('1000000')
    const senderNonce = new BN('0')
    let sharedSigValues

    beforeEach(function () {
      sharedSigValues = {
        web3,
        senderAccount: sender,
        senderNonce: senderNonce.toString(),
        target: recipient.address,
        pctRelayFee: fee.toString(),
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        relayHub: relayHub.address,
        relayAddress: relay
      }
    })

    context('with unknown address trying to relay', async function () {
      it('should not accept a relay call', async function () {
        const relayRequest = getRelayRequest(sender, recipient.address, '0xdeadbeef', fee, gasPrice, gasLimit, senderNonce, relay, gasSponsor.address)
        await expectRevert(
          relayHub.relayCall(relayRequest, '0xdeadbeef', '0x', {
            from: relay,
            gasPrice
          }),
          'Unknown relay')
      })
    })

    context('with staked and registered relay', function () {
      const unstakeDelay = time.duration.weeks(4)

      const url = 'http://relay.com'

      beforeEach(async function () {
        await relayHub.stake(relay, unstakeDelay, {
          value: ether('2'),
          from: relayOwner
        })

        await relayHub.registerRelay(fee, url, { from: relay })
      })

      const message = 'GSN RelayHub'
      const messageWithNoParams = 'Method with no parameters'

      let txData

      // TODO: this is a piece of legacy structure of this test suite. The signature could afford to be static
      //  throughout the test as there were no moving parts signed. Using multiple sponsors breaks it. Fix later.
      let signatureWithPermissiveSponsor
      beforeEach(async function () {
        // truffle-contract doesn't let us create method data from the class, we need an actual instance
        txData = recipient.contract.methods.emitMessage(message).encodeABI()
        sharedSigValues.encodedFunction = txData
        signatureWithPermissiveSponsor = (await getEip712Signature({
          ...sharedSigValues,
          gasSponsor: gasSponsor.address
        })).signature
        await relayHub.depositFor(gasSponsor.address, {
          value: ether('1'),
          from: other
        })
      })

      context('with view functions only', async function () {
        const sharedTransactionData = {
          relayCallGasLimit: '1000000',
          calldataSize: '123',
          gtxdatanonzero: GTXDATANONZERO
        }
        it('should get \'0\' (Success Code) from \'canRelay\' for a valid transaction', async function () {
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsor.address)
          const gasLimits = await getTransactionGasData({
            gasSponsor,
            relayHub,
            ...sharedTransactionData
          })
          const canRelay = await relayHub.canRelay(
            relayRequest,
            gasLimits.maxPossibleGas,
            gasLimits.acceptRelayedCallGasLimit,
            signatureWithPermissiveSponsor, '0x')
          assert.equal(0, canRelay.status.valueOf())
        })

        it('should get \'1\' (Wrong Signature) from \'canRelay\' for a transaction with a wrong signature', async function () {
          const wrongSig = '0xaaaa6ad4b4fab03bb2feaea2d54c690206e40036e4baa930760e72479da0cc5575779f9db9ef801e144b5e6af48542107f2f094649334b030e2bb44f054429b451'
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsor.address)
          const gasLimits = await getTransactionGasData({
            gasSponsor,
            relayHub,
            ...sharedTransactionData
          })
          const canRelay = await relayHub.canRelay(relayRequest,
            gasLimits.maxPossibleGas,
            gasLimits.acceptRelayedCallGasLimit,
            wrongSig, '0x')
          assert.equal(1, canRelay.status.valueOf())
        })

        it('should get \'2\' (Wrong Nonce) from \'canRelay\' for a transaction with a wrong nonce', async function () {
          const wrongNonce = '777'
          const sig = (await getEip712Signature({
            ...Object.assign({}, sharedSigValues, { senderNonce: wrongNonce }),
            gasSponsor: gasSponsor.address
          })).signature
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, wrongNonce, relay, gasSponsor.address)
          const gasLimits = await getTransactionGasData({
            gasSponsor,
            relayHub,
            ...sharedTransactionData
          })

          const canRelay = await relayHub.canRelay(
            relayRequest,
            gasLimits.maxPossibleGas,
            gasLimits.acceptRelayedCallGasLimit,
            sig, '0x')
          assert.equal(2, canRelay.status.valueOf())
        })
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
          await relayHub.depositFor(gasSponsorWithContext.address, {
            value: ether('1'),
            from: other
          })
          await relayHub.depositFor(misbehavingSponsor.address, {
            value: ether('1'),
            from: other
          })

          signatureWithMisbehavingSponsor = (await getEip712Signature({
            ...sharedSigValues,
            gasSponsor: misbehavingSponsor.address
          })).signature

          signatureWithContextSponsor = (await getEip712Signature({
            ...sharedSigValues,
            gasSponsor: gasSponsorWithContext.address
          })).signature
        })

        it('relayCall executes the transaction and increments sender nonce on hub', async function () {
          const nonceBefore = await relayHub.getNonce(sender)

          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsor.address)
          const { tx } = await relayHub.relayCall(relayRequest, signatureWithPermissiveSponsor, '0x', {
            from: relay,
            gasPrice
          })
          const nonceAfter = await relayHub.getNonce(sender)
          assert.equal(nonceBefore.toNumber() + 1, nonceAfter.toNumber())

          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message,
            realSender: sender,
            msgSender: relayHub.address,
            origin: relay
          })
        })

        // This test is added due to a regression that almost slipped to production.
        it('relayCall executes the transaction with no parameters', async function () {
          const txData = recipient.contract.methods.emitMessageNoParams().encodeABI()
          const signature = (await getEip712Signature({
            ...sharedSigValues,
            encodedFunction: txData,
            gasSponsor: gasSponsor.address
          })).signature
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsor.address)
          const { tx } = await relayHub.relayCall(relayRequest, signature, '0x', {
            from: relay,
            gasPrice
          })
          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message: messageWithNoParams,
            realSender: sender,
            msgSender: relayHub.address,
            origin: relay
          })
        })

        it('preRelayedCall receives values returned in acceptRelayedCall', async function () {
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsorWithContext.address)
          const { tx } = await relayHub.relayCall(relayRequest, signatureWithContextSponsor, '0x', {
            from: relay,
            gasPrice
          })

          await expectEvent.inTransaction(tx, TestSponsorStoreContext, 'SampleRecipientPreCallWithValues', {
            relay,
            from: sender,
            encodedFunction: txData,
            transactionFee: fee,
            gasPrice,
            gasLimit,
            nonce: senderNonce,
            approvalData: null
          })
        })

        it('postRelayedCall receives values returned in acceptRelayedCall', async function () {
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsorWithContext.address)
          const { tx } = await relayHub.relayCall(relayRequest, signatureWithContextSponsor, '0x', {
            from: relay,
            gasPrice
          })

          await expectEvent.inTransaction(tx, TestSponsorStoreContext, 'SampleRecipientPostCallWithValues', {
            relay,
            from: sender,
            encodedFunction: txData,
            transactionFee: fee,
            gasPrice,
            gasLimit,
            nonce: senderNonce,
            approvalData: null
          })
        })

        it('relaying is aborted if the recipient returns an invalid status code', async function () {
          await misbehavingSponsor.setReturnInvalidErrorCode(true)
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, misbehavingSponsor.address)
          const { logs } = await relayHub.relayCall(relayRequest, signatureWithMisbehavingSponsor, '0x', {
            from: relay,
            gasPrice
          })

          expectEvent.inLogs(logs, 'CanRelayFailed', { reason: PreconditionCheck.InvalidRecipientStatusCode })
        })

        it('should not accept relay requests if gas limit is too low for a relayed transaction', async function () {
          // Adding gasReserve is not enough by a few wei as some gas is spent before gasleft().
          const gasReserve = 99999
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, misbehavingSponsor.address)
          await expectRevert(
            relayHub.relayCall(relayRequest, signatureWithMisbehavingSponsor, '0x', {
              from: relay,
              gasPrice,
              gas: gasLimit.toNumber() + gasReserve
            }),
            'Not enough gas left for recipientCallsAtomic to complete')
        })

        it('should not accept relay requests with gas price lower then user specified', async function () {
          // Adding gasReserve is not enough by a few wei as some gas is spent before gasleft().
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, misbehavingSponsor.address)
          await expectRevert(
            relayHub.relayCall(relayRequest, signatureWithMisbehavingSponsor, '0x', {
              from: relay,
              gasPrice: gasPrice.toNumber() - 1
            }),
            'Invalid gas price')
        })

        it('should not accept relay requests if destination recipient doesn\'t have a balance to pay for it', async function () {
          const gasSponsor2 = await TestSponsor.new()
          await gasSponsor2.setHub(relayHub.address)
          const maxPossibleCharge = (await relayHub.calculateCharge(gasLimit, gasPrice, fee)).toNumber()
          await gasSponsor2.deposit({ value: maxPossibleCharge - 1 }) // TODO: replace with correct margin calculation
          const relayRequest = getRelayRequest(sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, gasSponsor2.address)
          await expectRevert(
            relayHub.relayCall(relayRequest, signatureWithMisbehavingSponsor, '0x', {
              from: relay,
              gasPrice
            }),
            'Sponsor balance too low')
        })

        it('should not execute the \'relayedCall\' if \'preRelayedCall\' reverts', async function () {
          await misbehavingSponsor.setRevertPreRelayCall(true)
          const startBlock = await web3.eth.getBlockNumber()

          const relayRequest = getRelayRequest(
            sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, misbehavingSponsor.address)
          const { logs } = await relayHub.relayCall(relayRequest, signatureWithMisbehavingSponsor, '0x', {
            from: relay,
            gasPrice: gasPrice
          })

          // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
          const logsMessages = await recipient.contract.getPastEvents('SampleRecipientEmitted', {
            fromBlock: startBlock,
            toBlock: 'latest'
          })
          assert.equal(0, logsMessages.length)
          expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.PreRelayedFailed })
        })

        it('should revert the \'relayedCall\' if \'postRelayedCall\' reverts', async function () {
          await misbehavingSponsor.setRevertPostRelayCall(true)
          const relayRequest = getRelayRequest(
            sender, recipient.address, txData, fee, gasPrice, gasLimit, senderNonce, relay, misbehavingSponsor.address)
          const { logs } = await relayHub.relayCall(relayRequest, signatureWithMisbehavingSponsor, '0x', {
            from: relay,
            gasPrice: gasPrice
          })

          const startBlock = await web3.eth.getBlockNumber()
          // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
          const logsMessages = await recipient.contract.getPastEvents('SampleRecipientEmitted', {
            fromBlock: startBlock,
            toBlock: 'latest'
          })
          assert.equal(0, logsMessages.length)
          expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.PostRelayedFailed })
        })

        describe('recipient balance withdrawal ban', function () {
          let signature
          let misbehavingSponsor
          beforeEach(async function () {
            misbehavingSponsor = await TestSponsorConfigurableMisbehavior.new()
            await misbehavingSponsor.setHub(relayHub.address)
            await relayHub.depositFor(misbehavingSponsor.address, {
              value: ether('1'),
              from: other
            })
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
              gasPrice
            })
            expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.RecipientBalanceChanged })
          }
        })
      })
    })
  })
})
