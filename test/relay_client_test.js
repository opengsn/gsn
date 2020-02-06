/* global BigInt */
const RelayClient = require('../src/js/relayclient/RelayClient')
const RelayProvider = require('../src/js/relayclient/RelayProvider')
const utils = require('../src/js/relayclient/utils')
const RelayHub = artifacts.require('./RelayHub.sol')
const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestEverythingAcceptedSponsor = artifacts.require('./test/TestSponsorEverythingAccepted.sol')
const TestSponsorOwnerSignature = artifacts.require('./test/TestSponsorOwnerSignature.sol')
const getDataToSign = require('../src/js/relayclient/EIP712/Eip712Helper')

const Transaction = require('ethereumjs-tx')
const ethUtils = require('ethereumjs-util')

const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const expect = require('chai').expect
chai.use(sinonChai)

const sigUtil = require('eth-sig-util')

const relayAddress = '0x610bb1573d1046fcb8a70bbbd395754cd57c2b60'

const localhostOne = 'http://localhost:8090'

const testutils = require('./testutils')
const registerNewRelay = testutils.register_new_relay
const increaseTime = testutils.increaseTime
const assertErrorMessageCorrect = testutils.assertErrorMessageCorrect

const Big = require('big.js')

const util = require('util')
const request = util.promisify(require('request'))

contract('RelayClient', function (accounts) {
  let rhub
  let sr
  let gasSponsor
  let gasLess
  let relayproc
  let gasPrice
  let relayClientConfig
  const relayOwner = accounts[1]
  let relayAccount
  const dayInSec = 24 * 60 * 60
  const weekInSec = dayInSec * 7
  const oneEther = 1e18
  before(async function () {
    const gasPricePercent = 20
    gasPrice = (await web3.eth.getGasPrice()) * (100 + gasPricePercent) / 100

    rhub = await RelayHub.deployed()
    sr = await SampleRecipient.deployed()
    gasSponsor = await TestEverythingAcceptedSponsor.deployed()

    await gasSponsor.deposit({ value: web3.utils.toWei('1', 'ether') })
    gasLess = await web3.eth.personal.newAccount('password')
    console.log('gasLess = ' + gasLess)
    console.log('starting relay')

    relayproc = await testutils.startRelay(rhub, {
      stake: 1e18,
      delay: 3600 * 24 * 7,
      txfee: 12,
      url: 'asd',
      relayOwner: relayOwner,
      EthereumNodeUrl: web3.currentProvider.host,
      GasPricePercent: gasPricePercent
    })

    relayAccount = await web3.eth.personal.newAccount('asdgasfd2r43')
    await web3.eth.personal.unlockAccount(relayAccount, 'asdgasfd2r43')
    await web3.eth.sendTransaction({
      from: accounts[0],
      to: relayAccount,
      value: oneEther
    })
    await registerNewRelay(rhub, oneEther, weekInSec, 120, 'hello', relayAccount, relayOwner)
  })

  after(async function () {
    await testutils.stopRelay(relayproc)
  })

  it('should query hub deposit of a sponsor contract on every call', async () => {
    const relayclient = new RelayClient(web3)
    const b1 = await relayclient.balanceOf(gasSponsor.address)
    const added = 200000
    await gasSponsor.deposit({ value: added })
    const b2 = new Big(await relayclient.balanceOf(gasSponsor.address))
    assert.equal(b2.sub(b1), added)
  })

  var func = async function ({ from/*, to, tx, txfee, gasPrice, gasLimit, nonce, relay_hub_address, relay_address */ }) {
    const toSign = web3.utils.sha3('0x' + Buffer.from('I approve').toString('hex') + utils.removeHexPrefix(from))
    const sign = await utils.getTransactionSignature(web3, accounts[0], toSign)
    return sign.slice(2)
  }
  var arr = [null, func]
  arr.forEach(approveFunction => {
    it('should send transaction to a relay and receive a response (' + (((typeof approveFunction === 'function') ? 'with' : 'without') + ' approveFunction)'), async function () {
      const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
      const to = sr.address
      const options = {
        approveFunction: approveFunction,
        from: gasLess,
        to: to,
        txfee: 12,
        gas_limit: 1000000,
        gasSponsor: gasSponsor.address
      }
      const relayClientConfig = {
        relayUrl: localhostOne,
        relayAddress: relayAddress,
        allowed_relay_nonce_gap: 0,
        verbose: process.env.DEBUG
      }

      const relayClient = new RelayClient(web3, relayClientConfig)

      const validTransaction = await relayClient.relayTransaction(encoded, options)
      const txhash = '0x' + validTransaction.hash(true).toString('hex')
      let res
      do {
        res = await web3.eth.getTransactionReceipt(txhash)
        await testutils.sleep(500)
      } while (res === null)

      // validate we've got the "SampleRecipientEmitted" event
      const topic = web3.utils.sha3('SampleRecipientEmitted(string,address,address,address)')
      assert(res.logs.find(log => log.topics.includes(topic)))

      assert.equal('0x' + validTransaction.to.toString('hex'), rhub.address.toString().toLowerCase())
      assert.equal(parseInt(validTransaction.gasPrice.toString('hex'), 16), gasPrice)
    })
  });

  [false, true].forEach(validateCanRelay =>
    it('should consider a transaction with an incorrect approval as invalid ' + (validateCanRelay ? '' : '(without client calling canRelay)'), async function () {
      const approvalSponsor = await TestSponsorOwnerSignature.new()
      await approvalSponsor.setHub(rhub.address)
      await rhub.depositFor(approvalSponsor.address, { value: 1e18 })

      const expectedError = 13
      const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
      const to = sr.address
      const options = {
        approveFunction: () => { return 'aaaa6ad4b4fab03bb2feaea2d54c690206e40036e4baa930760e72479da0cc5575779f9db9ef801e144b5e6af48542107f2f094649334b030e2bb44f054429b451' },
        from: gasLess,
        to: to,
        txfee: 12,
        gas_limit: 1000000,
        gasSponsor: approvalSponsor.address
      }
      // only add parameter if false (true should be the default..)
      if (!validateCanRelay) { options.validateCanRelay = false }

      const relayClientConfig = {
        relayUrl: localhostOne,
        relayAddress: relayAddress,
        allowed_relay_nonce_gap: 0,
        verbose: process.env.DEBUG
      }

      const relayClient = new RelayClient(web3, relayClientConfig)
      try {
        await relayClient.relayTransaction(encoded, options)
        assert.fail()
      } catch (error) {
        if (validateCanRelay) {
          // error checked by relayTransaction:
          assert.equal('Error: canRelay failed: 13: test: not approved', error.toString())
        } else {
          // error checked by relay:
          assert.include(error.otherErrors[0], 'canRelay() view function returned error code=' + expectedError)
        }
      }
    }))

  it('should consider a transaction with a relay tx nonce higher than expected as invalid', async function () {
    const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
    const to = sr.address
    const options = {
      from: gasLess,
      to: to,
      txfee: 12,
      gas_limit: 1000000,
      gasSponsor: gasSponsor.address
    }
    const relayClientConfig = {
      relayUrl: localhostOne,
      relayAddress: relayAddress,
      allowed_relay_nonce_gap: -1,
      verbose: process.env.DEBUG
    }
    const relayClient = new RelayClient(web3, relayClientConfig)
    const origSend = relayClient.httpSend.send
    relayClient.httpSend.send = function (url, jsonRequestData, callback) {
      if (url.includes('/relay')) {
        // Otherwise, server will return an error if asked to sign with a low nonce.
        jsonRequestData.RelayMaxNonce = 1000000
      }
      origSend.bind(relayClient.httpSend)(url, jsonRequestData, callback)
    }
    try {
      await relayClient.relayTransaction(encoded, options)
      assert.fail()
    } catch (error) {
      if (error.toString().includes('Assertion')) {
        throw error
      }
      assert.include(error.otherErrors[0].message, 'Relay used a tx nonce higher than requested')
    }
  })

  it('should revert calls to preRelayedCall from non RelayHub address', async function () {
    try {
      await gasSponsor.preRelayedCall(Buffer.from(''), { from: accounts[1] })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Function can only be called by RelayHub')
    }
  })

  it('should revert calls to postRelayedCall from non RelayHub address', async function () {
    try {
      await gasSponsor.postRelayedCall(Buffer.from(''), true, 0, Buffer.from(''))
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Function can only be called by RelayHub')
    }
  })

  it('should relay transparently', async () => {
    relayClientConfig = {

      txfee: 12,
      // override requested gas price
      force_gasPrice: gasPrice,
      // override requested gas limit.
      force_gasLimit: 4000029,
      verbose: process.env.DEBUG
    }

    const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig)
    // web3.setProvider(relayProvider)

    // NOTE: in real application its enough to set the provider in web3.
    // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
    // so changing the global one is not enough...
    SampleRecipient.web3.setProvider(relayProvider)

    let res = await sr.emitMessage('hello world', { from: gasLess, gasSponsor: gasSponsor.address })
    assert.equal(res.logs[0].event, 'SampleRecipientEmitted')
    assert.equal(res.logs[0].args.message, 'hello world')
    assert.equal(res.logs[0].args.realSender, gasLess)
    assert.equal(res.logs[0].args.msgSender.toLowerCase(), rhub.address.toLowerCase())
    res = await sr.emitMessage('hello again', { from: accounts[3], gasSponsor: gasSponsor.address })
    assert.equal(res.logs[0].event, 'SampleRecipientEmitted')
    assert.equal(res.logs[0].args.message, 'hello again')

    assert.equal(res.logs[0].args.realSender, accounts[3])
  })

  it('should relay transparently with long encoded function', async () => {
    relayClientConfig = {

      txfee: 12,
      // override requested gas price
      force_gasPrice: gasPrice,
      // override requested gas limit.
      force_gasLimit: 4000029,
      verbose: process.env.DEBUG
    }

    const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig)
    // web3.setProvider(relayProvider)

    // NOTE: in real application its enough to set the provider in web3.
    // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
    // so changing the global one is not enough...
    SampleRecipient.web3.setProvider(relayProvider)

    let res = await sr.emitMessage('hello world'.repeat(1000), { from: gasLess, gasSponsor: gasSponsor.address })
    assert.equal(res.logs[0].event, 'SampleRecipientEmitted')
    assert.equal(res.logs[0].args.message, 'hello world'.repeat(1000))
    assert.equal(res.logs[0].args.realSender, gasLess)
    assert.equal(res.logs[0].args.msgSender.toLowerCase(), rhub.address.toLowerCase())
    res = await sr.emitMessage('hello again'.repeat(1000), { from: accounts[3], gasSponsor: gasSponsor.address })
    assert.equal(res.logs[0].event, 'SampleRecipientEmitted')
    assert.equal(res.logs[0].args.message, 'hello again'.repeat(1000))

    assert.equal(res.logs[0].args.realSender, accounts[3])
  })

  // This test currently has no asserts. 'auditTransaction' returns no value.
  it.skip('should send a signed raw transaction from selected relay to backup relays - in case penalty will be needed', async function () {
    const relayClient = new RelayClient(web3)
    const data1 = rhub.contract.methods.relay(1, 1, 1, 1, 1, 1, 1, 1).encodeABI()
    const transaction = new Transaction({
      nonce: 2,
      gasPrice: gasPrice,
      gasLimit: 200000,
      to: sr.address,
      value: 0,
      data: data1
    })
    const privKey = Buffer.from('4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d', 'hex')
    transaction.sign(privKey)
    const rawTx = '0x' + transaction.serialize().toString('hex')
    console.log('tx to audit', rawTx)
    await relayClient.auditTransaction(rawTx, [localhostOne, localhostOne])
  })

  it.skip('should report a suspicious transaction to an auditor relay, which will penalize the double-signing relay', async function () {
    /******/
    await registerNewRelay(rhub, 1000, 20, 30, 'https://abcd.com', accounts[5])
    /******/

    // let auditor_relay = accounts[10]
    // let initial_auditor_balance = web3.eth.getBalance(auditor_relay);

    const perpetratorRelay = accounts[5]
    // let perpetrator_stake = await rhub.stakes(perpetrator_relay);

    const perpetratorPrivKey = Buffer.from('395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd', 'hex')
    // getTransactionCount is, by definition, account's nonce+1
    const reusedNonce = web3.eth.getTransactionCount(perpetratorRelay)

    // Make sure the transaction with that nonce was mined
    const result = await sr.emitMessage('hello world', { from: perpetratorRelay })
    var log = result.logs[0]
    assert.equal('SampleRecipientEmitted', log.event)

    // Create another tx with the same nonce
    const data2 = rhub.contract.methods.relay(1, 1, 1, 1, 1, 1, 1, 1).encodeABI()
    const transaction2 = new Transaction({
      nonce: reusedNonce - 1,
      gasPrice: 2,
      gasLimit: 200000,
      to: sr.address,
      value: 0,
      data: data2
    })
    transaction2.sign(perpetratorPrivKey)
    const rawTx = '0x' + transaction2.serialize().toString('hex')

    const relayClient = new RelayClient(web3, { relayUrl: localhostOne })
    await relayClient.auditTransaction(rawTx, [localhostOne])
    // let the auditor do the job
    // testutils.sleep(10)

    const perpetratorNewStake = await rhub.stakes(perpetratorRelay)

    assert.equal(0, perpetratorNewStake[0].toNumber())
    // TODO: validate reward distributed fairly
  })

  function timeout (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // TODO: this test is crazy - it stubs the entire world to make it's assertion. refactor!
  it('should fallback to other relays if the preferred one does not respond correctly', async function () {
    const rc = new RelayClient(web3)
    const origHttpSend = rc.httpSend
    const httpSend = {
      send: function (url, jsonRequestData, callback) {
        if (!url.includes('relay')) {
          origHttpSend(url, jsonRequestData, callback)
          return
        }
        if (counter === 0) {
          counter++
          setTimeout(callback(new Error('Test error'), null), 100)
        } else if (counter === 1) {
          counter++
          setTimeout(callback(null, JSON.stringify({})), 100)
        } else {
          const callbackWrap = function (e, r) {
            assert.equal(null, e)
            assert.ok(r.input)
            assert.include(r.input, messageHex)
            callback(e, r)
          }
          origHttpSend.send(url, jsonRequestData, callbackWrap)
        }
      }
    }
    const mockServerHelper = {
      getRelaysAdded: async function () {
        await timeout(200)
        return filteredRelays
      },
      newActiveRelayPinger: function () {
        return {
          nextRelay: async function () {
            await timeout(200)
            return filteredRelays[counter]
          }
        }
      },
      setHub: function () {}
    }
    const relayClient = new RelayClient(web3, { serverHelper: mockServerHelper })
    relayClient.httpSend = httpSend
    const res = await request(localhostOne + '/getaddr')
    const relayServerAddress = JSON.parse(res.body).RelayServerAddress
    const filteredRelays = [
      {
        relayUrl: 'localhost1',
        RelayServerAddress: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
      },
      {
        relayUrl: 'localhost2',
        RelayServerAddress: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
      },
      {
        relayUrl: localhostOne,
        RelayServerAddress: relayServerAddress
      }
    ]

    let counter = 0

    const message = 'hello world'
    const messageHex = '0b68656c6c6f20776f726c64'
    const encoded = sr.contract.methods.emitMessage(message).encodeABI()

    const options = {
      from: gasLess,
      to: sr.address,
      txfee: 12,
      gas_limit: 1000000,
      gasSponsor: gasSponsor.address
    }

    const validTransaction = await relayClient.relayTransaction(encoded, options)

    // RelayClient did retry for 2 times
    assert.equal(2, counter)

    // The transaction was checked by internal logic of RelayClient (tested elsewhere) and deemed valid
    assert.equal(32, validTransaction.hash(true).length)
  })

  it('should create a new ephemeral keypair', async function () {
    const keypair = RelayClient.newEphemeralKeypair()
    const address = '0x' + ethUtils.privateToAddress(keypair.privateKey).toString('hex')
    assert.equal(address, keypair.address)
  })

  it('should use a given ephemeral key for signing', async function () {
    const rc = new RelayClient(web3)
    const ephemeralKeypair = RelayClient.newEphemeralKeypair()
    const fromAddr = ephemeralKeypair.address
    rc.useKeypairForSigning(ephemeralKeypair)
    sinon.spy(rc)
    const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
    const to = sr.address
    const options = {
      from: fromAddr,
      to: to,
      txfee: 12,
      gas_limit: 1000000,
      gasSponsor: gasSponsor.address
    }

    await rc.relayTransaction(encoded, options)
    // eslint-disable-next-line no-unused-expressions
    expect(rc.sendViaRelay.calledOnce).to.be.true
    expect(rc.sendViaRelay).to.have.been.calledWith(
      sinon.match(({ relayAddress, from, to, encodedFunction, relayFee, gasPrice, gasLimit, gasSponsor, senderNonce, signature, approvalData, relayUrl, relayHubAddress }) => {
        const data = getDataToSign({
          chainId: 7,
          senderAccount: from,
          senderNonce,
          target: to,
          encodedFunction,
          pctRelayFee: relayFee,
          gasPrice,
          gasLimit,
          gasSponsor,
          relayHub: relayHubAddress,
          relayAddress
        })
        const recoveredAccount = sigUtil.recoverTypedSignature_v4({
          data,
          sig: signature
        })
        return recoveredAccount.toLowerCase() === from.toLowerCase()
      }))
  })

  it('should use relay\'s published transactionFee if none is given in options', async function () {
    const rc = new RelayClient(web3)
    const ephemeralKeypair = RelayClient.newEphemeralKeypair()
    const fromAddr = ephemeralKeypair.address
    rc.useKeypairForSigning(ephemeralKeypair)
    rc.sendViaRelay = function ({ relayFee }) {
      // mock implementation: only check the received relay fee (checked below in relayTransaction
      throw new Error('relayFee=' + relayFee)
    }

    const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
    const options = {
      from: fromAddr,
      to: sr.address,
      // explicitly not specifying txfee
      gas_limit: 1000000,
      gasSponsor: gasSponsor.address
    }

    try {
      await rc.relayTransaction(encoded, options)
      assert.ok(false, 'didn\'t reach sendViaRelay')
    } catch (e) {
      assert.ok(e.otherErrors, e)
      assert.equal(e.otherErrors[0].message, 'relayFee=12')
    }
  })

  it('should add relay to failedRelay dict in case of http timeout', async function () {
    const relayUrl = 'http://1.2.3.4:5678'
    const rc = new RelayClient(web3, { httpTimeout: 100 })
    const ephemeralKeypair = RelayClient.newEphemeralKeypair()
    const fromAddr = ephemeralKeypair.address
    rc.useKeypairForSigning(ephemeralKeypair)

    rc.origSendViaRelay = rc.sendViaRelay
    rc.sendViaRelay = function (params) {
      params.relayUrl = relayUrl
      return this.origSendViaRelay.bind(this)(params)
    }

    const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
    const to = sr.address
    const options = {
      from: fromAddr,
      to: to,
      txfee: 12,
      gas_limit: 1000000,
      gasSponsor: gasSponsor.address
    }

    try {
      await rc.relayTransaction(encoded, options)
      assert.fail('relayTransaction should throw..')
    } catch (ignored) {
      assert.isTrue(ignored.otherErrors.length > 0,
        'There were no lookup errors, this is not the exception we are aiming for')
      assert.isTrue(rc.failedRelays[relayUrl] !== undefined)
    }
  })

  describe('relay balance management', async function () {
    let relayServerAddress
    let beforeOwnerBalance
    it('should NOT send relay balance to owner after removed', async function () {
      const response = await request(localhostOne + '/getaddr')
      relayServerAddress = JSON.parse(response.body).RelayServerAddress
      beforeOwnerBalance = await web3.eth.getBalance(relayOwner)
      const gasPrice = await web3.eth.getGasPrice()
      const res = await rhub.removeRelayByOwner(relayServerAddress, {
        from: relayOwner,
        gasPrice
      })
      const etherSpentByTx = BigInt(res.receipt.gasUsed) * BigInt(gasPrice)
      assert.equal('RelayRemoved', res.logs[0].event)
      assert.equal(relayServerAddress.toLowerCase(), res.logs[0].args.relay.toLowerCase())
      await testutils.sleep(2000)
      const afterOwnerBalance = BigInt(await web3.eth.getBalance(relayOwner))
      assert.equal(afterOwnerBalance + etherSpentByTx, BigInt(beforeOwnerBalance))
    })

    it('should send relay balance to owner only after unstaked', async function () {
      beforeOwnerBalance = await web3.eth.getBalance(relayOwner)
      const unstakeDelay = (await rhub.getRelay(relayServerAddress)).unstakeDelay
      increaseTime(unstakeDelay)
      const res = await rhub.unstake(relayServerAddress, { from: relayOwner })
      assert.equal('Unstaked', res.logs[0].event)
      assert.equal(relayServerAddress.toLowerCase(), res.logs[0].args.relay.toLowerCase())

      let i = 0
      let relayBalance = await web3.eth.getBalance(relayServerAddress)
      // eslint-disable-next-line eqeqeq
      while (relayBalance != 0 && i < 10) {
        await testutils.sleep(200)
        relayBalance = await web3.eth.getBalance(relayServerAddress)
        i++
      }
      assert.equal(0, relayBalance)
      const afterOwnerBalance = await web3.eth.getBalance(relayOwner)
      assert.equal(true, parseInt(afterOwnerBalance) > parseInt(beforeOwnerBalance))
    })
  })

  describe('should handle incorrect relay hub contract in recipient', async function () {
    let gasSponsor2
    before(async function () {
      const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig)
      SampleRecipient.web3.setProvider(relayProvider)
      SampleRecipient.web3.currentProvider.relayOptions.isRelayEnabled = false
      gasSponsor2 = await TestEverythingAcceptedSponsor.new()
      // eslint-disable-next-line
      SampleRecipient.web3.currentProvider.relayOptions.isRelayEnabled = true
    })

    it('should revert on zero hub in recipient contract', async function () {
      try {
        await sr.emitMessage('hello world', { from: gasLess, gasSponsor: gasSponsor2.address })
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'The relay hub address is set to zero in sponsor at')
      }
    })

    it('should throw on invalid recipient', async function () {
      const relayClient = new RelayClient(web3)
      try {
        await relayClient.createRelayHubFromSponsor(gasLess)
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'Could not get relay hub address from sponsor at')
      }
    })

    it('should throw on invalid hub ', async function () {
      const relayClient = new RelayClient(web3)
      relayClient.createRelayHub = function () {
        return {
          methods: {
            version: function () {
              return { call: function () { throw new Error('NOPE') } }
            }
          }
        }
      }
      try {
        await relayClient.createRelayHubFromSponsor(gasSponsor.address)
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'Could not query relay hub version at')
        assert.include(error.message, 'NOPE')
      }
    })

    it('should throw on wrong hub version', async function () {
      const relayClient = new RelayClient(web3)
      relayClient.createRelayHub = function () {
        return {
          methods: {
            version: function () {
              return { call: function () { return 'wrong version' } }
            }
          }
        }
      }
      try {
        await relayClient.createRelayHubFromSponsor(gasSponsor.address)
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'Unsupported relay hub version')
        assert.include(error.message, 'wrong version')
      }
    })
  })

  // TODO: remove this test, it is nonsense!
  it('should report canRelayFailed on transactionReceipt', async function () {
    const approvalSponsor = await TestSponsorOwnerSignature.new()
    await approvalSponsor.setHub(rhub.address)
    await rhub.depositFor(approvalSponsor.address, { value: 1e18 })

    const from = accounts[6]
    const to = sr.address
    const relayNonce = 0
    const message = 'hello world'
    const transaction = sr.contract.methods.emitMessage(message).encodeABI()
    const transactionFee = 10
    const gasPrice = 10
    const gasLimit = 1000000
    const gasLimitAnyValue = 7000029
    const relayClient = new RelayClient(web3)

    const { signature, data } = await utils.getEip712Signature({
      web3,
      senderAccount: from,
      target: to,
      encodedFunction: transaction,
      pctRelayFee: transactionFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      gasSponsor: approvalSponsor.address,
      senderNonce: relayNonce.toString(),
      relayHub: rhub.address,
      relayAddress: relayAccount
    })
    const res = await rhub.contract.methods.relayCall(data.message, signature, '0x').send({
      from: relayAccount,
      gasPrice: gasPrice,
      gasLimit: gasLimitAnyValue
    })

    const receipt = await web3.eth.getTransactionReceipt(res.transactionHash)
    const canRelay = await rhub.canRelay(data.message, signature, '0x')
    assert.equal(13, canRelay.status.valueOf().toString())

    assert.equal(true, receipt.status)
    await relayClient.fixTransactionReceiptResp(receipt)
    assert.equal(false, receipt.status)
  })

  it('should fail to relay if provided Gas Sponsor and Relay Recipient do not use same Relay Hub', async function () {
    // TODO: all tests rely on 'SampleRecipient.web3.setProvider(relayProvider)' being called in other test!!!
    const recipient = await SampleRecipient.deployed()
    await recipient.setHub(accounts[4], { from: accounts[0], useGSN: false })
    try {
      await recipient.emitMessage("ain't gonna work mate", { from: accounts[0], gasSponsor: gasSponsor.address })
      assert.fail()
    } catch (error) {
      assert.include(error.message, 'Sponsor and recipient RelayHub addresses do not match')
    }
  })
})
