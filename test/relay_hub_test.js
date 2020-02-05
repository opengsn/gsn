const Big = require('big.js')

const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestSponsorEverythingAccepted = artifacts.require('./test/TestSponsorEverythingAccepted.sol')
const TestSponsorConfigurableMisbehavior = artifacts.require('./test/TestSponsorConfigurableMisbehavior.sol')
const TestRecipientUtils = artifacts.require('./TestRecipientUtils.sol')

const testutils = require('./testutils')
const utils = require('../src/js/relayclient/utils')

const registerNewRelay = testutils.register_new_relay
const registerNewRelayWithPrivkey = testutils.register_new_relay_with_privkey
const increaseTime = testutils.increaseTime
const assertErrorMessageCorrect = testutils.assertErrorMessageCorrect
const getEip712Signature = utils.getEip712Signature
const rlp = require('rlp')

const sigUtil = require('eth-sig-util')
const ethUtils = require('ethereumjs-util')
const Transaction = require('ethereumjs-tx')
const BigNumber = require('bignumber.js')

const message = 'hello world'

const zeroAddr = '0'.repeat(40)

contract('SampleRecipient', function (accounts) {
  // TODO: account with no ether
  const expectedRealSender = accounts[0]

  it('should emit message with msgSender and realSender', async function () {
    const sample = await SampleRecipient.deployed()
    const result = await sample.emitMessage(message)
    const log = result.logs[0]
    const args = log.args
    assert.equal('SampleRecipientEmitted', log.event)
    assert.equal(args.message, message)
    assert.equal(accounts[0], args.msgSender)
    assert.equal(expectedRealSender, args.realSender)
  })

  it('should allow owner to withdraw balance from RelayHub', async function () {
    const sample = await TestSponsorEverythingAccepted.deployed()
    const deposit = new Big('100000000000000000')
    const rhub = await RelayHub.deployed()
    await rhub.depositFor(sample.address, { from: accounts[0], value: deposit })
    let depositActual = await rhub.balanceOf(sample.address)
    assert.equal(deposit.toString(), depositActual.toString())
    const a0BalanceBefore = await web3.eth.getBalance(accounts[0])
    try {
      await sample.withdrawRelayHubDepositTo(depositActual, accounts[2], { from: accounts[2] })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'revert')
    }
    const gasPrice = 1
    const owner = await sample.owner.call()
    const res = await sample.withdrawRelayHubDepositTo(depositActual, owner, {
      from: owner,
      gasPrice: gasPrice
    })
    const a0BalanceAfter = await web3.eth.getBalance(accounts[0])
    const expectedBalanceAfter = new Big(a0BalanceBefore).add(deposit).sub(res.receipt.gasUsed * gasPrice)
    assert.equal(expectedBalanceAfter.toString(), a0BalanceAfter.toString())
    depositActual = await rhub.balanceOf(sample.address)
    assert.equal('0', depositActual.toString())
  })
})

const RelayHub = artifacts.require('./RelayHub.sol')
contract('RelayHub', function (accounts) {
  let rhub
  let sr
  let gasSponsor

  let transaction
  let sig
  const gasLimitAnyValue = 8000029
  const relayAccount = accounts[1]

  before(async function () {
    rhub = await RelayHub.deployed()
    sr = await SampleRecipient.deployed()
    gasSponsor = await TestSponsorEverythingAccepted.deployed()
    transaction = await getTransaction(sr)
    sig = (await getEip712Signature({
      web3,
      senderAccount: from,
      senderNonce: relayNonce.toString(),
      target: to,
      encodedFunction: transaction,
      pctRelayFee: transactionFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      gasSponsor: gasSponsor.address,
      relayHub: rhub.address,
      relayAddress: relayAccount
    })).signature
    const deposit = 100000000000
    await gasSponsor.deposit({ value: deposit })
  })

  const realSender = accounts[0]
  const oneEther = web3.utils.toWei('1', 'ether')

  it('should retrieve version number', async function () {
    const version = await rhub.version()
    assert.equal(version, '1.0.0')
  })

  it('test_stake', async function () {
    const ownerAccount = accounts[1]
    const relayAccount = await web3.eth.personal.newAccount('password')
    const zeroStake = await rhub.getRelay(ownerAccount)
    const z = zeroStake.valueOf()[0]
    // assert.equal(0, z);

    const expectedStake = web3.utils.toWei('1', 'ether')
    await rhub.stake(relayAccount, 3600 * 24 * 7, { value: expectedStake, from: ownerAccount })
    const relayData = await rhub.getRelay(relayAccount)
    assert.equal(expectedStake, new Big(relayData.totalStake).sub(z))
    assert.equal(3600 * 24 * 7, relayData.unstakeDelay)
    assert.equal(ownerAccount, relayData.owner)
  })
  it.skip("should allow anyone to deposit for a recipient contract, but not more than 'maximumDeposit'", async function () {
    const sample = await SampleRecipient.deployed()
    const depositBefore = await rhub.balanceOf(sample.address)
    const deposit = new Big('1000000000000000')
    try {
      await rhub.depositFor(sample.address, { from: accounts[0], value: new Big(oneEther).times(3) })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'deposit too big')
    }
    await rhub.depositFor(sample.address, { from: accounts[0], value: deposit })
    const depositActual = await rhub.balanceOf(sample.address)
    const depositExpected = deposit.add(depositBefore)
    assert.equal(depositExpected.toString(), depositActual.toString())
  })

  // duplicate for 'unstaked relays can be staked for by anyone'
  it.skip('should allow owner to stake on behalf of the relay', async function () {
    const gaslessRelayAddress = '0x2Dd8C0665327A26D7655055B22c9b3bA596DfeD9'
    const balanceOfGaslessBefore = await web3.eth.getBalance(gaslessRelayAddress)
    const balanceOfAcc7Before = await web3.eth.getBalance(accounts[7])
    const expectedStake = web3.utils.toWei('1', 'ether')
    const gasPrice = 1
    const res = await rhub.stake(gaslessRelayAddress, 3600 * 24 * 7, {
      value: expectedStake,
      gasPrice: gasPrice,
      from: accounts[7]
    })
    const stake = await rhub.getRelay(gaslessRelayAddress)
    const balanceOfGaslessAfter = await web3.eth.getBalance(gaslessRelayAddress)
    const balanceOfAcc7After = await web3.eth.getBalance(accounts[7])
    const expectedBalanceAfter = new Big(balanceOfAcc7Before).sub(expectedStake).sub(res.receipt.gasUsed * gasPrice)
    assert.equal(balanceOfAcc7After.toString(), expectedBalanceAfter.toString())
    assert.equal(balanceOfGaslessAfter.toString(), balanceOfGaslessBefore.toString())
    assert.equal(expectedStake, stake[0])
  })

  it('should forbid contracts-owned addresses to register as relays', async function () {
    const testutils = await TestRecipientUtils.new()
    try {
      await web3.eth.sendTransaction({ from: accounts[0], to: testutils.address, value: 0.6e18 })
      await rhub.stake(testutils.address, 3600 * 24 * 7, { value: 1e18 })
      await testutils.registerAsRelay(rhub.address)
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Contracts cannot register as relays')
    }
  })

  it("should forbid owners' addresses to register as relays", async function () {
    try {
      await registerNewRelay(rhub, oneEther, weekInSec, 120, 'hello', accounts[0], accounts[0])
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'relay cannot stake for itself')
    }
  })

  it('should allow externally owned addresses to register as relays', async function () {
    const res = await registerNewRelay(rhub, oneEther, weekInSec, 120, 'hello', accounts[1], accounts[0])
    const log = res.logs[0]
    assert.equal('RelayAdded', log.event)
    // assert.equal(two_ether, log.args.stake) changes, depending on position in test list
  })

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

  /**
     * Depends on 'test_register_relay'
     */
  it("should get '0' (Success Code) from 'canRelay' for a valid transaction", async function () {
    const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
    const canRelay = await rhub.canRelay(relayRequest, sig, '0x')
    assert.equal(0, canRelay.status.valueOf())
  })

  it("should get '1' (Wrong Signature) from 'canRelay' for a transaction with a wrong signature", async function () {
    const wrongSig = '0xaaaa6ad4b4fab03bb2feaea2d54c690206e40036e4baa930760e72479da0cc5575779f9db9ef801e144b5e6af48542107f2f094649334b030e2bb44f054429b451'
    const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
    const canRelay = await rhub.canRelay(relayRequest, wrongSig, '0x')
    assert.equal(1, canRelay.status.valueOf())
  })

  it("should get '2' (Wrong Nonce) from 'canRelay' for a transaction with a wrong nonce", async function () {
    const wrongNonce = 777
    const { signature: sig, data } = await getEip712Signature({
      web3,
      senderAccount: from,
      senderNonce: wrongNonce.toString(),
      target: to,
      encodedFunction: transaction,
      pctRelayFee: transactionFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      gasSponsor: gasSponsor.address,
      relayHub: rhub.address,
      relayAddress: relayAccount
    })
    const recoveredAccount = sigUtil.recoverTypedSignature_v4({ data, sig })
    assert.strictEqual(from.toLowerCase(), recoveredAccount.toLowerCase())
    const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, wrongNonce, relayAccount, gasSponsor.address)
    const canRelay = await rhub.canRelay(relayRequest, sig, '0x')
    assert.equal(2, canRelay.status.valueOf())
  })

  // TODO: gasPrice change flow. As discussed, in case the Relay decides to ACCELERATE mining of tx he ALREADY signed,
  // Relay is allowed to retry the SAME tx with a higher gasPrice without being Penalized.
  // Need to create test for such flow.
  it("should perform the relayed 'send message' method call transaction ", async function () {
    const startBlock = await web3.eth.getBlockNumber()

    assert.equal(relayNonce, await rhub.getNonce(from))

    const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
    const result = await rhub.relayCall(relayRequest, sig, '0x', {
      from: relayAccount,
      gasPrice: gasPrice,
      gasLimit: gasLimitAnyValue
    })
    relayNonce++

    assert.equal(relayNonce, await rhub.getNonce(from))

    const logRelayed = result.logs[0]
    const argsRelayed = logRelayed.args
    assert.equal('TransactionRelayed', logRelayed.event)
    assert.equal(argsRelayed.selector, sr.contract.methods.emitMessage(message).encodeABI().slice(0, 10))
    assert.equal(0, argsRelayed.status.toNumber())
    const logsMessages = await sr.contract.getPastEvents('SampleRecipientEmitted', {
      fromBlock: startBlock,
      toBlock: 'latest'
    })
    assert.equal(1, logsMessages.length)
    const logMessage = logsMessages[0]
    const argsMessage = logMessage.returnValues
    assert.equal('SampleRecipientEmitted', logMessage.event)
    assert.equal(message, argsMessage.message)

    const postevent = await gasSponsor.contract.getPastEvents('SampleRecipientPostCall', {
      fromBlock: startBlock,
      toBlock: 'latest'
    })
    assert.equal('SampleRecipientPostCall', postevent[0].event)
    assert.equal(123456, postevent[0].returnValues.preRetVal)
    assert.notEqual(0, postevent[0].returnValues.usedGas)
  })

  it('should perform the relayed method call with no parameters ', async function () {
    await testutils.evmMine()
    const startBlock = await web3.eth.getBlockNumber()
    const transacionNoParams = sr.contract.methods.emitMessageNoParams().encodeABI()
    const sig = (await getEip712Signature({
      web3,
      senderAccount: from,
      senderNonce: relayNonce.toString(),
      target: to,
      encodedFunction: transacionNoParams,
      pctRelayFee: transactionFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      gasSponsor: gasSponsor.address,
      relayHub: rhub.address,
      relayAddress: relayAccount
    })).signature
    let logsMessages = await sr.contract.getPastEvents('SampleRecipientEmitted', {
      fromBlock: startBlock,
      toBlock: 'latest'
    })
    assert.equal(0, logsMessages.length)

    const relayRequest = utils.getRelayRequest(from, to, transacionNoParams, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
    const result = await rhub.relayCall(relayRequest, sig, '0x', {
      from: relayAccount,
      gasPrice: gasPrice,
      gasLimit: gasLimitAnyValue
    })
    relayNonce++
    var logRelayed = result.logs[0]
    var argsRelayed = logRelayed.args
    assert.equal('TransactionRelayed', logRelayed.event)
    assert.equal(0, argsRelayed.status.toNumber())
    logsMessages = await sr.contract.getPastEvents('SampleRecipientEmitted', {
      fromBlock: startBlock,
      toBlock: 'latest'
    })
    assert.equal(1, logsMessages.length)
    const logMessage = logsMessages[0]
    const argsMessage = logMessage.returnValues
    assert.equal('SampleRecipientEmitted', logMessage.event)
    assert.equal('Method with no parameters', argsMessage.message)
  })

  it('should not accept relay requests from unknown addresses', async function () {
    sig = (await getEip712Signature({
      web3,
      senderAccount: from,
      senderNonce: relayNonce.toString(),
      target: to,
      encodedFunction: transaction,
      pctRelayFee: transactionFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      gasSponsor: gasSponsor.address,
      relayHub: rhub.address,
      relayAddress: relayAccount
    })).signature
    try {
      const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
      await rhub.relayCall(relayRequest, sig, '0x', {
        from: accounts[6],
        gasPrice: gasPrice,
        gasLimit: gasLimitAnyValue
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Unknown relay')
    }
  })

  it('should not accept relay requests with gas price lower then user specified', async function () {
    try {
      const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
      await rhub.relayCall(relayRequest, sig, '0x', {
        from: relayAccount,
        gasPrice: gasPrice - 1,
        gasLimit: gasLimitAnyValue
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Invalid gas price')
    }
  })

  // duplicate of 'relaying is aborted if the recipient returns an invalid status code'
  it.skip("should not accept relay requests if destination recipient doesn't approve it", async function () {
    const from = accounts[6]
    const relayNonce = 0
    await sr.setBlacklisted(from)
    const sig = (await getEip712Signature({
      web3,
      senderAccount: from,
      senderNonce: relayNonce.toString(),
      target: to,
      encodedFunction: transaction,
      pctRelayFee: transactionFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      gasSponsor: gasSponsor.address,
      relayHub: rhub.address,
      relayAddress: relayAccount
    })).signature
    const res = await rhub.relayCall(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, sig, '0x', {
      from: relayAccount,
      gasPrice: gasPrice,
      gasLimit: gasLimitAnyValue
    })

    assert.equal(res.logs[0].event, 'CanRelayFailed')
    const canRelay = await rhub.canRelay(relayAccount, from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, sig, '0x')
    assert.equal(11, canRelay.status.valueOf().toString())
  })

  it('should not accept relay requests if gas limit is too low for a relayed transaction', async function () {
    // Adding gasReserve is not enough by a few wei as some gas is spent before gasleft().
    const gasReserve = 99999
    try {
      const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor.address)
      await rhub.relayCall(relayRequest, sig, '0x', {
        from: relayAccount,
        gasPrice: gasPrice,
        gas: gasLimit + gasReserve
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Not enough gasleft')
    }
  })

  it("should not accept relay requests if destination recipient doesn't have a balance to pay for it", async function () {
    const gasSponsor2 = await TestSponsorEverythingAccepted.new()
    await gasSponsor2.setHub(rhub.address)
    const maxPossibleCharge = (await rhub.maxPossibleCharge(gasLimit, gasPrice, transactionFee)).toNumber()
    await gasSponsor2.deposit({ value: maxPossibleCharge - 1 })
    try {
      const relayRequest = utils.getRelayRequest(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, gasSponsor2.address)
      await rhub.relayCall(relayRequest, sig, '0x', {
        from: relayAccount,
        gasPrice: gasPrice,
        gasLimit: gasLimitAnyValue
      })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Sponsor balance too low')
    }
  })

  // duplicate of 'non-owners cannot remove a relay'
  it.skip('should not allow non-owners to remove relay', async function () {
    try {
      await rhub.removeRelayByOwner(relayAccount, { from: accounts[2] })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'not owner')
    }
  })

  // duplicate of 'unremoved relays cannot be unstaked'
  it.skip('should not allow owners to unstake if still registered', async function () {
    const canUnstake = await rhub.canUnstake.call(relayAccount)
    assert.equal(canUnstake, false)
    try {
      await rhub.unstake(relayAccount)
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'canUnstake failed')
    }
  })

  // duplicate of 'a registered relay can be removed'
  it.skip('should allow the owner to remove his relay', async function () {
    try {
      await rhub.removeRelayByOwner(zeroAddr)
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'not owner')
    }

    const res = await rhub.removeRelayByOwner(relayAccount)
    assert.equal('RelayRemoved', res.logs[0].event)
    assert.equal(relayAccount, res.logs[0].args.relay)
  })

  // duplicate of 'relay cannot be unstaked before unstakeTime'
  it.skip("should not allow the owner to unstake unregistered relay's stake before time", async function () {
    const relay = await rhub.getRelay.call(relayAccount)
    // eslint-disable-next-line eqeqeq
    assert.equal(false, relay.stake == 0)
    let canUnstake = await rhub.canUnstake.call(relayAccount)

    assert.equal(false, canUnstake)
    await increaseTime(relay.unstakeDelay / 2)

    canUnstake = await rhub.canUnstake.call(relayAccount)
    assert.equal(false, canUnstake)
    try {
      await rhub.unstake(relayAccount)
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'canUnstake failed')
    }
    await increaseTime(relay.unstakeDelay / 2)
    canUnstake = await rhub.canUnstake.call(relayAccount)
    assert.equal(canUnstake, true)
  })

  // duplicate of 'non-owner cannot unstake relay'
  it.skip('should not allow non-owners to unstake', async function () {
    const canUnstake = await rhub.canUnstake.call(relayAccount)
    assert.equal(true, canUnstake)

    try {
      await rhub.unstake(relayAccount, { from: accounts[2] })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'not owner')
    }
  })

  // duplicate of 'owner can unstake relay'
  it.skip("should allow the owner to unstake unregistered relay's stake", async function () {
    const canUnstake = await rhub.canUnstake.call(relayAccount)
    assert.equal(true, canUnstake)
    await rhub.unstake(relayAccount)

    const stakeAfter = await rhub.getRelay(relayAccount)
    assert.equal(0, stakeAfter.totalStake)
  })

  it('should not allow a state to downgrade (possibly a few tests needed)')

  it('should allow to penalize a removed relay')
  it('should not allow to penalize an already penalized relay')

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

  // duplicate of 'reverts relayed call if recipient withdraws balance during XXX'
  it.skip('should revert relayed call on an attempt to withdraw deposit during relayed transaction', async function () {
    let withdrawDuringRelayedCall = await sr.withdrawDuringRelayedCall()
    assert.equal(withdrawDuringRelayedCall, false)
    try {
      await sr.setWithdrawDuringRelayedCall(true)
      withdrawDuringRelayedCall = await sr.withdrawDuringRelayedCall()
      assert.equal(withdrawDuringRelayedCall, true)

      const sig = (await getEip712Signature({
        web3,
        senderAccount: from,
        senderNonce: relayNonce.toString(),
        target: to,
        encodedFunction: transaction,
        pctRelayFee: transactionFee.toString(),
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        gasSponsor: gasSponsor.address,
        relayHub: rhub.address,
        relayAddress: relayAccount
      })).signature

      assert.equal(0, (await rhub.canRelay(relayAccount, from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, sig, '0x')).status)

      const res = await rhub.relayCall(from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, sig, '0x', {
        from: relayAccount,
        gasPrice: gasPrice,
        gasLimit: gasLimitAnyValue
      })
      relayNonce++
      const RecipientBalanceChanged = 4
      assert.equal('TransactionRelayed', res.logs[0].event)
      assert.equal(RecipientBalanceChanged, res.logs[0].args.status)
    } finally {
      // returning state to previous one
      await sr.setWithdrawDuringRelayedCall(false)
      withdrawDuringRelayedCall = await sr.withdrawDuringRelayedCall()
      assert.equal(withdrawDuringRelayedCall, false)
    }
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

  it('should not execute the \'relayedCall\' if \'preRelayedCall\' reverts', async function () {
    const misbehavingSponsor = await TestSponsorConfigurableMisbehavior.new()
    await misbehavingSponsor.setHub(rhub.address)
    await misbehavingSponsor.deposit({ value: 1e17 })

    const PreRelayedCallReverted = 2
    await misbehavingSponsor.setRevertPreRelayCall(true)
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

    const relayRequest = utils.getRelayRequest(
      from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, misbehavingSponsor.address)
    const res = await rhub.relayCall(relayRequest, sig, '0x', {
      from: relayAccount,
      gasPrice: gasPrice,
      gasLimit: gasLimitAnyValue
    })

    const startBlock = await web3.eth.getBlockNumber()
    // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
    const logsMessages = await sr.contract.getPastEvents('SampleRecipientEmitted', {
      fromBlock: startBlock,
      toBlock: 'latest'
    })
    assert.equal(0, logsMessages.length)

    relayNonce++

    assert.equal('TransactionRelayed', res.logs[0].event)
    assert.equal(PreRelayedCallReverted, res.logs[0].args.status)
    assert.equal(1, res.logs.length)
  })

  it('should revert the \'relayedCall\' if \'postRelayedCall\' reverts', async function () {
    const misbehavingSponsor = await TestSponsorConfigurableMisbehavior.new()
    await misbehavingSponsor.setHub(rhub.address)
    await misbehavingSponsor.deposit({ value: 1e17 })

    const PostRelayedCallReverted = 3
    await misbehavingSponsor.setRevertPostRelayCall(true)
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

    const relayRequest = utils.getRelayRequest(
      from, to, transaction, transactionFee, gasPrice, gasLimit, relayNonce, relayAccount, misbehavingSponsor.address)
    const res = await rhub.relayCall(relayRequest, sig, '0x', {
      from: relayAccount,
      gasPrice: gasPrice,
      gasLimit: gasLimitAnyValue
    })

    const startBlock = await web3.eth.getBlockNumber()
    // There should not be an event emitted, which means the result of 'relayCall' was indeed reverted
    const logsMessages = await sr.contract.getPastEvents('SampleRecipientEmitted', {
      fromBlock: startBlock,
      toBlock: 'latest'
    })
    assert.equal(0, logsMessages.length)

    relayNonce++

    assert.equal('TransactionRelayed', res.logs[0].event)
    assert.equal(PostRelayedCallReverted, res.logs[0].args.status)
    assert.equal(1, res.logs.length)
  })
})
