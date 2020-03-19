const { balance, BN, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

const { getEip712Signature, calculateTransactionMaxPossibleGas } =
  require('../src/js/relayclient/utils')
const RelayRequest = require('../src/js/relayclient/EIP712/RelayRequest')

const RelayHub = artifacts.require('RelayHub')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted')
const TestRecipient = artifacts.require('./test/TestRecipient')
const TestPaymasterStoreContext = artifacts.require('./test/TestPaymasterStoreContext')
const TestPaymasterConfigurableMisbehavior = artifacts.require('./test/TestPaymasterConfigurableMisbehavior')

const { expect } = require('chai')
const Environments = require('../src/js/relayclient/Environments')

contract('RelayHub', function ([_, relayOwner, relayAddress, __, senderAddress, other, dest]) { // eslint-disable-line no-unused-vars
  const RelayCallStatusCodes = {
    OK: new BN('0'),
    RelayedCallFailed: new BN('1'),
    PreRelayedFailed: new BN('2'),
    PostRelayedFailed: new BN('3'),
    RecipientBalanceChanged: new BN('4')
  }

  const CanRelayStatus = {
    OK: new BN('0'),
    WrongSignature: new BN('1'),
    WrongNonce: new BN('2'),
    AcceptRelayedCallReverted: new BN('3'),
    InvalidRecipientStatusCode: new BN('4')
  }
  const chainId = Environments.defEnv.chainId

  let relayHub
  let relayHubContract
  let recipientContract
  let paymasterContract
  let target
  let paymaster

  beforeEach(async function () {
    relayHubContract = await RelayHub.new(Environments.defEnv.gtxdatanonzero, { gas: 10000000 })
    paymasterContract = await TestPaymasterEverythingAccepted.new()
    recipientContract = await TestRecipient.new()

    target = recipientContract.address
    paymaster = paymasterContract.address
    relayHub = relayHubContract.address

    await recipientContract.setHub(relayHub)
    await paymasterContract.setHub(relayHub)
  })

  it('should retrieve version number', async function () {
    const version = await relayHubContract.version()
    assert.equal(version, '1.0.0')
  })

  describe('balances', function () {
    async function testDeposit (sender, paymaster, amount) {
      const senderBalanceTracker = await balance.tracker(sender)
      const relayHubBalanceTracker = await balance.tracker(relayHub)

      const { logs } = await relayHubContract.depositFor(paymaster, {
        from: sender,
        value: amount,
        gasPrice: 0
      })
      expectEvent.inLogs(logs, 'Deposited', {
        paymaster,
        from: sender,
        amount
      })

      expect(await relayHubContract.balanceOf(paymaster)).to.be.bignumber.equals(amount)
      expect(await senderBalanceTracker.delta()).to.be.bignumber.equals(amount.neg())
      expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equals(amount)
    }

    it('can deposit for self', async function () {
      await testDeposit(other, other, ether('1'))
    })

    it('can deposit for others', async function () {
      await testDeposit(other, target, ether('1'))
    })

    it('cannot deposit amounts larger than the limit', async function () {
      await expectRevert(
        relayHubContract.depositFor(target, {
          from: other,
          value: ether('3'),
          gasPrice: 0
        }),
        'deposit too big'
      )
    })

    it('can deposit multiple times and have a total deposit larger than the limit', async function () {
      await relayHubContract.depositFor(target, {
        from: other,
        value: ether('1'),
        gasPrice: 0
      })
      await relayHubContract.depositFor(target, {
        from: other,
        value: ether('1'),
        gasPrice: 0
      })
      await relayHubContract.depositFor(target, {
        from: other,
        value: ether('1'),
        gasPrice: 0
      })

      expect(await relayHubContract.balanceOf(target)).to.be.bignumber.equals(ether('3'))
    })

    it('accounts with deposits can withdraw partially', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHubContract.withdraw(amount.divn(2), dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', {
        account: other,
        dest,
        amount: amount.divn(2)
      })
    })

    it('accounts with deposits can withdraw all their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      const { logs } = await relayHubContract.withdraw(amount, dest, { from: other })
      expectEvent.inLogs(logs, 'Withdrawn', {
        account: other,
        dest,
        amount
      })
    })

    it('accounts cannot withdraw more than their balance', async function () {
      const amount = ether('1')
      await testDeposit(other, other, amount)

      await expectRevert(relayHubContract.withdraw(amount.addn(1), dest, { from: other }), 'insufficient funds')
    })
  })

  describe('canRelay & relayCall', function () {
    const baseRelayFee = '10000'
    const pctRelayFee = '10'
    const gasPrice = '10'
    const gasLimit = '1000000'
    const senderNonce = '0'
    let sharedRelayRequestData

    beforeEach(function () {
      sharedRelayRequestData = {
        senderAddress,
        senderNonce,
        target,
        pctRelayFee,
        baseRelayFee,
        gasPrice,
        gasLimit,
        relayAddress,
        paymaster
      }
    })

    context('with unknown address trying to relay', async function () {
      it('should not accept a relay call', async function () {
        const relayRequest = new RelayRequest(
          {
            encodedFunction: '0xdeadbeef',
            ...sharedRelayRequestData
          })
        await expectRevert(
          relayHubContract.relayCall(relayRequest, '0xdeadbeef', '0x', {
            from: relayAddress,
            gasPrice
          }),
          'Unknown relay')
      })
    })

    context('with staked and registered relay', function () {
      const unstakeDelay = time.duration.weeks(4)
      const url = 'http://relay.com'
      const message = 'GSN RelayHub'
      const messageWithNoParams = 'Method with no parameters'

      let relayRequest
      let encodedFunction
      let signatureWithPermissivePaymaster

      beforeEach(async function () {
        await relayHubContract.stake(relayAddress, unstakeDelay, {
          value: ether('2'),
          from: relayOwner
        })

        // truffle-contract doesn't let us create method data from the class, we need an actual instance
        encodedFunction = recipientContract.contract.methods.emitMessage(message).encodeABI()

        await relayHubContract.registerRelay(baseRelayFee, pctRelayFee, url, { from: relayAddress })
        relayRequest = new RelayRequest({
          ...sharedRelayRequestData,
          encodedFunction
        });

        ({ signature: signatureWithPermissivePaymaster } = await getEip712Signature({
          web3,
          chainId,
          relayHub,
          relayRequest
        }))

        await relayHubContract.depositFor(paymaster, {
          value: ether('1'),
          from: other
        })
      })

      context('with view functions only', async function () {
        let acceptRelayedCallGasLimit
        let maxPossibleGas

        beforeEach(async function () {
          const gasLimits = await paymasterContract.getGasLimits()
          const hubOverhead = (await relayHubContract.getHubOverhead()).toNumber()

          acceptRelayedCallGasLimit = gasLimits.acceptRelayedCallGasLimit

          maxPossibleGas = await calculateTransactionMaxPossibleGas(
            {
              gasLimits,
              hubOverhead,
              relayCallGasLimit: '1000000',
              calldataSize: '123',
              gtxdatanonzero: Environments.defEnv.gtxdatanonzero
            }
          )
        })

        it('should get \'0\' (Success Code) from \'canRelay\' for a valid transaction', async function () {
          const canRelay = await relayHubContract.canRelay(
            relayRequest,
            maxPossibleGas,
            acceptRelayedCallGasLimit,
            signatureWithPermissivePaymaster, '0x')
          assert.equal(0, canRelay.status.valueOf())
        })

        it('should get \'1\' (Wrong Signature) from \'canRelay\' for a transaction with a wrong signature', async function () {
          const wrongSig = '0xaaaa6ad4b4fab03bb2feaea2d54c690206e40036e4baa930760e72479da0cc5575779f9db9ef801e144b5e6af48542107f2f094649334b030e2bb44f054429b451'
          const canRelay = await relayHubContract.canRelay(relayRequest,
            maxPossibleGas,
            acceptRelayedCallGasLimit,
            wrongSig, '0x')
          assert.equal(1, canRelay.status.valueOf())
        })

        it('should get \'2\' (Wrong Nonce) from \'canRelay\' for a transaction with a wrong nonce', async function () {
          const wrongNonce = '777'

          const relayRequestWrongNonce = relayRequest.clone()
          relayRequestWrongNonce.relayData.senderNonce = wrongNonce

          const { signature } = await getEip712Signature({
            web3,
            chainId,
            relayHub: relayHub,
            relayRequest: relayRequestWrongNonce
          })

          const canRelay = await relayHubContract.canRelay(
            relayRequestWrongNonce,
            maxPossibleGas,
            acceptRelayedCallGasLimit,
            signature,
            '0x')
          assert.equal(2, canRelay.status.valueOf())
        })
      })

      context('with funded recipient', function () {
        let signature

        let paymasterWithContext
        let misbehavingPaymaster

        let relayRequestPaymasterWithContext
        let signatureWithContextPaymaster

        let signatureWithMisbehavingPaymaster
        let relayRequestMisbehavingPaymaster

        beforeEach(async function () {
          paymasterWithContext = await TestPaymasterStoreContext.new()
          misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
          await paymasterWithContext.setHub(relayHub)
          await misbehavingPaymaster.setHub(relayHub)
          await relayHubContract.depositFor(paymasterWithContext.address, {
            value: ether('1'),
            from: other
          })
          await relayHubContract.depositFor(misbehavingPaymaster.address, {
            value: ether('1'),
            from: other
          });

          ({ signature } = await getEip712Signature({
            web3,
            chainId,
            relayHub: relayHub,
            relayRequest: relayRequest
          }))

          relayRequestMisbehavingPaymaster = relayRequest.clone()
          relayRequestMisbehavingPaymaster.relayData.paymaster = misbehavingPaymaster.address;

          ({ signature: signatureWithMisbehavingPaymaster } = await getEip712Signature({
            web3,
            chainId,
            relayHub: relayHub,
            relayRequest: relayRequestMisbehavingPaymaster
          }))

          relayRequestPaymasterWithContext = relayRequest.clone()
          relayRequestPaymasterWithContext.relayData.paymaster = paymasterWithContext.address;
          ({ signature: signatureWithContextPaymaster } = await getEip712Signature({
            web3,
            chainId,
            relayHub: relayHub,
            relayRequest: relayRequestPaymasterWithContext
          }))
        })

        it('relayCall executes the transaction and increments sender nonce on hub', async function () {
          const nonceBefore = await relayHubContract.getNonce(senderAddress)

          const { tx } = await relayHubContract.relayCall(relayRequest, signatureWithPermissivePaymaster, '0x', {
            from: relayAddress,
            gasPrice
          })
          const nonceAfter = await relayHubContract.getNonce(senderAddress)
          assert.equal(nonceBefore.toNumber() + 1, nonceAfter.toNumber())

          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message,
            realSender: senderAddress,
            msgSender: relayHub,
            origin: relayAddress
          })
        })

        // This test is added due to a regression that almost slipped to production.
        it('relayCall executes the transaction with no parameters', async function () {
          const encodedFunction = recipientContract.contract.methods.emitMessageNoParams().encodeABI()
          const relayRequestNoCallData = relayRequest.clone()
          relayRequestNoCallData.encodedFunction = encodedFunction;
          ({ signature } = await getEip712Signature({
            web3,
            chainId,
            relayHub: relayHub,
            relayRequest: relayRequestNoCallData
          }))
          const { tx } = await relayHubContract.relayCall(relayRequestNoCallData, signature, '0x', {
            from: relayAddress,
            gasPrice
          })
          await expectEvent.inTransaction(tx, TestRecipient, 'SampleRecipientEmitted', {
            message: messageWithNoParams,
            realSender: senderAddress,
            msgSender: relayHub,
            origin: relayAddress
          })
        })

        it('preRelayedCall receives values returned in acceptRelayedCall', async function () {
          const { tx } = await relayHubContract.relayCall(relayRequestPaymasterWithContext, signatureWithContextPaymaster, '0x', {
            from: relayAddress,
            gasPrice
          })

          await expectEvent.inTransaction(tx, TestPaymasterStoreContext, 'SampleRecipientPreCallWithValues', {
            relay: relayAddress,
            from: senderAddress,
            encodedFunction,
            baseRelayFee,
            pctRelayFee,
            gasPrice,
            gasLimit,
            nonce: senderNonce,
            approvalData: null
          })
        })

        it('postRelayedCall receives values returned in acceptRelayedCall', async function () {
          const { tx } = await relayHubContract.relayCall(relayRequestPaymasterWithContext, signatureWithContextPaymaster, '0x', {
            from: relayAddress,
            gasPrice
          })

          await expectEvent.inTransaction(tx, TestPaymasterStoreContext, 'SampleRecipientPostCallWithValues', {
            relay: relayAddress,
            from: senderAddress,
            encodedFunction,
            baseRelayFee,
            pctRelayFee,
            gasPrice,
            gasLimit,
            nonce: senderNonce,
            approvalData: null
          })
        })

        it('relaying is aborted if the recipient returns an invalid status code', async function () {
          await misbehavingPaymaster.setReturnInvalidErrorCode(true)
          const { logs } = await relayHubContract.relayCall(relayRequestMisbehavingPaymaster, signatureWithMisbehavingPaymaster, '0x', {
            from: relayAddress,
            gasPrice
          })

          expectEvent.inLogs(logs, 'CanRelayFailed', { reason: CanRelayStatus.InvalidRecipientStatusCode })
        })

        it('should not accept relay requests if gas limit is too low for a relayed transaction', async function () {
          // Adding gasReserve is not enough by a few wei as some gas is spent before gasleft().
          const gasReserve = 99999
          await expectRevert(
            relayHubContract.relayCall(relayRequestMisbehavingPaymaster, signatureWithMisbehavingPaymaster, '0x', {
              from: relayAddress,
              gasPrice,
              gas: parseInt(gasLimit) + gasReserve
            }),
            'Not enough gas left for recipientCallsAtomic to complete')
        })

        it('should not accept relay requests with gas price lower then user specified', async function () {
          // Adding gasReserve is not enough by a few wei as some gas is spent before gasleft().
          await expectRevert(
            relayHubContract.relayCall(relayRequestMisbehavingPaymaster, signatureWithMisbehavingPaymaster, '0x', {
              from: relayAddress,
              gasPrice: parseInt(gasPrice) - 1
            }),
            'Invalid gas price')
        })

        it('should not accept relay requests if destination recipient doesn\'t have a balance to pay for it', async function () {
          const paymaster2 = await TestPaymasterEverythingAccepted.new()
          await paymaster2.setHub(relayHub)
          const maxPossibleCharge = (await relayHubContract.calculateCharge(gasLimit, {
            gasPrice,
            pctRelayFee,
            baseRelayFee,
            gasLimit: 0
          })).toNumber()
          await paymaster2.deposit({ value: maxPossibleCharge - 1 }) // TODO: replace with correct margin calculation

          const relayRequestPaymaster2 = relayRequest.clone()
          relayRequestPaymaster2.relayData.paymaster = paymaster2.address

          await expectRevert(
            relayHubContract.relayCall(relayRequestPaymaster2, signatureWithMisbehavingPaymaster, '0x', {
              from: relayAddress,
              gasPrice
            }),
            'Paymaster balance too low')
        })

        it('should not execute the \'relayedCall\' if \'preRelayedCall\' reverts', async function () {
          await misbehavingPaymaster.setRevertPreRelayCall(true)
          const startBlock = await web3.eth.getBlockNumber()

          const { logs } = await relayHubContract.relayCall(relayRequestMisbehavingPaymaster,
            signatureWithMisbehavingPaymaster, '0x', {
              from: relayAddress,
              gasPrice: gasPrice
            })

          // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
          const logsMessages = await recipientContract.contract.getPastEvents('SampleRecipientEmitted', {
            fromBlock: startBlock,
            toBlock: 'latest'
          })
          assert.equal(0, logsMessages.length)
          expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.PreRelayedFailed })
        })

        it('should revert the \'relayedCall\' if \'postRelayedCall\' reverts', async function () {
          await misbehavingPaymaster.setRevertPostRelayCall(true)
          const { logs } = await relayHubContract.relayCall(relayRequestMisbehavingPaymaster,
            signatureWithMisbehavingPaymaster, '0x', {
              from: relayAddress,
              gasPrice: gasPrice
            })

          const startBlock = await web3.eth.getBlockNumber()
          // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
          const logsMessages = await recipientContract.contract.getPastEvents('SampleRecipientEmitted', {
            fromBlock: startBlock,
            toBlock: 'latest'
          })
          assert.equal(0, logsMessages.length)
          expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.PostRelayedFailed })
        })

        describe('recipient balance withdrawal ban', function () {
          let misbehavingPaymaster
          let relayRequestMisbehavingPaymaster
          let signature
          beforeEach(async function () {
            misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
            await misbehavingPaymaster.setHub(relayHub)
            await relayHubContract.depositFor(misbehavingPaymaster.address, {
              value: ether('1'),
              from: other
            })

            relayRequestMisbehavingPaymaster = relayRequest.clone()
            relayRequestMisbehavingPaymaster.relayData.paymaster = misbehavingPaymaster.address;

            ({ signature } = await getEip712Signature({
              web3,
              chainId,
              relayHub: relayHub,
              relayRequest: relayRequestMisbehavingPaymaster
            }))
          })

          it('reverts relayed call if recipient withdraws balance during preRelayedCall', async function () {
            await misbehavingPaymaster.setWithdrawDuringPreRelayedCall(true)
            await assertRevertWithRecipientBalanceChanged()
          })

          it('reverts relayed call if recipient withdraws balance during the relayed call', async function () {
            await recipientContract.setWithdrawDuringRelayedCall(misbehavingPaymaster.address)
            await assertRevertWithRecipientBalanceChanged()
          })

          it('reverts relayed call if recipient withdraws balance during postRelayedCall', async function () {
            await misbehavingPaymaster.setWithdrawDuringPostRelayedCall(true)
            await assertRevertWithRecipientBalanceChanged()
          })

          async function assertRevertWithRecipientBalanceChanged () {
            const { logs } = await relayHubContract.relayCall(relayRequestMisbehavingPaymaster, signature, '0x', {
              from: relayAddress,
              gasPrice
            })
            expectEvent.inLogs(logs, 'TransactionRelayed', { status: RelayCallStatusCodes.RecipientBalanceChanged })
          }
        })
      })
    })
  })
})
