/* eslint-disable @typescript-eslint/require-await */
// This rule seems to be flickering and buggy - does not understand async arrow functions correctly
import { balance, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import BN from 'bn.js'

import { Transaction, AccessListEIP2930Transaction, FeeMarketEIP1559Transaction } from '@ethereumjs/tx'
import Common from '@ethereumjs/common'
import { TxOptions } from '@ethereumjs/tx/dist/types'
import { encode } from 'rlp'
import { expect } from 'chai'
import { privateToAddress, bnToRlp, ecsign, keccak256, bufferToHex } from 'ethereumjs-util'

import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { getEip712Signature, removeHexPrefix, signatureRSV2Hex } from '@opengsn/common/dist/Utils'
import { TypedRequestData } from '@opengsn/common/dist/EIP712/TypedRequestData'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import {
  PenalizerInstance,
  RelayHubInstance, StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance
} from '@opengsn/contracts/types/truffle-contracts'

import { deployHub, evmMineMany, revert, snapshot } from './TestUtils'
import { getRawTxOptions } from '@opengsn/common/dist/ContractInteractor'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { StakeUnlocked } from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { getDataAndSignature } from '@opengsn/common/dist'
import { TransactionReceipt } from 'web3-core'
import { toBN } from 'web3-utils'

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const Forwarder = artifacts.require('Forwarder')

const paymasterData = '0x'
const clientId = '0'

contract('RelayHub Penalizations', function ([_, relayOwner, committer, nonCommitter,
  sender, other, relayManager, reporterRelayManager]) { // eslint-disable-line no-unused-vars
  const chainId = defaultEnvironment.chainId

  let stakeManager: StakeManagerInstance
  let relayHub: RelayHubInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let transactionOptions: TxOptions

  let forwarder: string
  const relayWorkerPrivateKey = Buffer.from('92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e', 'hex')
  const relayWorker = privateToAddress(relayWorkerPrivateKey).toString('hex')
  const anotherRelayWorkerPrivateKey = Buffer.from('4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356', 'hex')
  const anotherRelayWorker = privateToAddress(anotherRelayWorkerPrivateKey).toString('hex')

  const encodedCallArgs = {
    sender,
    recipient: '0x1820b744B33945482C17Dc37218C01D858EBc714',
    data: '0x1234',
    baseFee: 1000,
    fee: 10,
    gasPrice: 50,
    gasLimit: 1e6,
    nonce: 0,
    paymaster: ''
  }

  const relayCallArgs = {
    gasPrice: 50,
    gasLimit: 1e6,
    nonce: 0,
    value: 0,
    privateKey: relayWorkerPrivateKey
  }
  // TODO: 'before' is a bad thing in general. Use 'beforeEach', this tests all depend on each other!!!
  before(async function () {
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, 40)
    relayHub = await deployHub(stakeManager.address, penalizer.address)
    const forwarderInstance = await Forwarder.new()
    forwarder = forwarderInstance.address
    recipient = await TestRecipient.new(forwarder)
    // register hub's RelayRequest with forwarder, if not already done.
    await registerForwarderForGsn(forwarderInstance)

    paymaster = await TestPaymasterEverythingAccepted.new()
    encodedCallArgs.paymaster = paymaster.address
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
    const gasPrice = new BN(1e9)
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

    describe('TransactionType penalization', function () {
      let relayRequest: RelayRequest
      let encodedCall: string
      let common: Common
      let legacyTx: Transaction
      let eip2930Transaction: AccessListEIP2930Transaction
      let eip1559Transaction: FeeMarketEIP1559Transaction
      let describeSnapshotId: string
      before(async function () {
        common = new Common({ chain: 'mainnet', hardfork: 'london' })
        // TODO: 'encodedCallArgs' is no longer needed. just keep the RelayRequest in test
        relayRequest =
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
              relayWorker: relayWorker,
              forwarder,
              paymaster: encodedCallArgs.paymaster,
              paymasterData,
              clientId
            }
          }
        encodedCall = relayHub.contract.methods.relayCall(10e6, relayRequest, '0xabcdef123456', '0x', 1e6).encodeABI()

        legacyTx = new Transaction({
          nonce: relayCallArgs.nonce,
          gasLimit: relayCallArgs.gasLimit,
          gasPrice: relayCallArgs.gasPrice,
          to: relayHub.address,
          value: relayCallArgs.value,
          data: encodedCall
        }, { common })

        eip2930Transaction = AccessListEIP2930Transaction.fromTxData(legacyTx, { common })
        eip1559Transaction = FeeMarketEIP1559Transaction.fromTxData({
          nonce: relayCallArgs.nonce,
          gasLimit: relayCallArgs.gasLimit,
          to: relayHub.address,
          value: relayCallArgs.value,
          data: encodedCall
        }, { common })
      })

      beforeEach(async function () {
        describeSnapshotId = (await snapshot()).result
      })
      afterEach(async function () {
        await revert(describeSnapshotId)
      })

      describe('#decodeTransaction', function () {
        it('should decode TransactionType1 tx', async function () {
          const input = [bnToRlp(eip2930Transaction.chainId), bnToRlp(eip2930Transaction.nonce), bnToRlp(eip2930Transaction.gasPrice), bnToRlp(eip2930Transaction.gasLimit), eip2930Transaction.to!.toBuffer(), bnToRlp(eip2930Transaction.value), eip2930Transaction.data, eip2930Transaction.accessList]
          const penalizableTxData = `0x01${encode(input).toString('hex')}`
          const decodedTx = await penalizer.decodeTransaction(penalizableTxData)
          // @ts-ignore
          validateDecodedTx(decodedTx, eip2930Transaction)
        })
        it('should decode new TransactionType2 tx', async function () {
          const input = [bnToRlp(eip1559Transaction.chainId), bnToRlp(eip1559Transaction.nonce), bnToRlp(eip1559Transaction.maxPriorityFeePerGas), bnToRlp(eip1559Transaction.maxFeePerGas), bnToRlp(eip1559Transaction.gasLimit), eip1559Transaction.to!.toBuffer(), bnToRlp(eip1559Transaction.value), eip1559Transaction.data, eip1559Transaction.accessList]
          const penalizableTxData = `0x02${encode(input).toString('hex')}`
          const decodedTx = await penalizer.decodeTransaction(penalizableTxData)
          // @ts-ignore
          validateDecodedTx(decodedTx, eip1559Transaction)
        })
        it('should decode legacy tx', async function () {
          const input = [bnToRlp(legacyTx.nonce), bnToRlp(legacyTx.gasPrice), bnToRlp(legacyTx.gasLimit), legacyTx.to!.toBuffer(), bnToRlp(legacyTx.value), legacyTx.data]
          const penalizableTxData = `0x${encode(input).toString('hex')}`
          const decodedTx = await penalizer.decodeTransaction(penalizableTxData)
          // @ts-ignore
          validateDecodedTx(decodedTx, legacyTx)
        })
      })

      it('should not penalize TransactionType1 tx', async function () {
        const signedTx = eip2930Transaction.sign(relayCallArgs.privateKey)
        const input = [bnToRlp(eip2930Transaction.chainId), bnToRlp(eip2930Transaction.nonce), bnToRlp(eip2930Transaction.gasPrice), bnToRlp(eip2930Transaction.gasLimit), eip2930Transaction.to!.toBuffer(), bnToRlp(eip2930Transaction.value), eip2930Transaction.data, eip2930Transaction.accessList]
        const penalizableTxData = `0x01${encode(input).toString('hex')}`

        const newV = (signedTx.v!.toNumber() + 27)
        const penalizableTxSignature = signatureRSV2Hex(signedTx.r!, signedTx.s!, newV)

        const request = penalizer.contract.methods.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x').encodeABI()

        // eslint-disable-next-line
        const commitHash = web3.utils.keccak256(web3.utils.keccak256(request) + committer.slice(2))
        await penalizer.commit(commitHash, { from: committer })
        await evmMineMany(10)
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x', { from: committer }),
          'Legal relay transaction'
        )
      })

      it('should not penalize TransactionType2 tx', async function () {
        const signedTx = eip1559Transaction.sign(relayCallArgs.privateKey)
        const input = [bnToRlp(eip1559Transaction.chainId), bnToRlp(eip1559Transaction.nonce), bnToRlp(eip1559Transaction.maxPriorityFeePerGas), bnToRlp(eip1559Transaction.maxFeePerGas), bnToRlp(eip1559Transaction.gasLimit), eip1559Transaction.to!.toBuffer(), bnToRlp(eip1559Transaction.value), eip1559Transaction.data, eip1559Transaction.accessList]
        const penalizableTxData = `0x02${encode(input).toString('hex')}`

        const newV = (signedTx.v!.toNumber() + 27)
        const penalizableTxSignature = signatureRSV2Hex(signedTx.r!, signedTx.s!, newV)

        const request = penalizer.contract.methods.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x').encodeABI()

        // eslint-disable-next-line
        const commitHash = web3.utils.keccak256(web3.utils.keccak256(request) + committer.slice(2))
        await penalizer.commit(commitHash, { from: committer })
        await evmMineMany(10)
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x', { from: committer }),
          'Legal relay transaction'
        )
      });

      // legacy tx first byte is in [0xc0, 0xfe]
      ['bf', 'ff'].forEach(byteToSign => {
        it('should penalize any non legacy tx format signed bytes', async function () {
          const bufferToSign = Buffer.from(byteToSign, 'hex')
          const msgHash = keccak256(bufferToSign)
          const sig = ecsign(msgHash, relayWorkerPrivateKey)
          const penalizableTxSignature = signatureRSV2Hex(sig.r, sig.s, sig.v)
          const request = penalizer.contract.methods.penalizeIllegalTransaction(bufferToSign, penalizableTxSignature, relayHub.address, '0x').encodeABI()
          // eslint-disable-next-line
          const commitHash = web3.utils.keccak256(web3.utils.keccak256(request) + committer.slice(2))
          await penalizer.commit(commitHash, { from: committer })
          await evmMineMany(10)
          const res = await penalizer.penalizeIllegalTransaction(bufferToHex(bufferToSign), penalizableTxSignature, relayHub.address, '0x', { from: committer })
          expectEvent(res, 'StakePenalized', { relayManager: relayManager, beneficiary: committer, reward: stake.divn(2) })
        })
      })
    })

    before('register reporter as relayer', async function () {
      await stakeManager.setRelayManagerOwner(relayOwner, { from: reporterRelayManager })
      await stakeManager.stakeForRelayManager(reporterRelayManager, 1000, {
        value: ether('1'),
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(reporterRelayManager, relayHub.address, { from: relayOwner })
    })

    async function commitPenalizationAndReturnMethod (method: any, ...args: any[]): Promise<any> {
      const methodInvoked = method(...args, '0x00000000')
      const penalizeMsgData = methodInvoked.encodeABI()

      const defaultOptions: Truffle.TransactionDetails = {
        from: reporterRelayManager,
        gasPrice: 1e9
      }
      // commit to penalization and mine some blocks
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      // @ts-ignore
      const commitHash = web3.utils.keccak256(`${web3.utils.keccak256(penalizeMsgData)}${defaultOptions.from.slice(2).toLowerCase()}`)
      await penalizer.commit(commitHash, defaultOptions)
      await evmMineMany(6)
      return methodInvoked
    }
    // Receives a function that will penalize the relay and tests that call for a penalization, including checking the
    // emitted event and penalization reward transfer. Returns the transaction receipt.
    async function expectPenalization (methodInvoked: any, overrideOptions: Truffle.TransactionDetails = {}): Promise<any> {
      const defaultOptions: Truffle.TransactionDetails = {
        from: reporterRelayManager,
        gas: '1000000',
        gasPrice: 1e9
      }

      const reporterBalanceTracker = await balance.tracker(defaultOptions.from)
      const stakeManagerBalanceTracker = await balance.tracker(stakeManager.address)
      const stakeInfo = await stakeManager.stakes(relayManager)
      // @ts-ignore (names)
      const stake = stakeInfo.stake

      // A gas price of zero makes checking the balance difference simpler
      const mergedOptions: Truffle.TransactionDetails = Object.assign({}, defaultOptions, overrideOptions)
      const receipt = await new Promise(
        (resolve: any, reject: any) => methodInvoked.send(mergedOptions)
          .then(function (receipt: any) {
            resolve(receipt)
          })
          .catch(function (reason: any) {
            reject(reason)
          })
      )
      // @ts-ignore
      const txCost = toBN(receipt.gasUsed).mul(toBN(receipt.effectiveGasPrice))
      /*
       * TODO: abiDecoder is needed to decode raw Web3.js transactions
      await expectEvent.inTransaction(rec, Penalizer, {
        relayManager: relayManager,
        beneficiary: reporterRelayManager,
        reward: expectedReward
      })

       */
      // The reporter gets half of the stake
      expect(await reporterBalanceTracker.delta()).to.be.bignumber.equals(stake.divn(2).sub(txCost))

      // The other half is burned, so StakeManager's balance is decreased by the full stake
      expect(await stakeManagerBalanceTracker.delta()).to.be.bignumber.equals(stake.neg())

      return receipt
    }

    describe('penalize with commit/reveal', function () {
      let request: string
      let penalizableTxData: string
      let penalizableTxSignature: string
      before(async function () {
        const receipt = await web3.eth.sendTransaction({ from: anotherRelayWorker, to: other, value: ether('0.5'), gasPrice: 1e9 }) as TransactionReceipt;
        ({
          data: penalizableTxData,
          signature: penalizableTxSignature
        } = await getDataAndSignatureFromHash(receipt.transactionHash, chainId))
        request = penalizer.contract.methods.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x').encodeABI()
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        const commitHash = web3.utils.keccak256(`${web3.utils.keccak256(request)}${committer.slice(2)}`)
        await penalizer.commit(commitHash, { from: committer })
      })
      it('should fail to penalize too soon after commit', async () => {
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x', { from: committer }),
          'reveal penalize too soon'
        )
      })

      it('should fail to penalize too late after commit', async () => {
        const id = (await snapshot()).result
        await evmMineMany(50)
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x', { from: committer }),
          'reveal penalize too late'
        )
        await revert(id)
      })

      it('should fail to penalize with incorrect randomValue', async () => {
        const id = (await snapshot()).result
        request = penalizer.contract.methods.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0xcafef00d').encodeABI()
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        const commitHash = web3.utils.keccak256(`${web3.utils.keccak256(request)}${committer.slice(2)}`)
        await penalizer.commit(commitHash, { from: committer })
        await evmMineMany(10)
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0xdeadbeef', { from: committer }),
          'no commit'
        )
        // this is not a failure: it passes the Penalizer modifier test (commit test),
        // it then reverts inside the RelayHub (since we didn't fully initialize this relay/worker)
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0xcafef00d', { from: committer }),
          'Unknown relay worker'
        )
        await revert(id)
      })

      it('should reject penalize if method call differs', async () => {
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature + '00', relayHub.address, '0x', { from: committer }),
          'no commit'
        )
      })

      it('should reject penalize if commit called from another account', async () => {
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x', { from: nonCommitter }),
          'no commit'
        )
      })

      it('should allow penalize after commit', async () => {
        await evmMineMany(10)
        // this is not a failure: it passes the Penalizer modifier test (commit test),
        // it then reverts inside the RelayHub (since we didn't fully initialize this relay/worker)
        await expectRevert(
          penalizer.penalizeIllegalTransaction(penalizableTxData, penalizableTxSignature, relayHub.address, '0x', { from: committer }),
          'Unknown relay worker'
        )
      })
      it('penalizeRepeatedNonce', async function () {
        const method = await commitPenalizationAndReturnMethod(
          penalizer.contract.methods.penalizeRepeatedNonce, penalizableTxData, penalizableTxSignature, penalizableTxData, penalizableTxSignature, relayHub.address)
        await expectRevert(
          method.send({ from: other }),
          'no commit'
        )

        // this is not a failure: it passes the Penalizer modifier test (commit test),
        // it then reverts on a transaction validity test
        await expectRevert(
          method.send({ from: reporterRelayManager }),
          'tx is equal'
        )
      })
    })

    describe('penalizable behaviors', function () {
      before(function () {
        // @ts-ignore
        expect(privateToAddress(relayCallArgs.privateKey).toString('hex')).to.equal(relayWorker.toLowerCase())
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
          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeRepeatedNonce,
            txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address
          )
          await expectPenalization(method)
        })

        it('penalizes transactions with same nonce and different gas limit', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { gasLimit: 100 })), chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeRepeatedNonce, txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)
          await expectPenalization(method)
        })

        it('penalizes transactions with same nonce and different value', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, Object.assign({}, relayCallArgs, { value: 100 })), chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeRepeatedNonce, txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)
          await expectPenalization(method)
        })

        it('does not penalize transactions with same nonce and data, value, gasLimit, destination', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { gasPrice: 70 }) // only gasPrice may be different
          ), chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeRepeatedNonce, txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)
          await expectRevert(
            method.send({ from: reporterRelayManager, gas: 5e5 }),
            'tx is equal'
          )
        })

        it('does not penalize transactions with different nonces', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { nonce: 1 })
          ), chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeRepeatedNonce, txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)
          await expectRevert(
            method.send({ from: reporterRelayManager, gas: 5e5 }),
            'Different nonce'
          )
        })

        it('does not penalize transactions with same nonce from different relays', async function () {
          const txDataSigA = getDataAndSignature(encodeRelayCallEIP155(encodedCallArgs, relayCallArgs), chainId)
          const txDataSigB = getDataAndSignature(encodeRelayCallEIP155(
            encodedCallArgs,
            Object.assign({}, relayCallArgs, { privateKey: Buffer.from('0123456789012345678901234567890123456789012345678901234567890123', 'hex') })
          ), chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeRepeatedNonce, txDataSigA.data, txDataSigA.signature, txDataSigB.data, txDataSigB.signature, relayHub.address)
          await expectRevert(
            method.send({ from: reporterRelayManager }),
            'Different signer'
          )
        })
      })

      describe('illegal call', function () {
        // TODO: this tests are excessive, and have a lot of tedious build-up
        it('penalizes relay transactions to addresses other than RelayHub', async function () {
          // Relay sending ether to another account
          const receipt = await web3.eth.sendTransaction({ from: relayWorker, to: other, value: ether('0.5'), gasPrice: 1e9 }) as TransactionReceipt
          const { data, signature } = await getDataAndSignatureFromHash(receipt.transactionHash, chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeIllegalTransaction, data, signature, relayHub.address)

          await expectPenalization(method)
        })

        it('penalizes relay worker transactions to illegal RelayHub functions (stake)', async function () {
          await stakeManager.setRelayManagerOwner(relayWorker, { from: other })
          // Relay staking for a second relay
          const { tx } = await stakeManager.stakeForRelayManager(other, 1000, {
            value: ether('1'),
            from: relayWorker
          })
          const { data, signature } = await getDataAndSignatureFromHash(tx, chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeIllegalTransaction, data, signature, relayHub.address)

          await expectPenalization(method)
        })

        it('should penalize relays for lying about transaction gas limit RelayHub', async function () {
          const { gasPrice, gasLimit, relayRequest, signature } = await prepareRelayCall()
          await relayHub.depositFor(paymaster.address, {
            from: other,
            value: ether('1'),
            gasPrice: 1e9
          })
          const relayCallTx = await relayHub.relayCall(10e6, relayRequest, signature, '0x', gasLimit.add(new BN(1e6 - 1)), {
            from: relayWorker,
            gas: gasLimit.add(new BN(1e6)),
            gasPrice
          })

          const relayCallTxDataSig = await getDataAndSignatureFromHash(relayCallTx.tx, chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeIllegalTransaction, relayCallTxDataSig.data, relayCallTxDataSig.signature, relayHub.address)

          await expectPenalization(method)
        })

        it('should penalize even after the relayer unlocked stake', async function () {
          const id = (await snapshot()).result
          const { gasPrice, gasLimit, relayRequest, signature } = await prepareRelayCall()
          await relayHub.depositFor(paymaster.address, {
            from: other,
            value: ether('1')
          })
          const relayCallTx = await relayHub.relayCall(10e6, relayRequest, signature, '0x', gasLimit.add(new BN(1e6 - 1)), {
            from: relayWorker,
            gas: gasLimit.add(new BN(1e6)),
            gasPrice
          })

          const res = await stakeManager.unlockStake(relayManager, { from: relayOwner })
          expectEvent(res, StakeUnlocked, {
            relayManager,
            owner: relayOwner
          })
          const relayCallTxDataSig = await getDataAndSignatureFromHash(relayCallTx.tx, chainId)

          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeIllegalTransaction, relayCallTxDataSig.data, relayCallTxDataSig.signature, relayHub.address)

          await expectPenalization(method)
          await revert(id)
        })

        it('does not penalize legal relay transactions', async function () {
          // relayCall is a legal transaction
          const baseFee = new BN('300')
          const fee = new BN('10')
          const gasPrice = new BN(1e9)
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
          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeIllegalTransaction, relayCallTxDataSig.data, relayCallTxDataSig.signature, relayHub.address)
          await expectRevert(
            method.send({ from: reporterRelayManager }),
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
          const receipt = await web3.eth.sendTransaction({ from: anotherRelayWorker, to: other, value: ether('0.5'), gasPrice: 1e9 }) as TransactionReceipt;
          ({
            data: penalizableTxData,
            signature: penalizableTxSignature
          } = await getDataAndSignatureFromHash(receipt.transactionHash, chainId))
        })

        // All of these tests use the same penalization function (we one we set up in the beforeEach block)
        async function penalize (): Promise<void> {
          const method = await commitPenalizationAndReturnMethod(
            penalizer.contract.methods.penalizeIllegalTransaction, penalizableTxData, penalizableTxSignature, relayHub.address)
          return await expectPenalization(method)
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
            await relayHub.addRelayWorkers([anotherRelayWorker], { from: relayManager })
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
      const relayWorker = privateToAddress(relayCallArgs.privateKey).toString('hex')
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

      const transaction = Transaction.fromTxData({
        nonce: relayCallArgs.nonce,
        gasLimit: relayCallArgs.gasLimit,
        gasPrice: relayCallArgs.gasPrice,
        to: relayHub.address,
        value: relayCallArgs.value,
        data: encodedCall
      }, transactionOptions)

      const signedTx = transaction.sign(relayCallArgs.privateKey)
      return signedTx
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

    function validateDecodedTx (decodedTx: { nonce: string, gasPrice: string, gasLimit: string, to: string, value: string, data: string}, originalTx: AccessListEIP2930Transaction | Transaction): void {
      assert.equal(decodedTx.nonce, originalTx.nonce.toString())
      assert.equal(decodedTx.gasLimit, originalTx.gasLimit.toString())
      assert.equal(removeHexPrefix(decodedTx.data), originalTx.data.toString('hex'))
      assert.equal(decodedTx.to.toLowerCase(), originalTx.to!.toString().toLowerCase())
      assert.equal(decodedTx.value, originalTx.value.toString())
    }
  })
})
