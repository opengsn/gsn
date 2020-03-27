const { balance, BN, ether, expectEvent, expectRevert, send, time } = require('@openzeppelin/test-helpers')

const Transaction = require('ethereumjs-tx')
const { privateToAddress, stripZeros, toBuffer } = require('ethereumjs-util')
const rlp = require('rlp')
const { expect } = require('chai')

const RelayRequest = require('../src/js/relayclient/EIP712/RelayRequest')
const { getEip712Signature } = require('../src/js/relayclient/utils')
const Environments = require('../src/js/relayclient/Environments')

const RelayHub = artifacts.require('RelayHub')
const TrustedForwarder = artifacts.require('./TrustedForwarder.sol')
const SampleRecipient = artifacts.require('./test/TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted')

contract('RelayHub Penalizations', function ([_, relayOwner, relay, otherRelay, sender, other]) { // eslint-disable-line no-unused-vars
  const chainId = Environments.defEnv.chainId
  let relayHub
  let recipient
  let paymaster
  let forwarder

  before(async function () {
    relayHub = await RelayHub.new(Environments.defEnv.gtxdatanonzero, { gas: 10000000 })
    forwarder = await TrustedForwarder.new()
    recipient = await SampleRecipient.new(forwarder.address)
    paymaster = await TestPaymasterEverythingAccepted.new()
    await paymaster.setHub(relayHub.address)
  })

  describe('penalizations', function () {
    const reporter = other
    const stake = ether('1')

    // Receives a function that will penalize the relay and tests that call for a penalization, including checking the
    // emitted event and penalization reward transfer. Returns the transaction receipt.
    async function expectPenalization (penalizeWithOpts) {
      const reporterBalanceTracker = await balance.tracker(reporter)
      const relayHubBalanceTracker = await balance.tracker(relayHub.address)
      const stake = (await relayHub.getRelay(relay)).totalStake
      const expectedReward = stake.divn(2)

      // A gas price of zero makes checking the balance difference simpler
      const receipt = await penalizeWithOpts({
        from: reporter,
        gasPrice: 0
      })
      expectEvent.inLogs(receipt.logs, 'Penalized', {
        relay,
        sender: reporter,
        reward: expectedReward
      })

      // The reporter gets half of the stake
      expect(await reporterBalanceTracker.delta()).to.be.bignumber.equals(stake.divn(2))

      // The other half is burned, so RelayHub's balance is decreased by the full stake
      expect(await relayHubBalanceTracker.delta()).to.be.bignumber.equals(stake.neg())

      return receipt
    }

    describe('penalizable behaviors', function () {
      const encodedCallArgs = {
        sender,
        recipient: '0x1820b744B33945482C17Dc37218C01D858EBc714',
        data: '0x1234',
        baseFee: 1000,
        fee: 10,
        gasPrice: 50,
        gasLimit: 1000000,
        nonce: 0
      }

      const relayCallArgs = {
        gasPrice: 50,
        gasLimit: 1000000,
        nonce: 0,
        privateKey: '6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c' // relay's private key
      }

      before(function () {
        expect('0x' + privateToAddress('0x' + relayCallArgs.privateKey).toString('hex')).to.equal(relay.toLowerCase())
        // TODO: I don't want to refactor everything here, but this value is not available before 'before' is run :-(
        encodedCallArgs.paymaster = paymaster.address
      })

      beforeEach('staking for relay', async function () {
        await relayHub.stake(relay, time.duration.weeks(1), { value: stake })
      })

      describe('repeated relay nonce', async function () {
        it('penalizes transactions with same nonce and different data', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(Object.assign({}, encodedCallArgs, { data: '0xabcd' }), relayCallArgs), chainId)

          await expectPenalization((opts) =>
            relayHub.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, opts)
          )
        })

        it('penalizes transactions with same nonce and different gas limit', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { gasLimit: 100 })), chainId)

          await expectPenalization((opts) =>
            relayHub.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, opts)
          )
        })

        it('penalizes transactions with same nonce and different value', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { value: 100 })), chainId)

          await expectPenalization((opts) =>
            relayHub.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, opts)
          )
        })

        it('does not penalize transactions with same nonce and data, value, gasLimit, destination', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { gasPrice: 70 }) // only gasPrice may be different
          ), chainId)

          await expectRevert(
            relayHub.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature),
            'tx is equal'
          )
        })

        it('does not penalize transactions with different nonces', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { nonce: 1 })
          ), chainId)

          await expectRevert(
            relayHub.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature),
            'Different nonce'
          )
        })

        it('does not penalize transactions with same nonce from different relays', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { privateKey: '0123456789012345678901234567890123456789012345678901234567890123' })
          ), chainId)

          await expectRevert(
            relayHub.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature),
            'Different signer'
          )
        })
      })

      describe('illegal call', async function () {
        it('penalizes relay transactions to addresses other than RelayHub', async function () {
          // Relay sending ether to another account
          const { transactionHash } = await send.ether(relay, other, ether('0.5'))
          const { data, signature } = await getDataAndSignatureFromHash(transactionHash, chainId)

          await expectPenalization((opts) => relayHub.penalizeIllegalTransaction(data, signature, opts))
        })

        it('penalizes relay transactions to illegal RelayHub functions (stake)', async function () {
          // Relay staking for a second relay
          const { tx } = await relayHub.stake(other, time.duration.weeks(1), {
            value: ether('1'),
            from: relay
          })
          const { data, signature } = await getDataAndSignatureFromHash(tx, chainId)

          await expectPenalization((opts) => relayHub.penalizeIllegalTransaction(data, signature, opts))
        })

        it('penalizes relay transactions to illegal RelayHub functions (penalize)', async function () {
          // A second relay is registered
          await relayHub.stake(otherRelay, time.duration.weeks(1), {
            value: ether('1'),
            from: other
          })

          // An illegal transaction is sent by it
          const stakeTx = await send.ether(otherRelay, other, ether('0.5'))

          // A relay penalizes it
          const stakeTxDataSig = await getDataAndSignatureFromHash(stakeTx.transactionHash, chainId)
          const penalizeTx = await relayHub.penalizeIllegalTransaction(
            stakeTxDataSig.data, stakeTxDataSig.signature, { from: relay }
          )

          // It can now be penalized for that
          const penalizeTxDataSig = await getDataAndSignatureFromHash(penalizeTx.tx, chainId)
          await expectPenalization((opts) =>
            relayHub.penalizeIllegalTransaction(penalizeTxDataSig.data, penalizeTxDataSig.signature, opts))
        })

        it('does not penalize legal relay transactions', async function () {
          // registerRelay is a legal transaction

          const registerTx = await relayHub.registerRelay(0, 10, 'url.com', { from: relay })
          const registerTxDataSig = await getDataAndSignatureFromHash(registerTx.tx, chainId)

          await expectRevert(
            relayHub.penalizeIllegalTransaction(registerTxDataSig.data, registerTxDataSig.signature),
            'Legal relay transaction'
          )

          // relayCall is a legal transaction

          const baseFee = new BN('300')
          const fee = new BN('10')
          const gasPrice = new BN('1')
          const gasLimit = new BN('1000000')
          const senderNonce = new BN('0')
          const txData = recipient.contract.methods.emitMessage('').encodeABI()
          const relayRequest = new RelayRequest({
            senderAddress: sender,
            target: recipient.address,
            encodedFunction: txData,
            gasPrice: gasPrice.toString(),
            gasLimit: gasLimit.toString(),
            baseRelayFee: baseFee.toString(),
            pctRelayFee: fee.toString(),
            senderNonce: senderNonce.toString(),
            relayAddress: relay,
            paymaster: paymaster.address
          })
          const { signature } = await getEip712Signature({
            web3,
            chainId,
            verifier: forwarder.address,
            relayRequest
          })
          await relayHub.depositFor(paymaster.address, {
            from: other,
            value: ether('1')
          })
          const relayCallTx = await relayHub.relayCall(relayRequest, signature, '0x', {
            from: relay,
            gasPrice,
            gasLimit
          })

          const relayCallTxDataSig = await getDataAndSignatureFromHash(relayCallTx.tx, chainId)
          await expectRevert(
            relayHub.penalizeIllegalTransaction(relayCallTxDataSig.data, relayCallTxDataSig.signature),
            'Legal relay transaction'
          )
        })
      })
    })

    describe('penalizable relay states', async function () {
      context('with penalizable transaction', function () {
        let penalizableTxData
        let penalizableTxSignature

        beforeEach(async function () {
          // Relays are not allowed to transfer Ether
          const { transactionHash } = await send.ether(relay, other, ether('0.5'));
          ({
            data: penalizableTxData,
            signature: penalizableTxSignature
          } = await getDataAndSignatureFromHash(transactionHash, chainId))
        })

        // All of these tests use the same penalization function (we one we set up in the beforeEach block)
        function penalize () {
          return expectPenalization((opts) => relayHub.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, opts))
        }

        // Checks that a relay can be penalized, but only once
        function testUniqueRelayPenalization () {
          it('relay can be penalized', async function () {
            await penalize()
          })

          it('relay cannot be penalized twice', async function () {
            await penalize()
            await expectRevert(penalize(), 'Unstaked relay')
          })
        }

        context('with unstaked relay', function () {
          before(async function () {
            await relayHub.removeRelayByOwner(relay)
            await time.increase(time.duration.weeks(1))
            await relayHub.unstake(relay)
          })

          it('account cannot be penalized', async function () {
            await expectRevert(penalize(), 'Unstaked relay')
          })

          context('with staked relay', function () {
            const unstakeDelay = time.duration.weeks(1)

            beforeEach(async function () {
              await relayHub.stake(relay, unstakeDelay, {
                value: stake,
                from: relayOwner
              })
            })

            testUniqueRelayPenalization()

            context('with registered relay', function () {
              beforeEach(async function () {
                await relayHub.registerRelay(0, 10, 'url.com', { from: relay })
              })

              testUniqueRelayPenalization()

              it('RelayRemoved event is emitted', async function () {
                const { logs } = await penalize()
                expectEvent.inLogs(logs, 'RelayRemoved', {
                  relay,
                  unstakeTime: await time.latest()
                })
              })

              context('with removed relay', function () {
                beforeEach(async function () {
                  await relayHub.removeRelayByOwner(relay, { from: relayOwner })
                })

                testUniqueRelayPenalization()

                context('with unstaked relay', function () {
                  beforeEach(async function () {
                    await time.increase(unstakeDelay)
                    await relayHub.unstake(relay, { from: relayOwner })
                  })

                  it('relay cannot be penalized', async function () {
                    await expectRevert(penalize(), 'Unstaked relay')
                  })
                })
              })
            })
          })
        })
      })
    })

    function encodeRelayCallEIP155 (encodedCallArgs, relayCallArgs) {
      const relayAddress = privateToAddress('0x' + relayCallArgs.privateKey).toString('hex')
      // TODO: 'encodedCallArgs' is no longer needed. just keep the RelayRequest in test
      const relayRequest = new RelayRequest(
        {
          senderAddress: encodedCallArgs.sender,
          target: encodedCallArgs.recipient,
          encodedFunction: encodedCallArgs.data,
          baseRelayFee: encodedCallArgs.baseFee.toString(),
          pctRelayFee: encodedCallArgs.fee.toString(),
          gasPrice: encodedCallArgs.gasPrice.toString(),
          gasLimit: encodedCallArgs.gasLimit.toString(),
          senderNonce: encodedCallArgs.nonce.toString(),
          relayAddress,
          paymaster: encodedCallArgs.paymaster
        }
      )
      const encodedCall = relayHub.contract.methods.relayCall(relayRequest, '0xabcdef123456', '0x').encodeABI()

      const transaction = new Transaction({
        nonce: relayCallArgs.nonce,
        gasLimit: relayCallArgs.gasLimit,
        gasPrice: relayCallArgs.gasPrice,
        to: relayHub.address,
        value: relayCallArgs.value,
        chainId: 1,
        data: encodedCall
      })

      transaction.sign(Buffer.from(relayCallArgs.privateKey, 'hex'))
      return transaction
    }

    async function getDataAndSignatureFromHash (txHash, chainId) {
      const rpcTx = await web3.eth.getTransaction(txHash)
      if (!chainId && parseInt(rpcTx.v, 'hex') > 28) {
        throw new Error('Missing ChainID for EIP-155 signature')
      }
      if (chainId && parseInt(rpcTx.v, 'hex') <= 28) {
        throw new Error('Passed ChainID for non-EIP-155 signature')
      }
      const tx = new Transaction({
        nonce: new BN(rpcTx.nonce),
        gasPrice: new BN(rpcTx.gasPrice),
        gasLimit: new BN(rpcTx.gas),
        to: rpcTx.to,
        value: new BN(rpcTx.value),
        data: rpcTx.input,
        v: rpcTx.v,
        r: rpcTx.r,
        s: rpcTx.s
      })

      return getDataAndSignature(tx, chainId)
    }

    function getDataAndSignature (tx, chainId) {
      const input = [tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data]
      if (chainId) {
        input.push(
          toBuffer(chainId),
          stripZeros(toBuffer(0)),
          stripZeros(toBuffer(0))
        )
      }
      let v = tx.v[0]
      if (v > 28) {
        v -= chainId * 2 + 8
      }
      const data = `0x${rlp.encode(input).toString('hex')}`
      const signature = `0x${tx.r.toString('hex')}${tx.s.toString('hex')}${v.toString(16)}`

      return {
        data,
        signature
      }
    }
  })
})
