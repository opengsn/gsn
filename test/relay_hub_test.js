const Big = require('big.js')
const ethUtils = require('ethereumjs-util')
const Transaction = require('ethereumjs-tx')
const rlp = require('rlp')

const testutils = require('./testutils')
const utils = require('../src/js/relayclient/utils')
const RelayRequest = require('../src/js/relayclient/EIP712/RelayRequest')

const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')

const registerNewRelay = testutils.registerNewRelay
const registerNewRelayWithPrivkey = testutils.registerNewRelayWithPrivkey
const assertErrorMessageCorrect = testutils.assertErrorMessageCorrect

const RelayHub = artifacts.require('./RelayHub.sol')
contract('RelayHub', function (accounts) {
  let rhub
  let sr
  let paymaster

  const gasLimitAnyValue = 8000029
  const relayAddress = accounts[1]

  before(async function () {
    rhub = await RelayHub.deployed()
    sr = await SampleRecipient.deployed()
    paymaster = await TestPaymasterEverythingAccepted.deployed()
    const deposit = 100000000000
    await paymaster.deposit({ value: deposit })
  })

  const oneEther = web3.utils.toWei('1', 'ether')

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
    await registerNewRelayWithPrivkey(
      {
        relayHub: rhub,
        stake: oneEther,
        delay: weekInSec,
        baseRelayFee: 0,
        pctRelayFee: 120,
        url: 'hello',
        ownerAccount: accounts[0],
        web3,
        privKey
      })
    const stake = await rhub.getRelay(address)
    assert.equal(oneEther, stake[0])

    const relayRequest1 = new RelayRequest({
      senderAddress: testutils.zeroAddr,
      target: testutils.zeroAddr,
      encodedFunction: '0x1',
      gasPrice: '1',
      gasLimit: '1',
      baseRelayFee: '1',
      pctRelayFee: '1',
      senderNonce: '0',
      relayAddress,
      paymaster: paymaster.address
    })
    const relayRequest2 = new RelayRequest({
      senderAddress: testutils.zeroAddr,
      target: testutils.zeroAddr,
      encodedFunction: '0x2',
      gasPrice: '2',
      gasLimit: '2',
      baseRelayFee: '2',
      pctRelayFee: '2',
      senderNonce: '0',
      relayAddress,
      paymaster: paymaster.address
    })
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
      await registerNewRelayWithPrivkey(
        {
          relayHub: rhub,
          stake: oneEther,
          delay: weekInSec,
          baseRelayFee: 0,
          pctRelayFee: 120,
          url: 'hello',
          ownerAccount: accounts[0],
          web3,
          privKey
        })
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
    await registerNewRelayWithPrivkey(
      {
        relayHub: rhub,
        stake: oneEther,
        delay: weekInSec,
        baseRelayFee: 0,
        pctRelayFee: 120,
        url: 'hello',
        ownerAccount: accounts[0],
        web3,
        privKey
      })
    try {
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
    await registerNewRelay({
      relayHub: rhub,
      stake: oneEther,
      delay: weekInSec,
      baseRelayFee: 0,
      pctRelayFee: 120,
      url: 'hello',
      relayAccount: accounts[6],
      ownerAccount: accounts[0]
    })
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
  })
})
