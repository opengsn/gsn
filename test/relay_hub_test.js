const Big = require('big.js')

const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestSponsorEverythingAccepted = artifacts.require('./test/TestSponsorEverythingAccepted.sol')
const TestSponsorConfigurableMisbehavior = artifacts.require('./test/TestSponsorConfigurableMisbehavior.sol')

const testutils = require('./testutils')
const utils = require('../src/js/relayclient/utils')

const registerNewRelay = testutils.register_new_relay
const registerNewRelayWithPrivkey = testutils.register_new_relay_with_privkey
const assertErrorMessageCorrect = testutils.assertErrorMessageCorrect
const getEip712Signature = utils.getEip712Signature
const rlp = require('rlp')

const ethUtils = require('ethereumjs-util')
const Transaction = require('ethereumjs-tx')
const BigNumber = require('bignumber.js')

const RelayHub = artifacts.require('./RelayHub.sol')
contract('RelayHub', function (accounts) {
  const message = 'hello world'
  let rhub
  let sr
  let gasSponsor

  let transaction
  const gasLimitAnyValue = 8000029
  const relayAccount = accounts[1]

  before(async function () {
    rhub = await RelayHub.deployed()
    sr = await SampleRecipient.deployed()
    gasSponsor = await TestSponsorEverythingAccepted.deployed()
    transaction = await getTransaction(sr)
    const deposit = 100000000000
    await gasSponsor.deposit({ value: deposit })
  })

  const realSender = accounts[0]
  const oneEther = web3.utils.toWei('1', 'ether')

  async function getTransaction (testContract) {
    return testContract.contract.methods.emitMessage(message).encodeABI()
  }

  const from = realSender
  const to = SampleRecipient.address
  const transactionFee = 10
  const gasPrice = 10
  const gasLimit = 1000000
  // Note: this is not a transaction nonce, this is a RelayHub nonce
  // Note!! Increment each time relay is performed and not reverted!
  let relayNonce = 0

  const dayInSec = 24 * 60 * 60
  const weekInSec = dayInSec * 7

  const nonceAnyValue = 4
  const gasPriceAnyValue = 4
  const txValueAnyValue = 0
  const gasPricePenalize = 5

  let snitchingAccount
  const privKey = Buffer.from('cf5de3123d7ee4e0c66761793f1cc258324ecdf677fe3422e4cd0d87b9132322', 'hex')
  let data1
  let data2
  let transaction1
  let transaction2

  let unsignedTransaction1Encoded
  let unsignedTransaction2Encoded

  let sig1
  let sig2

  function encodeRLP (transaction) {
    return '0x' + rlp.encode(transaction.raw.slice(0, 6)).toString('hex')
  }

  it('should penalize relay for signing two distinct transactions with the same nonce', async function () {
    const address = '0x' + ethUtils.privateToAddress(privKey).toString('hex')
    await registerNewRelayWithPrivkey(rhub, oneEther, weekInSec, 120, 'hello', accounts[0], web3, privKey)
    const stake = await rhub.getRelay(address)
    assert.equal(oneEther, stake[0])

    const relayRequest1 = utils.getRelayRequest(testutils.zeroAddr, testutils.zeroAddr, '0x1', 1, 1, 1, 1, relayAccount, gasSponsor.address)
    const relayRequest2 = utils.getRelayRequest(testutils.zeroAddr, testutils.zeroAddr, '0x2', 2, 2, 2, 2, relayAccount, gasSponsor.address)
    data1 = rhub.contract.methods.relayCall(relayRequest1, '0x1', '0x').encodeABI()
    data2 = rhub.contract.methods.relayCall(relayRequest2, '0x2', '0x').encodeABI()

    transaction1 = new Transaction({
      nonce: nonceAnyValue,
      gasPrice: gasPriceAnyValue,
      gasLimit: gasLimitAnyValue,
      to: rhub.address,
      value: txValueAnyValue,
      data: data1
    })
    transaction2 = new Transaction({
      nonce: nonceAnyValue,
      gasPrice: gasPriceAnyValue,
      gasLimit: gasLimitAnyValue,
      to: rhub.address,
      value: txValueAnyValue,
      data: data2
    })
    unsignedTransaction1Encoded = encodeRLP(transaction1)
    unsignedTransaction2Encoded = encodeRLP(transaction2)
    const hash1 = '0x' + transaction1.hash(false).toString('hex')
    sig1 = utils.getTransactionSignatureWithKey(privKey, hash1, false)
    assert.equal(sig1.length, 132)
    const hash2 = '0x' + transaction2.hash(false).toString('hex')
    sig2 = utils.getTransactionSignatureWithKey(privKey, hash2, false)
    assert.equal(sig2.length, 132)

    snitchingAccount = accounts[7]
    const snitchingAccountInitialBalance = await web3.eth.getBalance(snitchingAccount)

    const res = await rhub.penalizeRepeatedNonce(unsignedTransaction1Encoded, sig1, unsignedTransaction2Encoded, sig2, {
      from: snitchingAccount,
      gasPrice: gasPricePenalize,
      gasLimit: gasLimitAnyValue
    })

    assert.equal('Penalized', res.logs[1].event)
    assert.equal(address, res.logs[1].args.relay.toLowerCase())
    assert.equal(snitchingAccount, res.logs[1].args.sender)

    const expectedBalanceAfterPenalize = new Big(snitchingAccountInitialBalance).add(stake[0] / 2).sub(res.receipt.gasUsed * gasPricePenalize)

    assert(expectedBalanceAfterPenalize.eq(new Big(await web3.eth.getBalance(snitchingAccount))))
  })

  const asyncForEach = async function (array, callback) {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array)
    }
  }

  it('should penalize relay for calling any non-RelayHub address or a method not whitelisted inside hub', async function () {
    // A call to a method that is not whitelisted for the relay to use
    const data1 = rhub.contract.methods.removeRelayByOwner(testutils.zeroAddr).encodeABI()
    const data2 = sr.contract.methods.emitMessage('Hello SampleRecipient!').encodeABI()
    const illegalTransactions = [{
      data: data1,
      destination: rhub.address
    },
    {
      data: data2,
      destination: sr.address
    }]
    await asyncForEach(illegalTransactions, async function (tx) {
      console.log('will try: ' + tx.data.slice(0, 10) + ' ' + tx.destination)
      await registerNewRelayWithPrivkey(rhub, oneEther, weekInSec, 120, 'hello', accounts[0], web3, privKey)
      const address = '0x' + ethUtils.privateToAddress(privKey).toString('hex')
      const stake = await rhub.getRelay(address)
      assert.equal(oneEther, stake[0])

      const illegalTransaction = new Transaction({
        nonce: nonceAnyValue,
        gasPrice: gasPriceAnyValue,
        gasLimit: gasLimitAnyValue,
        to: tx.destination,
        value: txValueAnyValue,
        data: tx.data
      })

      const snitchingAccountInitialBalance = await web3.eth.getBalance(snitchingAccount)

      const unsignedillegalTransactionEncoded = encodeRLP(illegalTransaction)
      const hash = '0x' + illegalTransaction.hash(false).toString('hex')
      const sig = utils.getTransactionSignatureWithKey(privKey, hash, false)
      assert.equal(sig.length, 132)
      const res = await rhub.penalizeIllegalTransaction(unsignedillegalTransactionEncoded, sig, {
        from: snitchingAccount,
        gasPrice: gasPricePenalize,
        gasLimit: gasLimitAnyValue
      })

      assert.equal('Penalized', res.logs[1].event)

      const expectedBalanceAfterPenalize = new Big(snitchingAccountInitialBalance).add(stake[0] / 2).sub(res.receipt.gasUsed * gasPricePenalize)

      assert(expectedBalanceAfterPenalize.eq(new Big(await web3.eth.getBalance(snitchingAccount))))
    })
  })

  it('should revert an attempt to penalize relay with an allowed transaction ', async function () {
    try {
      await registerNewRelayWithPrivkey(rhub, oneEther, weekInSec, 120, 'hello', accounts[0], web3, privKey)
      await rhub.penalizeIllegalTransaction(unsignedTransaction1Encoded, sig1, {
        from: snitchingAccount,
        gasPrice: gasPricePenalize,
        gasLimit: gasLimitAnyValue
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Legal relay transaction')
    }
  })

  it('should revert an attempt to penalize relay with two identical transactions', async function () {
    try {
      await rhub.penalizeRepeatedNonce(unsignedTransaction1Encoded || '0x', sig1 || '0x', unsignedTransaction1Encoded || '0x', sig1 || '0x', {
        from: snitchingAccount,
        gasPrice: gasPricePenalize,
        gasLimit: gasLimitAnyValue
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'tx is equal')
    }
  })

  it('should revert an attempt to penalize relay with two transactions with different nonce', async function () {
    const transaction2NextNonce = new Transaction(transaction2)
    transaction2NextNonce.nonce = nonceAnyValue + 1

    const unsignedTransaction2EncodedNextNonce = encodeRLP(transaction2NextNonce)
    const hash = '0x' + transaction2NextNonce.hash(false).toString('hex')
    const sig2NextNonce = utils.getTransactionSignatureWithKey(privKey, hash, false)
    assert.equal(sig2NextNonce.length, 132)

    try {
      await rhub.penalizeRepeatedNonce(unsignedTransaction1Encoded, sig1, unsignedTransaction2EncodedNextNonce, sig2NextNonce, {
        from: snitchingAccount,
        gasPrice: gasPricePenalize,
        gasLimit: gasLimitAnyValue
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Different nonce')
    }
  })

  it('should revert an attempt to penalize relay with two transactions from different relays', async function () {
    await registerNewRelay(rhub, oneEther, weekInSec, 120, 'hello', accounts[6], accounts[0])
    const privKeySix = Buffer.from('e485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52', 'hex')
    const hash = '0x' + transaction2.hash(false).toString('hex')
    const sig2FromAccountSix = utils.getTransactionSignatureWithKey(privKeySix, hash, false)
    assert.equal(sig2FromAccountSix.length, 132)

    try {
      await rhub.penalizeRepeatedNonce(unsignedTransaction1Encoded, sig1, unsignedTransaction2Encoded, sig2FromAccountSix, {
        from: snitchingAccount,
        gasPrice: gasPricePenalize,
        gasLimit: gasLimitAnyValue
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Different signer')
    }
  });

  [0, 1, 3, 5, 10, 50, 100, 200].forEach(requestedFee => {
    // avoid duplicate coverage checks. they do the same, and take a lot of time:
    if (requestedFee > 0 && process.env.MODE === 'coverage') return
    it('should compensate relay with requested fee of ' + requestedFee + '%', async function () {
      /* Now this is stupid... :-( */
      if (requestedFee === 0) {
        // Relay was removed in some previous test, unless skipped
        try {
          await registerNewRelay(rhub, oneEther, weekInSec, 120, 'hello', relayAccount, accounts[0])
        } catch (e) {
          console.log(e)
        }
        // This is required to initialize rhub's balances[acc[0]] value
        // If it is not set, the transacion will cost 15,000 gas more than expected by 'gasOverhead'
        await rhub.depositFor(accounts[0], { value: 1 })
      }
      /**/
      const relayRecipientBalanceBefore = await rhub.balanceOf(gasSponsor.address)
      const relayBalanceBefore = new Big(await web3.eth.getBalance(relayAccount))
      const r = await rhub.getRelay(relayAccount)
      const owner = r[3]

      const relayOwnerHubBalanceBefore = await rhub.balanceOf(owner)

      const sig = (await getEip712Signature({
        web3,
        senderAccount: from,
        senderNonce: relayNonce.toString(),
        target: to,
        encodedFunction: transaction,
        pctRelayFee: requestedFee.toString(),
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        gasSponsor: gasSponsor.address,
        relayHub: rhub.address,
        relayAddress: relayAccount
      })).signature

      const relayRequest = utils.getRelayRequest(from, to, transaction, requestedFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
      assert.equal(0, (await rhub.canRelay(relayRequest, sig, '0x')).status)

      const res = await rhub.relayCall(relayRequest, sig, '0x', {
        from: relayAccount,
        gasPrice: gasPrice,
        gasLimit: gasLimitAnyValue
      })
      relayNonce++

      const relayOwnerHubBalanceAfter = await rhub.balanceOf(owner)
      const relayBalanceAfter = await web3.eth.getBalance(relayAccount)

      // What is the factor relay is expecting to get paid by. I.e. for 10% it is '1.1'; For 200% it is '3.0'
      const requestedCoeff = new BigNumber((requestedFee + 100) / 100).toPrecision(3, BigNumber.ROUND_HALF_UP)

      // Calculate the actual factor. Rounding is expected.
      const revenue = relayOwnerHubBalanceAfter.sub(relayOwnerHubBalanceBefore)
      const expenses = relayBalanceBefore.sub(relayBalanceAfter)

      if (requestedFee === 0) {
        const gasDiff = expenses.sub(revenue).div(gasPrice)
        if (gasDiff.toString() !== '0') {
          console.log('== zero-fee unmatched gas. RelayHub.gasOverhead should be increased by: ' + gasDiff.toString())
        }
      }

      let receivedCoeff = new BigNumber(revenue).div(expenses)
      // I don't know how does rounding work for BigNumber, but it seems to be broken to me

      if (receivedCoeff.lt(1)) {
        receivedCoeff = receivedCoeff.toPrecision(2, BigNumber.ROUND_HALF_UP)
      } else {
        receivedCoeff = receivedCoeff.toPrecision(3, BigNumber.ROUND_HALF_UP)
      }
      assert.equal(requestedCoeff, receivedCoeff)

      // Check that relay did pay it's gas fee on itslef.
      const expectedBalanceAfter = relayBalanceBefore.sub(res.receipt.gasUsed * gasPrice)
      assert.equal(expectedBalanceAfter.toString(), relayBalanceAfter.toString())

      // Check that relay's revenue is deducted from recipient's stake.
      const relayRecipientBalanceAfter = await rhub.balanceOf(gasSponsor.address)
      const expectedRecipientBalance = relayRecipientBalanceBefore - revenue
      assert.equal(expectedRecipientBalance.toString(), relayRecipientBalanceAfter.toString())
    })
  })

  it('should revert an attempt to use more than allowed gas for acceptRelayedCall(50000)', async function () {
    const misbehavingSponsor = await TestSponsorConfigurableMisbehavior.new()
    await misbehavingSponsor.setHub(rhub.address)
    await misbehavingSponsor.deposit({ value: 1e17 })

    const AcceptRelayedCallReverted = 3
    await misbehavingSponsor.setOverspendAcceptGas(true)
    const sig = (await getEip712Signature({
      web3,
      senderAccount: from,
      senderNonce: relayNonce.toString(),
      target: to,
      encodedFunction: transaction,
      pctRelayFee: transactionFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      gasSponsor: misbehavingSponsor.address,
      relayHub: rhub.address,
      relayAddress: relayAccount
    })).signature

    const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, misbehavingSponsor.address)
    assert.equal(AcceptRelayedCallReverted, (await rhub.canRelay(relayRequest, sig, '0x')).status)

    const res = await rhub.relayCall(relayRequest, sig, '0x', {
      from: relayAccount,
      gasPrice: gasPrice,
      gasLimit: gasLimitAnyValue
    })

    assert.equal('CanRelayFailed', res.logs[0].event)
    assert.equal(AcceptRelayedCallReverted, res.logs[0].args.reason)
  })
})
