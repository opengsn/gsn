/* eslint-disable @typescript-eslint/require-await */
// This rule seems to be flickering and buggy - does not understand async arrow functions correctly
import { balance, ether, expectEvent, expectRevert, send } from '@openzeppelin/test-helpers'
import BN from 'bn.js'

import { Transaction } from 'ethereumjs-tx'
import { TransactionOptions } from 'ethereumjs-tx/dist/types'
import { encode } from 'rlp'
import { expect } from 'chai'
import { privateToAddress, stripZeros, toBuffer } from 'ethereumjs-util'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import { defaultEnvironment } from '../src/common/Environments'
import {
  PenalizerInstance,
  RelayHubInstance, StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance
} from '../types/truffle-contracts'

import { deployHub } from './TestUtils'
import { getRawTxOptions } from '../src/common/ContractInteractor'
import { registerForwarderForGsn } from '../src/common/EIP712/ForwarderUtil'

import TransactionResponse = Truffle.TransactionResponse

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const Forwarder = artifacts.require('Forwarder')

const paymasterData = '0x'
const clientId = '0'

contract('RelayHub Penalizations', function ([_, relayOwner, relayWorker, otherRelayWorker, sender, other, relayManager, otherRelayManager, thirdRelayWorker, reporterRelayManager]) { // eslint-disable-line no-unused-vars
  const chainId = defaultEnvironment.chainId

  let stakeManager: StakeManagerInstance
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let transactionOptions: TransactionOptions

  let forwarder: string
  // TODO: 'before' is a bad thing in general. Use 'beforeEach', this tests all depend on each other!!!
  before(async function () {
    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    relayHub = await deployHub(stakeManager.address, penalizer.address)
    const forwarderInstance = await Forwarder.new()
    forwarder = forwarderInstance.address
    recipient = await TestRecipient.new(forwarder)
    // register hub's RelayRequest with forwarder, if not already done.
    await registerForwarderForGsn(forwarderInstance)

    paymaster = await TestPaymasterEverythingAccepted.new()

    await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
    await stakeManager.stakeForRelayManager(relayManager, 1000, {
      from: relayOwner,
      value: ether('1')
    })
    await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
    await paymaster.setTrustedForwarder(forwarder)
    await paymaster.setRelayHub(relayHub.address)
    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    // @ts-ignore
    Object.keys(StakeManager.events).forEach(function (topic) {
      // @ts-ignore
      RelayHub.network.events[topic] = StakeManager.events[topic]
    })
    // @ts-ignore
    Object.keys(StakeManager.events).forEach(function (topic) {
      // @ts-ignore
      Penalizer.network.events[topic] = StakeManager.events[topic]
    })
    const networkId = await web3.eth.net.getId()
    const chain = await web3.eth.net.getNetworkType()
    transactionOptions = getRawTxOptions(chainId, networkId, chain)
  })

  async function prepareRelayCall (): Promise<{
    gasPrice: BN
    gasLimit: BN
    relayRequest: RelayRequest
    signature: string
  }> {
    const gasPrice = new BN('1')
    const gasLimit = new BN('5000000')
    const txData = recipient.contract.methods.emitMessage('').encodeABI()
    const relayRequest: RelayRequest = {
      request: {
        to: recipient.address,
        data: txData,
        from: sender,
        nonce: '0',
        value: '0',
        gas: gasLimit.toString(),
        validUntil: '0'
      },
      relayData: {
        gasPrice: gasPrice.toString(),
        baseRelayFee: '300',
        pctRelayFee: '10',
        relayWorker,
        forwarder,
        paymaster: paymaster.address,
        paymasterData,
        clientId
      }
    }
    const dataToSign = new TypedRequestData(
      chainId,
      forwarder,
      relayRequest
    )
    const signature = await getEip712Signature(
      web3,
      dataToSign
    )
    return {
      gasPrice,
      gasLimit,
      relayRequest,
      signature
    }
  }

  describe('penalizations', function () {
    const stake = ether('1')

    before('register reporter as relayer', async function () {
      await stakeManager.setRelayManagerOwner(relayOwner, { from: reporterRelayManager })
      await stakeManager.stakeForRelayManager(reporterRelayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(reporterRelayManager, relayHub.address, { from: relayOwner })
    })

    // Receives a function that will penalize the relay and tests that call for a penalization, including checking the
    // emitted event and penalization reward transfer. Returns the transaction receipt.
    async function expectPenalization (penalizeWithOpts: (opts: Truffle.TransactionDetails) => Promise<TransactionResponse>): Promise<TransactionResponse> {
      const reporterBalanceTracker = await balance.tracker(reporterRelayManager)
      const stakeManagerBalanceTracker = await balance.tracker(stakeManager.address)
      const stakeInfo = await stakeManager.stakes(relayManager)
      // @ts-ignore (names)
      const stake = stakeInfo.stake
      const expectedReward = stake.divn(2)

      // A gas price of zero makes checking the balance difference simpler
      const receipt = await penalizeWithOpts({
        from: reporterRelayManager,
        gasPrice: 0
      })
      expectEvent.inLogs(receipt.logs, 'StakePenalized', {
        relayManager: relayManager,
        beneficiary: reporterRelayManager,
        reward: expectedReward
      })

      // The reporter gets half of the stake
      expect(await reporterBalanceTracker.delta()).to.be.bignumber.equals(stake.divn(2))

      // The other half is burned, so RelayHub's balance is decreased by the full stake
      expect(await stakeManagerBalanceTracker.delta()).to.be.bignumber.equals(stake.neg())

      return receipt
    }

    describe('penalization access control (relay manager only)', function () {
      before(async function () {
        const { transactionHash } = await send.ether(thirdRelayWorker, other, ether('0.5'));
        ({
          data: penalizableTxData,
          signature: penalizableTxSignature
        } = await getDataAndSignatureFromHash(transactionHash, chainId))
      })
      let penalizableTxData: string
      let penalizableTxSignature: string
      it('penalizeIllegalTransaction', async function () {
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, { from: other }),
          'Unknown relay manager'
        )
      })
      it('penalizeRepeatedNonce', async function () {
        await expectRevert(
          penalizer.penalizeRepeatedNonce(penalizableTxData, penalizableTxSignature, penalizableTxData, penalizableTxSignature, relayHub.address, { from: other }),
          'Unknown relay manager'
        )
      })
    })

    describe('penalizable behaviors', function () {
      const encodedCallArgs = {
        sender,
        recipient: '0x1820b744B33945482C17Dc37218C01D858EBc714',
        data: '0x1234',
        baseFee: 1000,
        fee: 10,
        gasPrice: 50,
        gasLimit: 1000000,
        nonce: 0,
        paymaster: ''
      }

      const relayCallArgs = {
        gasPrice: 50,
        gasLimit: 1000000,
        nonce: 0,
        privateKey: '6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c' // relay's private key
      }

      before(function () {
        // @ts-ignore
        expect('0x' + privateToAddress('0x' + relayCallArgs.privateKey).toString('hex')).to.equal(relayWorker.toLowerCase())
        // TODO: I don't want to refactor everything here, but this value is not available before 'before' is run :-(
        encodedCallArgs.paymaster = paymaster.address
      })

      beforeEach('staking for relay', async function () {
        await stakeManager.stakeForRelayManager(relayManager, 1000, {
          value: stake,
          from: relayOwner
        })
        await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      })

      describe('repeated relay nonce', function () {
        it('penalizes transactions with same nonce and different data', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(Object.assign({}, encodedCallArgs, { data: '0xabcd' }), relayCallArgs), chainId)
          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts)
          )
        })

        it('penalizes transactions with same nonce and different gas limit', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { gasLimit: 100 })), chainId)

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts)
          )
        })

        it('penalizes transactions with same nonce and different value', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { value: 100 })), chainId)

          await expectPenalization(async (opts) =>
            await penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, opts)
          )
        })

        it('does not penalize transactions with same nonce and data, value, gasLimit, destination', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { gasPrice: 70 }) // only gasPrice may be different
          ), chainId)

          await expectRevert(
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
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
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
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
            penalizer.penalizeRepeatedNonce(txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address, { from: reporterRelayManager }),
            'Different signer'
          )
        })
      })

      describe('illegal call', function () {
        // TODO: this tests are excessive, and have a lot of tedious build-up
        it('penalizes relay transactions to addresses other than RelayHub', async function () {
          // Relay sending ether to another account
          const { transactionHash } = await send.ether(relayWorker, other, ether('0.5'))
          const { data, signature } = await getDataAndSignatureFromHash(transactionHash, chainId)

          await expectPenalization(async (opts) => await penalizer.penalizeIllegalTransaction(data, signature, relayHub.address, opts))
        })

        it('penalizes relay worker transactions to illegal RelayHub functions (stake)', async function () {
          await stakeManager.setRelayManagerOwner(relayWorker, { from: other })
          // Relay staking for a second relay
          const { tx } = await stakeManager.stakeForRelayManager(other, 1000, {
            value: ether('1'),
            from: relayWorker
          })
          const { data, signature } = await getDataAndSignatureFromHash(tx, chainId)

          await expectPenalization(async (opts) => await penalizer.penalizeIllegalTransaction(data, signature, relayHub.address, opts))
        })

        it('should penalize relays for lying about transaction gas limit RelayHub', async function () {
          const { gasPrice, gasLimit, relayRequest, signature } = await prepareRelayCall()
          await relayHub.depositFor(paymaster.address, {
            from: other,
            value: ether('1')
          })
          const relayCallTx = await relayHub.relayCall(10e6, relayRequest, signature, '0x', gasLimit.add(new BN(2e6)), {
            from: relayWorker,
            gas: gasLimit.add(new BN(1e6)),
            gasPrice
          })

          const relayCallTxDataSig = await getDataAndSignatureFromHash(relayCallTx.tx, chainId)

          await expectPenalization(
            async (opts) => await penalizer.penalizeIllegalTransaction(relayCallTxDataSig.data, relayCallTxDataSig.signature, relayHub.address, opts)
          )
        })

        it('does not penalize legal relay transactions', async function () {
          // relayCall is a legal transaction
          const baseFee = new BN('300')
          const fee = new BN('10')
          const gasPrice = new BN('1')
          const gasLimit = new BN('1000000')
          const senderNonce = new BN('0')
          const txData = recipient.contract.methods.emitMessage('').encodeABI()
          const relayRequest: RelayRequest = {
            request: {
              to: recipient.address,
              data: txData,
              from: sender,
              nonce: senderNonce.toString(),
              value: '0',
              gas: gasLimit.toString(),
              validUntil: '0'
            },
            relayData: {
              gasPrice: gasPrice.toString(),
              baseRelayFee: baseFee.toString(),
              pctRelayFee: fee.toString(),
              relayWorker,
              forwarder,
              paymaster: paymaster.address,
              paymasterData,
              clientId
            }
          }
          const dataToSign = new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          )
          const signature = await getEip712Signature(
            web3,
            dataToSign
          )
          await relayHub.depositFor(paymaster.address, {
            from: other,
            value: ether('1')
          })
          const externalGasLimit = gasLimit.add(new BN(1e6))
          const relayCallTx = await relayHub.relayCall(10e6, relayRequest, signature, '0x', externalGasLimit, {
            from: relayWorker,
            gas: externalGasLimit,
            gasPrice
          })

          const relayCallTxDataSig = await getDataAndSignatureFromHash(relayCallTx.tx, chainId)
          await expectRevert(
            penalizer.penalizeIllegalTransaction(relayCallTxDataSig.data, relayCallTxDataSig.signature, relayHub.address, { from: reporterRelayManager }),
            'Legal relay transaction'
          )
        })
      })
    })

    describe('penalizable relay states', function () {
      context('with penalizable transaction', function () {
        let penalizableTxData: string
        let penalizableTxSignature: string

        beforeEach(async function () {
          // Relays are not allowed to transfer Ether
          const { transactionHash } = await send.ether(thirdRelayWorker, other, ether('0.5'));
          ({
            data: penalizableTxData,
            signature: penalizableTxSignature
          } = await getDataAndSignatureFromHash(transactionHash, chainId))
        })

        // All of these tests use the same penalization function (we one we set up in the beforeEach block)
        async function penalize (): Promise<TransactionResponse> {
          return await expectPenalization(async (opts) => await penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, opts))
        }

        context('with not owned relay worker', function () {
          it('account cannot be penalized', async function () {
            await expectRevert(penalize(), 'Unknown relay worker')
          })
        })

        context('with staked and locked relay manager and ', function () {
          beforeEach(async function () {
            await stakeManager.stakeForRelayManager(relayManager, 1000, {
              from: relayOwner,
              value: ether('1')
            })
          })

          before(async function () {
            await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
            await relayHub.addRelayWorkers([thirdRelayWorker], { from: relayManager })
          })

          it('relay can be penalized', async function () {
            await penalize()
          })

          it('relay cannot be penalized twice', async function () {
            await penalize()
            await expectRevert(penalize(), 'relay manager not staked')
          })
        })
      })
    })

    function encodeRelayCallEIP155 (encodedCallArgs: any, relayCallArgs: any): Transaction {
      const privateKey = Buffer.from(relayCallArgs.privateKey, 'hex')
      const relayWorker = privateToAddress(privateKey).toString('hex')
      // TODO: 'encodedCallArgs' is no longer needed. just keep the RelayRequest in test
      const relayRequest: RelayRequest =
        {
          request: {
            to: encodedCallArgs.recipient,
            data: encodedCallArgs.data,
            from: encodedCallArgs.sender,
            nonce: encodedCallArgs.nonce.toString(),
            value: '0',
            gas: encodedCallArgs.gasLimit.toString(),
            validUntil: '0'
          },
          relayData: {
            baseRelayFee: encodedCallArgs.baseFee.toString(),
            pctRelayFee: encodedCallArgs.fee.toString(),
            gasPrice: encodedCallArgs.gasPrice.toString(),
            relayWorker,
            forwarder,
            paymaster: encodedCallArgs.paymaster,
            paymasterData,
            clientId
          }
        }
      const encodedCall = relayHub.contract.methods.relayCall(10e6, relayRequest, '0xabcdef123456', '0x', 4e6).encodeABI()

      const transaction = new Transaction({
        nonce: relayCallArgs.nonce,
        gasLimit: relayCallArgs.gasLimit,
        gasPrice: relayCallArgs.gasPrice,
        to: relayHub.address,
        value: relayCallArgs.value,
        data: encodedCall
      }, transactionOptions)

      transaction.sign(Buffer.from(relayCallArgs.privateKey, 'hex'))
      return transaction
    }

    async function getDataAndSignatureFromHash (txHash: string, chainId: number): Promise<{ data: string, signature: string }> {
      const rpcTx: any = await web3.eth.getTransaction(txHash)
      const vInteger = parseInt(rpcTx.v, 16)
      if (chainId == null && vInteger > 28) {
        throw new Error('Missing ChainID for EIP-155 signature')
      }
      if (chainId == null && vInteger <= 28) {
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
      }, transactionOptions)

      return getDataAndSignature(tx, chainId)
    }

    function getDataAndSignature (tx: Transaction, chainId: number): { data: string, signature: string } {
      const input = [tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data]
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (chainId) {
        input.push(
          toBuffer(chainId),
          stripZeros(toBuffer(0)),
          stripZeros(toBuffer(0))
        )
      }
      let v = parseInt(tx.v.toString('hex'), 16)
      if (v > 28) {
        v -= chainId * 2 + 8
      }
      const data = `0x${encode(input).toString('hex')}`
      const signature = `0x${'00'.repeat(32 - tx.r.length) + tx.r.toString('hex')}${'00'.repeat(
        32 - tx.s.length) + tx.s.toString('hex')}${v.toString(16)}`
      return {
        data,
        signature
      }
    }
  })
})
