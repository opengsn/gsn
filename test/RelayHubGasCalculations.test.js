const Big = require('big.js')
const { BN, ether, expectEvent, time } = require('@openzeppelin/test-helpers')

const { calculateTransactionMaxPossibleGas, getEip712Signature } = require('../src/js/relayclient/utils')
const Environments = require('../src/js/relayclient/Environments')
const RelayRequest = require('../src/js/relayclient/EIP712/RelayRequest')

const RelayHub = artifacts.require('./RelayHub.sol')
const TestRecipient = artifacts.require('./test/TestRecipient')
const TestPaymasterVariableGasLimits = artifacts.require('./TestPaymasterVariableGasLimits.sol')
const TestPaymasterConfigurableMisbehavior = artifacts.require('./test/TestPaymasterConfigurableMisbehavior.sol')

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

contract('RelayHub gas calculations', async function ([_, relayOwner, relayAddress, __, senderAddress, other]) {
  const message = 'Gas Calculations'
  const unstakeDelay = time.duration.weeks(4)
  const chainId = Environments.default.chainId
  const gtxdatanonzero = Environments.default.gtxdatanonzero
  const gtxdatazero = Environments.default.gtxdatazero
  const baseFee = new BN('300')
  const fee = new BN('10')
  const gasPrice = new BN('10')
  const gasLimit = new BN('1000000')
  const senderNonce = new BN('0')
  const magicNumbers = {
    arc: 805,
    pre: 1839,
    post: 2080
  }

  let relayHub
  let recipient
  let paymaster
  let encodedFunction
  let signature
  let relayRequest

  async function prepareForHub () {
    recipient = await TestRecipient.new()
    paymaster = await TestPaymasterVariableGasLimits.new()
    await paymaster.setHub(relayHub.address)
    await relayHub.depositFor(paymaster.address, {
      value: ether('1'),
      from: other
    })
    await relayHub.stake(relayAddress, unstakeDelay, {
      value: ether('2'),
      from: relayOwner
    })
    await relayHub.registerRelay(0, fee, '', { from: relayAddress })
    encodedFunction = recipient.contract.methods.emitMessage(message).encodeABI()
    relayRequest = new RelayRequest({
      senderAddress,
      relayAddress,
      encodedFunction,
      senderNonce: senderNonce.toString(),
      target: recipient.address,
      baseRelayFee: baseFee.toString(),
      pctRelayFee: fee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      paymaster: paymaster.address
    });
    ({ signature } = await getEip712Signature({
      web3,
      chainId,
      relayHub: relayHub.address,
      relayRequest
    }))
  }

  before(async function () {
    relayHub = await RelayHub.deployed()
    await prepareForHub()
  })

  describe('#calculateCharge()', async function () {
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

  describe('#relayCall()', async function () {
    it('should set correct gas limits and pass correct \'maxPossibleGas\' to the \'acceptRelayedCall\'',
      async function () {
        const transactionGasLimit = gasLimit.mul(new BN(3))
        const { tx } = await relayHub.relayCall(relayRequest, signature, '0x', {
          from: relayAddress,
          gas: transactionGasLimit.toString(),
          gasPrice
        })
        const calldata = relayHub.contract.methods.relayCall(relayRequest, signature, '0x').encodeABI()
        const calldataSize = calldata.length / 2 - 1
        const gasLimits = await paymaster.getGasLimits()
        const hubOverhead = parseInt(await relayHub.getHubOverhead())
        const maxPossibleGas = calculateTransactionMaxPossibleGas({
          gasLimits,
          hubOverhead,
          relayCallGasLimit: gasLimit.toNumber(),
          calldataSize,
          gtxdatanonzero
        })

        // Magic numbers seem to be gas spent on calldata. I don't know of a way to calculate them conveniently.
        await expectEvent.inTransaction(tx, TestPaymasterVariableGasLimits, 'SampleRecipientPreCallWithValues', {
          gasleft: (gasLimits.preRelayedCallGasLimit - magicNumbers.pre).toString(),
          arcGasleft: (gasLimits.acceptRelayedCallGasLimit - magicNumbers.arc).toString(),
          maxPossibleGas: maxPossibleGas.toString()
        })
        await expectEvent.inTransaction(tx, TestPaymasterVariableGasLimits, 'SampleRecipientPostCallWithValues', {
          gasleft: (gasLimits.postRelayedCallGasLimit - magicNumbers.post).toString()
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
      await misbehavingPaymaster.deposit({ value: 1e17 })
      const AcceptRelayedCallReverted = 3
      await misbehavingPaymaster.setOverspendAcceptGas(true)

      const senderNonce = (await relayHub.getNonce(senderAddress)).toString()
      const relayRequestMisbehaving = relayRequest.clone()
      relayRequestMisbehaving.relayData.paymaster = misbehavingPaymaster.address
      relayRequestMisbehaving.relayData.senderNonce = senderNonce
      const { signature } = await getEip712Signature({
        web3,
        chainId,
        relayHub: relayHub.address,
        relayRequest: relayRequestMisbehaving
      })
      const maxPossibleGasIrrelevantValue = 8000000
      const acceptRelayedCallGasLimit = 50000
      const canRelayResponse = await relayHub.canRelay(relayRequestMisbehaving, maxPossibleGasIrrelevantValue, acceptRelayedCallGasLimit, signature, '0x')
      assert.equal(AcceptRelayedCallReverted, canRelayResponse.status)

      const res = await relayHub.relayCall(relayRequestMisbehaving, signature, '0x', {
        from: relayAddress,
        gasPrice: gasPrice
      })

      assert.equal('CanRelayFailed', res.logs[0].event)
      assert.equal(AcceptRelayedCallReverted, res.logs[0].args.reason)
    })
  })

  async function getBalances () {
    const relayRecipient = await relayHub.balanceOf(paymaster.address)
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
    const correctGasCost1 = correctGasCost(calldataBuffer, gtxdatanonzero, gtxdatazero, 3)
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
              const senderNonce = (await relayHub.getNonce(senderAddress)).toString()
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
                relayAddress,
                paymaster: paymaster.address
              })
              const { signature } = await getEip712Signature({
                web3,
                chainId,
                relayHub: relayHub.address,
                relayRequest
              })
              const res = await relayHub.relayCall(relayRequest, signature, '0x', {
                from: relayAddress,
                gasPrice: gasPrice
              })
              const afterBalances = await getBalances()
              assert.notEqual(beforeBalances.relayOwners.toString(), afterBalances.relayOwners.toString(), 'transaction must have failed')
              const weiActualCharge = afterBalances.relayOwners.sub(beforeBalances.relayOwners)
              const weiGasUsed = beforeBalances.relay.sub(afterBalances.relay)
              assert.equal((res.receipt.gasUsed * gasPrice).toString(), weiGasUsed.toString(), 'where else did the money go?')

              // the paymaster will always pay more for the transaction because the calldata is assumed to be nonzero
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
