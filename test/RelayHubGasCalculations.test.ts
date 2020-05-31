import BN from 'bn.js'
import { ether, expectEvent } from '@openzeppelin/test-helpers'

import { calculateTransactionMaxPossibleGas, getEip712Signature } from '../src/common/Utils'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import { defaultEnvironment } from '../src/relayclient/types/Environments'
import RelayRequest, { cloneRelayRequest } from '../src/common/EIP712/RelayRequest'

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

require('source-map-support').install({ errorFormatterForce: true })

contract('RelayHub gas calculations', function ([_, relayOwner, relayWorker, relayManager, senderAddress, other]) {
  const message = 'Gas Calculations'
  const unstakeDelay = 1000
  const chainId = defaultEnvironment.chainId
  const baseFee = new BN('300')
  const fee = new BN('10')
  const gasPrice = new BN('10')
  const gasLimit = new BN('1000000')
  const externalGasLimit = 5e6.toString()

  const senderNonce = new BN('0')
  const magicNumbers = {
    arc: 867,
    pre: 1486,
    post: 1583
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
    relayHub = await RelayHub.new(stakeManager.address, penalizer.address)
    await paymaster.setRelayHub(relayHub.address)
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
    relayRequest = {
      encodedFunction,
      target: recipient.address,
      relayData: {
        senderAddress,
        relayWorker,
        senderNonce: senderNonce.toString(),
        paymaster: paymaster.address,
        forwarder
      },
      gasData: {
        baseRelayFee: baseFee.toString(),
        pctRelayFee: fee.toString(),
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString()
      }
    }
    const dataToSign = new TypedRequestData(
      chainId,
      forwarder,
      relayRequest
    )
    signature = await getEip712Signature(
      web3,
      dataToSign
    )
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
        console.log('gas limit=', transactionGasLimit.toNumber() / 1e9, 'gwei')
        const { tx } = await relayHub.relayCall(relayRequest, signature, '0x', transactionGasLimit, {
          from: relayWorker,
          gas: transactionGasLimit.toString(),
          gasPrice
        })
        const gasLimits = await paymaster.getGasLimits()
        const hubOverhead = (await relayHub.getHubOverhead()).toNumber()
        const maxPossibleGas = calculateTransactionMaxPossibleGas({
          gasLimits,
          hubOverhead,
          relayCallGasLimit: gasLimit.toString()
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
      await misbehavingPaymaster.setRelayHub(relayHub.address)
      await misbehavingPaymaster.deposit({ value: ether('0.1') })
      await misbehavingPaymaster.setOverspendAcceptGas(true)

      const senderNonce = (await forwarderInstance.getNonce(senderAddress)).toString()
      const relayRequestMisbehaving = cloneRelayRequest(relayRequest)
      relayRequestMisbehaving.relayData.paymaster = misbehavingPaymaster.address
      relayRequestMisbehaving.relayData.senderNonce = senderNonce
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequestMisbehaving
      )
      const signature = await getEip712Signature(
        web3,
        dataToSign
      )
      const canRelayResponse =
        await relayHub.contract.methods
          .relayCall(relayRequestMisbehaving, signature, '0x', externalGasLimit)
          .call({ from: relayRequestMisbehaving.relayData.relayWorker, gas: externalGasLimit })
      assert.equal(canRelayResponse[0], false)
      assert.equal(canRelayResponse[1], '') // no revert string on out-of-gas

      const res = await relayHub.relayCall(relayRequestMisbehaving, signature, '0x', externalGasLimit, {
        from: relayWorker,
        gas: externalGasLimit,
        gasPrice: gasPrice
      })

      assert.equal('TransactionRejectedByPaymaster', res.logs[0].event)
      assert.equal(res.logs[0].args.reason, '')
    })
  })

  async function getBalances (): Promise<{
    paymasters: BN
    relayWorkers: BN
    relayManagers: BN
  }> {
    const paymasters = await relayHub.balanceOf(paymaster.address)
    // @ts-ignore
    const relayWorkers = new BN(await web3.eth.getBalance(relayWorker))
    const relayManagers = await relayHub.balanceOf(relayManager)
    return {
      paymasters,
      relayWorkers,
      relayManagers
    }
  }

  function logOverhead (weiActualCharge: BN, workerGasUsed: BN): void {
    const gasDiff = workerGasUsed.sub(weiActualCharge).div(gasPrice).toString()
    if (gasDiff !== '0') {
      console.log('== zero-fee unmatched gas. RelayHub.GAS_OVERHEAD should be increased by: ' + gasDiff.toString())
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
              const baseRelayFee = '0'
              const relayRequest: RelayRequest = {
                target: recipient.address,
                encodedFunction,
                relayData: {
                  senderAddress,
                  senderNonce,
                  relayWorker,
                  paymaster: paymaster.address,
                  forwarder
                },
                gasData: {
                  baseRelayFee,
                  pctRelayFee,
                  gasPrice: gasPrice.toString(),
                  gasLimit: gasLimit.toString()
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
              const res = await relayHub.relayCall(relayRequest, signature, '0x', externalGasLimit, {
                from: relayWorker,
                gas: externalGasLimit,
                gasPrice: gasPrice
              })

              const afterBalances = await getBalances()
              assert.notEqual(beforeBalances.relayManagers.toString(), afterBalances.relayManagers.toString(), 'manager not compensated. transaction must have failed')

              // how much we got compensated for this tx from the paymaster
              const weiActualCharge = afterBalances.relayManagers.sub(beforeBalances.relayManagers)

              // how much gas we actually spent on this tx
              const workerWeiGasUsed = beforeBalances.relayWorkers.sub(afterBalances.relayWorkers)

              // sanity: worker executed and paid this tx
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              assert.equal((res.receipt.gasUsed * gasPrice).toString(), workerWeiGasUsed.toString(), 'where else did the money go?')

              // const txRelayed:any = res.logs.find(e=>e.event=='TransactionRelayed')
              // assert.equal(res.receipt.gasUsed, txRelayed.args.gasUsed.toNumber(),
              //     'GAS_OVERHEAD: add='+(res.receipt.gasUsed-txRelayed.args.gasUsed.toNumber()))

              const expectedCharge = Math.floor(workerWeiGasUsed.toNumber() * (100 + requestedFee) / 100) + parseInt(baseRelayFee)
              assert.closeTo(weiActualCharge.toNumber(), expectedCharge, 0,
                'actual charge from paymaster higher than expected. diff= ' + ((weiActualCharge.toNumber() - expectedCharge) / gasPrice.toNumber()).toString())

              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              if (requestedFee === 0) logOverhead(weiActualCharge, workerWeiGasUsed)

              // Validate actual profit is with high precision $(requestedFee) percent higher then ether spent relaying
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              const expectedActualCharge = workerWeiGasUsed.mul(new BN(requestedFee).add(new BN(100))).div(new BN(100))
              assert.equal(weiActualCharge.toNumber(), expectedActualCharge.toNumber(),
                'unexpected over-paying by ' + (weiActualCharge.sub(expectedActualCharge)).toString())
              // Check that relay did pay it's gas fee by himself.
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              const expectedBalanceAfter = beforeBalances.relayWorkers.subn(res.receipt.gasUsed * gasPrice)
              assert.equal(expectedBalanceAfter.cmp(afterBalances.relayWorkers), 0, 'relay did not pay the expected gas fees')

              // Check that relay's weiActualCharge is deducted from paymaster's stake.
              // @ts-ignore (this types will be implicitly cast to correct ones in JavaScript)
              const expectedPaymasterBalance = beforeBalances.paymasters.sub(weiActualCharge)
              assert.equal(expectedPaymasterBalance.toString(), afterBalances.paymasters.toString())
            })
          })
      )
  })
})
