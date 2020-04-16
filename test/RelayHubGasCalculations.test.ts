import BN from 'bn.js'
import { ether, expectEvent } from '@openzeppelin/test-helpers'

import { calculateTransactionMaxPossibleGas, getEip712Signature } from '../src/common/utils'
import getDataToSign from '../src/common/EIP712/Eip712Helper'
import { defaultEnvironment } from '../src/relayclient/types/Environments'
import RelayRequest from '../src/common/EIP712/RelayRequest'

import {
  RelayHubInstance,
  TestRecipientInstance,
  TestPaymasterVariableGasLimitsInstance,
  StakeManagerInstance,
  ITrustedForwarderInstance,
  PenalizerInstance
} from '../types/truffle-contracts'

const RelayHub = artifacts.require('RelayHub')
const TrustedForwarder = artifacts.require('TrustedForwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterVariableGasLimits = artifacts.require('TestPaymasterVariableGasLimits')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

function correctGasCost (buffer: Buffer, nonzerocost: number, zerocost: number): number {
  let gasCost = 0
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) {
      gasCost += zerocost
    } else {
      gasCost += nonzerocost
    }
  }
  return gasCost
}

contract('RelayHub gas calculations', function ([_, relayOwner, relayWorker, relayManager, senderAddress, other]) {
  const message = 'Gas Calculations'
  const unstakeDelay = 1000
  const chainId = defaultEnvironment.chainId
  const gtxdatanonzero = defaultEnvironment.gtxdatanonzero
  const gtxdatazero = defaultEnvironment.gtxdatazero
  const baseFee = new BN('300')
  const fee = new BN('10')
  const gasPrice = new BN('10')
  const gasLimit = new BN('1000000')
  const senderNonce = new BN('0')
  const magicNumbers = {
    arc: 805 - 6 - 62,
    pre: 1839 + 22 - 95,
    post: 2080 - 112
  }

  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance
  let paymaster: TestPaymasterVariableGasLimitsInstance
  let forwarderInstance: ITrustedForwarderInstance
  let encodedFunction
  let signature: string
  let relayRequest: RelayRequest
  let forwarder: string

  beforeEach(async function prepareForHub () {
    recipient = await TestRecipient.new()
    forwarder = await recipient.getTrustedForwarder()
    forwarderInstance = await TrustedForwarder.at(forwarder)
    paymaster = await TestPaymasterVariableGasLimits.new()
    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    relayHub = await RelayHub.new(defaultEnvironment.gtxdatanonzero, stakeManager.address, penalizer.address)
    await paymaster.setHub(relayHub.address)
    await relayHub.depositFor(paymaster.address, {
      value: ether('1'),
      from: other
    })
    await stakeManager.stakeForAddress(relayManager, unstakeDelay, {
      value: ether('2'),
      from: relayOwner
    })
    await stakeManager.authorizeHub(relayManager, relayHub.address, { from: relayOwner })
    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    await relayHub.registerRelayServer(0, fee, '', { from: relayManager })
    encodedFunction = recipient.contract.methods.emitMessage(message).encodeABI()
    relayRequest = new RelayRequest({
      senderAddress,
      relayWorker,
      encodedFunction,
      senderNonce: senderNonce.toString(),
      target: recipient.address,
      baseRelayFee: baseFee.toString(),
      pctRelayFee: fee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      paymaster: paymaster.address
    })
    const dataToSign = await getDataToSign({
      chainId,
      verifier: forwarder,
      relayRequest
    })
    signature = await getEip712Signature({
      web3,
      dataToSign
    })
  })

  describe('#calculateCharge()', function () {
    it('should calculate fee correctly', async function () {
      const gasUsed = 1e8
      const gasPrice = 1e9
      const baseRelayFee = 1000000
      const pctRelayFee = 10
      const fee = {
        pctRelayFee,
        baseRelayFee,
        gasPrice,
        gasLimit: 0
      }
      const charge = await relayHub.calculateCharge(gasUsed.toString(), fee)
      const expectedCharge = baseRelayFee + gasUsed * gasPrice * (pctRelayFee + 100) / 100
      assert.equal(charge.toString(), expectedCharge.toString())
    })
  })

  describe('#relayCall()', function () {
    it('should set correct gas limits and pass correct \'maxPossibleGas\' to the \'acceptRelayedCall\'',
      async function () {
        const transactionGasLimit = gasLimit.mul(new BN(3))
        const { tx } = await relayHub.relayCall(relayRequest, signature, '0x', {
          from: relayWorker,
          gas: transactionGasLimit.toString(),
          gasPrice
        })
        const calldata = relayHub.contract.methods.relayCall(relayRequest, signature, '0x').encodeABI()
        const calldataSize = calldata.length / 2 - 1
        const gasLimits = await paymaster.getGasLimits()
        const hubOverhead = (await relayHub.getHubOverhead()).toNumber()
        const maxPossibleGas = calculateTransactionMaxPossibleGas({
          gasLimits,
          hubOverhead,
          relayCallGasLimit: gasLimit.toNumber(),
          calldataSize,
          gtxdatanonzero
        })

        // Magic numbers seem to be gas spent on calldata. I don't know of a way to calculate them conveniently.
        await expectEvent.inTransaction(tx, TestPaymasterVariableGasLimits, 'SampleRecipientPreCallWithValues', {
          gasleft: (parseInt(gasLimits.preRelayedCallGasLimit) - magicNumbers.pre).toString(),
          arcGasleft: (parseInt(gasLimits.acceptRelayedCallGasLimit) - magicNumbers.arc).toString(),
          maxPossibleGas: maxPossibleGas.toString()
        })
        await expectEvent.inTransaction(tx, TestPaymasterVariableGasLimits, 'SampleRecipientPostCallWithValues', {
          gasleft: (parseInt(gasLimits.postRelayedCallGasLimit) - magicNumbers.post).toString()
        })
      })

    /**
     * This value is not accessible outside of the relay hub. This test must be added later.
     */
    it('should set correct gas limits and pass correct \'gasUsedWithoutPost\' to the \'postRelayCall\'')

    it('should revert an attempt to use more than allowed gas for acceptRelayedCall', async function () {
      // TODO: extract preparation to 'before' block
      const misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await misbehavingPaymaster.setHub(relayHub.address)
      await misbehavingPaymaster.deposit({ value: ether('0.1') })
      await misbehavingPaymaster.setOverspendAcceptGas(true)

      const senderNonce = (await forwarderInstance.getNonce(senderAddress)).toString()
      const relayRequestMisbehaving = relayRequest.clone()
      relayRequestMisbehaving.relayData.paymaster = misbehavingPaymaster.address
      relayRequestMisbehaving.relayData.senderNonce = senderNonce
      const dataToSign = await getDataToSign({
        chainId,
        verifier: forwarder,
        relayRequest: relayRequestMisbehaving
      })
      const signature = await getEip712Signature({
        web3,
        dataToSign
      })
      const maxPossibleGasIrrelevantValue = 8000000
      const acceptRelayedCallGasLimit = 50000
      const canRelayResponse = await relayHub.canRelay(relayRequestMisbehaving, maxPossibleGasIrrelevantValue, acceptRelayedCallGasLimit, signature, '0x')
      assert.equal(canRelayResponse[0], false)
      assert.equal(canRelayResponse[1], '') // no revert string on out-of-gas

      const res = await relayHub.relayCall(relayRequestMisbehaving, signature, '0x', {
        from: relayWorker,
        gasPrice: gasPrice
      })

      assert.equal('CanRelayFailed', res.logs[0].event)
      assert.equal(res.logs[0].args.reason, '')
    })
  })

  async function getBalances (): Promise<{
    relayRecipient: BN
    relayWorkers: BN
    relayManagers: BN
  }> {
    const relayRecipient = await relayHub.balanceOf(paymaster.address)
    // @ts-ignore
    const relayWorkers = new BN(await web3.eth.getBalance(relayWorker))
    const relayManagers = await relayHub.balanceOf(relayManager)
    return {
      relayRecipient,
      relayWorkers,
      relayManagers
    }
  }

  function calculateOverchargeForCalldata (relayRequest: RelayRequest, signature: string): BN {
    const calldata = relayHub.contract.methods.relayCall(relayRequest, signature, '0x').encodeABI()
    const calldataSize = calldata.length / 2 - 1
    const calldataBuffer = Buffer.from(calldata.slice(2), 'hex')
    const correctGasCost1 = correctGasCost(calldataBuffer, gtxdatanonzero, gtxdatazero)
    return new BN(calldataSize * gtxdatanonzero - correctGasCost1).mul(gasPrice)
  }

  function logOverhead (weiActualCharge: BN, overchargeForCalldata: BN, weiGasUsed: BN): void {
    const actualChargeWithoutOvercharge = weiActualCharge.sub(overchargeForCalldata)
    const gasDiff = weiGasUsed.sub(actualChargeWithoutOvercharge).div(gasPrice).toString()
    if (gasDiff !== '0') {
      console.log('== zero-fee unmatched gas. RelayHub.gasOverhead should be increased by: ' + gasDiff.toString())
    }
  }

  describe('check calculation does not break for different fees', function () {
    before(async function () {
      await relayHub.depositFor(relayOwner, { value: (1).toString() })
    });

    [0, 100, 1000, 50000]
      .forEach(messageLength =>
        [0, 1, 10, 100, 1000]
          .forEach(requestedFee => {
            // avoid duplicate coverage checks. they do the same, and take a lot of time:
            if (requestedFee !== 0 && messageLength !== 0 && process.env.MODE === 'coverage') return
            // 50k tests take more then 10 seconds to complete so will run once for sanity
            if (messageLength === 50000 && requestedFee !== 10) return
            it(`should compensate relay with requested fee of ${requestedFee.toString()}% with ${messageLength.toString()} calldata size`, async function () {
              const beforeBalances = await getBalances()
              const pctRelayFee = requestedFee.toString()
              const senderNonce = (await forwarderInstance.getNonce(senderAddress)).toString()
              const encodedFunction = recipient.contract.methods.emitMessage('a'.repeat(messageLength)).encodeABI()
              const relayRequest = new RelayRequest({
                senderAddress,
                target: recipient.address,
                encodedFunction,
                baseRelayFee: '0',
                pctRelayFee,
                gasPrice: gasPrice.toString(),
                gasLimit: gasLimit.toString(),
                senderNonce,
                relayWorker,
                paymaster: paymaster.address
              })
              const dataToSign = await getDataToSign({
                chainId,
                verifier: forwarder,
                relayRequest
              })
              const signature = await getEip712Signature({
                web3,
                dataToSign
              })
              const res = await relayHub.relayCall(relayRequest, signature, '0x', {
                from: relayWorker,
                gasPrice: gasPrice
              })
              const afterBalances = await getBalances()
              assert.notEqual(beforeBalances.relayManagers.toString(), afterBalances.relayManagers.toString(), 'transaction must have failed')
              const weiActualCharge = afterBalances.relayManagers.sub(beforeBalances.relayManagers)
              const weiGasUsed = beforeBalances.relayWorkers.sub(afterBalances.relayWorkers)
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              assert.equal((res.receipt.gasUsed * gasPrice).toString(), weiGasUsed.toString(), 'where else did the money go?')

              // the paymaster will always pay more for the transaction because the calldata is assumed to be nonzero
              const overchargeForCalldata = calculateOverchargeForCalldata(relayRequest, signature)
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              if (requestedFee === 0) logOverhead(weiActualCharge, overchargeForCalldata, weiGasUsed)

              // Validate actual profit is with high precision $(requestedFee) percent higher then ether spent relaying
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              const chargeBase = weiGasUsed.add(overchargeForCalldata)
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              const expectedActualCharge = chargeBase.mul(new BN(requestedFee).add(new BN(100))).div(new BN(100))
              const diffBN = expectedActualCharge.sub(weiActualCharge)
              const diff = Math.floor(parseInt(diffBN.abs().toString()))
              assert.equal(diff, 0)
              // Check that relay did pay it's gas fee by himself.
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              const expectedBalanceAfter = beforeBalances.relayWorkers.subn(res.receipt.gasUsed * gasPrice)
              assert.equal(expectedBalanceAfter.cmp(afterBalances.relayWorkers), 0, 'relay did not pay the expected gas fees')

              // Check that relay's weiActualCharge is deducted from recipient's stake.
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              const expectedRecipientBalance = beforeBalances.relayRecipient.sub(weiActualCharge)
              assert.equal(expectedRecipientBalance.toString(), afterBalances.relayRecipient.toString())
            })
          })
      )
  })
})
