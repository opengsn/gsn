/* global BigInt */
const Big = require('big.js')
const { BN, ether, expectEvent, time } = require('@openzeppelin/test-helpers')

const { getRelayRequest, getTransactionGasData, getEip712Signature } = require('../src/js/relayclient/utils')
const Environments = require('../src/js/relayclient/Environments')

const RelayHub = artifacts.require('./RelayHub.sol')
const TestRecipient = artifacts.require('./test/TestRecipient')
const TestSponsorVariableGasLimits = artifacts.require('./TestSponsorVariableGasLimits.sol')
const TestSponsorConfigurableMisbehavior = artifacts.require('./test/TestSponsorConfigurableMisbehavior.sol')

function correctGasCost (buffer, nonzerocost, zerocost) {
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

contract('RelayHub gas calculations', async function ([_, relayOwner, relayAddress, otherRelay, senderAccount, other]) {
  const message = 'Gas Calculations'
  const unstakeDelay = time.duration.weeks(4)
  const gtxdatanonzero = Environments.istanbul.gtxdatanonzero
  const fee = new BN('10')
  const gasPrice = new BN('10')
  const gasLimit = new BN('1000000')
  const senderNonce = new BN('0')
  const magicNumbers = {
    arc: 805,
    pre: 1839,
    post: 2277
  }

  let relayHub
  let recipient
  let gasSponsor
  let encodedFunction
  let signature
  let sharedSigValues

  function getSignature (param) {
    return getEip712Signature(param)
  }

  async function prepareForHub () {
    recipient = await TestRecipient.new()
    gasSponsor = await TestSponsorVariableGasLimits.new()
    await gasSponsor.setHub(relayHub.address)
    await relayHub.depositFor(gasSponsor.address, {
      value: ether('1'),
      from: other
    })
    await relayHub.stake(relayAddress, unstakeDelay, {
      value: ether('2'),
      from: relayOwner
    })
    await relayHub.registerRelay(fee, '', { from: relayAddress })
    encodedFunction = recipient.contract.methods.emitMessage(message).encodeABI()
    sharedSigValues = {
      web3,
      senderAccount,
      relayAddress,
      encodedFunction,
      senderNonce: senderNonce.toString(),
      target: recipient.address,
      pctRelayFee: fee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      relayHub: relayHub.address,
      gasSponsor: gasSponsor.address
    }
  }

  before(async function () {
    relayHub = await RelayHub.deployed()
    await prepareForHub();
    ({ signature } = await getSignature(
      {
        ...sharedSigValues
      }
    ))
  })

  describe('#calculateCharge()', async function () {
    it('should calculate fee correctly', async function () {
      const gas = BigInt(1e8)
      const gasPrice = BigInt(1e9)
      const fee = BigInt(10)
      const charge = await relayHub.calculateCharge(gas.toString(), gasPrice.toString(), fee.toString())
      const expectedCharge = gas * gasPrice * (fee + BigInt(100)) / BigInt(100)
      assert.equal(charge.toString(), expectedCharge.toString())
    })
  })

  describe('#relayCall()', async function () {
    it('should set correct gas limits and pass correct \'maxPossibleGas\' to the \'acceptRelayedCall\'',
      async function () {
        const relayRequest = getRelayRequest(senderAccount, recipient.address, encodedFunction,
          fee, gasPrice, gasLimit, senderNonce, relayAddress, gasSponsor.address)

        const transactionGasLimit = gasLimit.mul(new BN(3))
        const { tx } = await relayHub.relayCall(relayRequest, signature, '0x', {
          from: relayAddress,
          gas: transactionGasLimit.toString(),
          gasPrice
        })
        const calldata = relayHub.contract.methods.relayCall(relayRequest, signature, '0x').encodeABI()
        const calldataSize = calldata.length / 2 - 1
        const gasData = await getTransactionGasData({
          gasSponsor,
          relayHub,
          calldataSize,
          gtxdatanonzero,
          relayCallGasLimit: gasLimit.toNumber(),
          gasPrice: gasPrice.toNumber(),
          fee: fee.toNumber()
        })

        // Magic numbers seem to be gas spent on calldata. I don't know of a way to calculate them conveniently.
        await expectEvent.inTransaction(tx, TestSponsorVariableGasLimits, 'SampleRecipientPreCallWithValues', {
          gasleft: (gasData.preRelayedCallGasLimit - magicNumbers.pre).toString(),
          arcGasleft: (gasData.acceptRelayedCallGasLimit - magicNumbers.arc).toString(),
          maxPossibleGas: gasData.maxPossibleGas.toString()
        })
        await expectEvent.inTransaction(tx, TestSponsorVariableGasLimits, 'SampleRecipientPostCallWithValues', {
          gasleft: (gasData.postRelayedCallGasLimit - magicNumbers.post).toString()
        })
      })

    /**
     * This value is not accessible outside of the relay hub. This test must be added later.
     */
    it('should set correct gas limits and pass correct \'gasUsedWithoutPost\' to the \'postRelayCall\'')

    it('should revert an attempt to use more than allowed gas for acceptRelayedCall', async function () {
      // TODO: extract preparation to 'before' block
      const misbehavingSponsor = await TestSponsorConfigurableMisbehavior.new()
      await misbehavingSponsor.setHub(relayHub.address)
      await misbehavingSponsor.deposit({ value: 1e17 })
      const AcceptRelayedCallReverted = 3
      await misbehavingSponsor.setOverspendAcceptGas(true)

      const senderNonce = (await relayHub.getNonce(senderAccount)).toString()
      const { signature } = await getSignature({
        ...sharedSigValues,
        senderNonce,
        gasSponsor: misbehavingSponsor.address
      })
      const maxPossibleGasIrrelevantValue = 8000000
      const acceptRelayedCallGasLimit = 50000
      const relayRequest = getRelayRequest(senderAccount, recipient.address, encodedFunction,
        fee, gasPrice, gasLimit, senderNonce, relayAddress, misbehavingSponsor.address)
      const canRelayResponse = await relayHub.canRelay(relayRequest, maxPossibleGasIrrelevantValue, acceptRelayedCallGasLimit, signature, '0x')
      assert.equal(AcceptRelayedCallReverted, canRelayResponse.status)

      const res = await relayHub.relayCall(relayRequest, signature, '0x', {
        from: relayAddress,
        gasPrice: gasPrice
      })

      assert.equal('CanRelayFailed', res.logs[0].event)
      assert.equal(AcceptRelayedCallReverted, res.logs[0].args.reason)
    })
  })

  async function getBalances () {
    const relayRecipient = await relayHub.balanceOf(gasSponsor.address)
    const relay = new Big(await web3.eth.getBalance(relayAddress))
    const relayOwners = await relayHub.balanceOf(relayOwner)
    return {
      relayRecipient,
      relay,
      relayOwners
    }
  }

  function calculateOverchargeForCalldata (relayRequest, signature) {
    const calldata = relayHub.contract.methods.relayCall(relayRequest, signature, '0x').encodeABI()
    const calldataSize = calldata.length / 2 - 1
    const calldataBuffer = Buffer.from(calldata.slice(2), 'hex')
    const correctGasCost1 = correctGasCost(calldataBuffer, gtxdatanonzero, 4, 3)
    return new BN(calldataSize * gtxdatanonzero - correctGasCost1).mul(gasPrice)
  }

  function logOverhead (weiActualCharge, overchargeForCalldata, weiGasUsed) {
    const actualChargeWithoutOvercharge = weiActualCharge.sub(overchargeForCalldata)
    const gasDiff = weiGasUsed.sub(actualChargeWithoutOvercharge).div(gasPrice).toString()
    if (gasDiff !== '0') {
      console.log('== zero-fee unmatched gas. RelayHub.gasOverhead should be increased by: ' + gasDiff.toString())
    }
  }

  describe('check calculation does not for different fees', async function () {
    before(async function () {
      await relayHub.depositFor(relayOwner, { value: 1 })
    });

    [0, 100, 1000, 50000]
      .forEach(messageLength =>
        [0, 1, 10, 100, 1000]
          .forEach(requestedFee => {
            // avoid duplicate coverage checks. they do the same, and take a lot of time:
            if (requestedFee !== 0 && messageLength !== 0 && process.env.MODE === 'coverage') return
            // 50k tests take more then 10 seconds to complete so will run once for sanity
            if (messageLength === 50000 && requestedFee !== 10) return
            it(`should compensate relay with requested fee of ${requestedFee}% with ${messageLength} calldata size`, async function () {
              const beforeBalances = await getBalances()
              const pctRelayFee = requestedFee.toString()
              const senderNonce = (await relayHub.getNonce(senderAccount)).toString()
              const encodedFunction = recipient.contract.methods.emitMessage('a'.repeat(messageLength)).encodeABI()
              const { signature } = await getSignature({
                ...sharedSigValues,
                pctRelayFee,
                senderNonce,
                encodedFunction
              })
              const relayRequest = getRelayRequest(senderAccount, recipient.address, encodedFunction,
                requestedFee, gasPrice, gasLimit, senderNonce, relayAddress, gasSponsor.address)
              const res = await relayHub.relayCall(relayRequest, signature, '0x', {
                from: relayAddress,
                gasPrice: gasPrice
              })
              const afterBalances = await getBalances()
              assert.notEqual(beforeBalances.relayOwners.toString(), afterBalances.relayOwners.toString(), 'transaction must have failed')
              const weiActualCharge = afterBalances.relayOwners.sub(beforeBalances.relayOwners)
              const weiGasUsed = beforeBalances.relay.sub(afterBalances.relay)
              assert.equal((res.receipt.gasUsed * gasPrice).toString(), weiGasUsed.toString(), 'where else did the money go?')

              // the sponsor will always pay more for the transaction because the calldata is addumed to be nonzero
              const overchargeForCalldata = calculateOverchargeForCalldata(relayRequest, signature)
              if (requestedFee === 0) logOverhead(weiActualCharge, overchargeForCalldata, weiGasUsed)

              // Validate actual profit is with high precision $(requestedFee) percent higher then ether spent relaying
              const chargeBase = weiGasUsed.add(overchargeForCalldata)
              const expectedActualCharge = chargeBase.mul(new BN(requestedFee).add(new BN(100))).div(new BN(100))
              const diffBN = expectedActualCharge.sub(weiActualCharge)
              const diff = Math.floor(parseInt(diffBN.abs().toString()))
              assert.equal(diff, 0)
              // Check that relay did pay it's gas fee by himself.
              const expectedBalanceAfter = beforeBalances.relay.sub(res.receipt.gasUsed * gasPrice)
              assert.equal(expectedBalanceAfter.cmp(afterBalances.relay), 0, 'relay did not pay the expected gas fees')

              // Check that relay's weiActualCharge is deducted from recipient's stake.
              const expectedRecipientBalance = beforeBalances.relayRecipient.sub(weiActualCharge)
              assert.equal(expectedRecipientBalance.toString(), afterBalances.relayRecipient.toString())
            })
          })
      )
  })
})
