/* global BigInt */
const Transaction = require('ethereumjs-tx')
const ethUtils = require('ethereumjs-util')
const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const sigUtil = require('eth-sig-util')
const Web3 = require('web3')

const RelayClient = require('../src/js/relayclient/RelayClient')
const RelayProvider = require('../src/js/relayclient/RelayProvider')
const utils = require('../src/js/common/utils')
const getDataToSign = require('../src/js/common/EIP712/Eip712Helper')
const RelayRequest = require('../src/js/common/EIP712/RelayRequest')
const RelayHub = artifacts.require('./RelayHub.sol')
const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')
const TestPaymasterOwnerSignature = artifacts.require('./test/TestPaymasterOwnerSignature.sol')

const expect = chai.expect
chai.use(sinonChai)

const relayAddress = '0x610bb1573d1046fcb8a70bbbd395754cd57c2b60'

const localhostOne = 'http://localhost:8090'

const {
  registerNewRelay,
  increaseTime,
  assertErrorMessageCorrect,
  startRelay,
  stopRelay,
  sleep
} = require('./testutils')
const Big = require('big.js')

const util = require('util')
const request = util.promisify(require('request'))
const _web3 = web3

contract('RelayClient', function (accounts) {
  let web3
  let rhub
  let sr
  let paymaster
  let gasLess
  let relayproc
  let gasPrice
  let relayClientConfig
  let forwarderAddress
  const relayOwner = accounts[1]
  let relayAccount
  const dayInSec = 24 * 60 * 60
  const weekInSec = dayInSec * 7
  const oneEther = 1e18
  before(async function () {
    web3 = new Web3(_web3.currentProvider)
    const gasPricePercent = 20
    gasPrice = (await web3.eth.getGasPrice()) * (100 + gasPricePercent) / 100

    rhub = await RelayHub.deployed()
    sr = await SampleRecipient.deployed()
    forwarderAddress = await rhub.getForwarder(sr.address)
    paymaster = await TestPaymasterEverythingAccepted.deployed()

    await paymaster.deposit({ value: web3.utils.toWei('1', 'ether') })
    gasLess = await web3.eth.personal.newAccount('password')
    console.log('gasLess = ' + gasLess)
    console.log('starting relay')

    relayproc = await startRelay(rhub, {
      stake: 1e18,
      delay: 3600 * 24 * 7,
      baseRelayFee: 300,
      pctRelayFee: 12,
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
    await registerNewRelay({
      relayHub: rhub,
      stake: oneEther,
      delay: weekInSec,
      baseRelayFee: 0,
      pctRelayFee: 120,
      url: 'hello',
      relayAccount,
      ownerAccount: relayOwner
    })
  })

  after(async function () {
    await stopRelay(relayproc)
  })

  it('should query hub deposit of a paymaster contract on every call', async () => {
    const relayclient = new RelayClient(web3)
    const b1 = await relayclient.balanceOf(paymaster.address)
    const added = 200000
    await paymaster.deposit({ value: added })
    const b2 = new Big(await relayclient.balanceOf(paymaster.address))
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
        pctRelayFee: 12,
        gas_limit: 1000000,
        paymaster: paymaster.address
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
        await sleep(500)
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
      const approvalPaymaster = await TestPaymasterOwnerSignature.new()
      await approvalPaymaster.setHub(rhub.address)
      await rhub.depositFor(approvalPaymaster.address, { value: 1e18 })

      const expectedError = 13
      const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
      const to = sr.address
      const options = {
        approveFunction: () => { return 'aaaa6ad4b4fab03bb2feaea2d54c690206e40036e4baa930760e72479da0cc5575779f9db9ef801e144b5e6af48542107f2f094649334b030e2bb44f054429b451' },
        from: gasLess,
        to: to,
        pctRelayFee: 12,
        gas_limit: 1000000,
        paymaster: approvalPaymaster.address
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
          assert.include(error.otherErrors[0], 'canRelay failed in server: status: ' + expectedError)
        }
      }
    }))

  it('should consider a transaction with a relay tx nonce higher than expected as invalid', async function () {
    const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
    const to = sr.address
    const options = {
      from: gasLess,
      to: to,
      pctRelayFee: 12,
      gas_limit: 1000000,
      paymaster: paymaster.address
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
        jsonRequestData.relayMaxNonce = 1000000
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
      await paymaster.preRelayedCall(Buffer.from(''), { from: accounts[1] })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Function can only be called by RelayHub')
    }
  })

  it('should revert calls to postRelayedCall from non RelayHub address', async function () {
    try {
      await paymaster.postRelayedCall(Buffer.from(''), true, Buffer.from(''), 0,
        {
          gasLimit: 0,
          gasPrice: 0,
          pctRelayFee: 0,
          baseRelayFee: 0
        })
      assert.fail()
    } catch (error) {
      assertErrorMessageCorrect(error, 'Function can only be called by RelayHub')
    }
  })

  it('should relay transparently', async () => {
    relayClientConfig = {
      pctRelayFee: 12,
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

    let res = await sr.emitMessage('hello world', {
      from: gasLess,
      paymaster: paymaster.address
    })
    assert.equal(res.logs[0].event, 'SampleRecipientEmitted')
    assert.equal(res.logs[0].args.message, 'hello world')
    assert.equal(res.logs[0].args.realSender, gasLess)
    assert.equal(res.logs[0].args.msgSender.toLowerCase(), forwarderAddress.toLowerCase())
    res = await sr.emitMessage('hello again', {
      from: accounts[3],
      paymaster: paymaster.address
    })
    assert.equal(res.logs[0].event, 'SampleRecipientEmitted')
    assert.equal(res.logs[0].args.message, 'hello again')

    assert.equal(res.logs[0].args.realSender, accounts[3])
  })

  it('should relay transparently with long encoded function', async () => {
    relayClientConfig = {

      pctRelayFee: 12,
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

    let res = await sr.emitMessage('hello world'.repeat(1000), {
      from: gasLess,
      paymaster: paymaster.address
    })
    assert.equal(res.logs[0].event, 'SampleRecipientEmitted')
    assert.equal(res.logs[0].args.message, 'hello world'.repeat(1000))
    assert.equal(res.logs[0].args.realSender, gasLess)
    assert.equal(res.logs[0].args.msgSender.toLowerCase(), forwarderAddress.toLowerCase())
    res = await sr.emitMessage('hello again'.repeat(1000), {
      from: accounts[3],
      paymaster: paymaster.address
    })
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
            assert.equal(null, e, e)
            assert.ok(r.signedTx)
            assert.include(r.signedTx, messageHex)
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
        pctRelayFee: 0,
        baseRelayFee: 300,
        relayUrl: 'localhost1',
        RelayServerAddress: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
      },
      {
        pctRelayFee: 0,
        baseRelayFee: 300,
        relayUrl: 'localhost2',
        RelayServerAddress: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1'
      },
      {
        pctRelayFee: 0,
        baseRelayFee: 300,
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
      pctRelayFee: 12,
      gas_limit: 1000000,
      paymaster: paymaster.address
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
      pctRelayFee: 12,
      gas_limit: 1000000,
      paymaster: paymaster.address
    }

    await rc.relayTransaction(encoded, options)
    // eslint-disable-next-line no-unused-expressions
    expect(rc.sendViaRelay.calledOnce).to.be.true
    expect(rc.sendViaRelay).to.have.been.calledWith(
      sinon.match(({ relayAddress, from, to, encodedFunction, pctRelayFee, baseRelayFee, gasPrice, gasLimit, paymaster, senderNonce, signature, relayHubAddress }) => {
        const relayRequest = new RelayRequest({
          senderAddress: from,
          senderNonce,
          target: to,
          encodedFunction,
          pctRelayFee,
          baseRelayFee,
          gasPrice: gasPrice.toString(),
          gasLimit: gasLimit.toString(),
          paymaster,
          relayAddress
        })
        const data = getDataToSign({
          chainId: 7,
          verifier: forwarderAddress,
          relayRequest
        })
        const recoveredAccount = sigUtil.recoverTypedSignature_v4({
          data,
          sig: signature
        })
        return recoveredAccount.toLowerCase() === from.toLowerCase()
      }))
  })

  it('should use relay\'s published transaction fees if none is given in options', async function () {
    const rc = new RelayClient(web3)
    const ephemeralKeypair = RelayClient.newEphemeralKeypair()
    const fromAddr = ephemeralKeypair.address
    rc.useKeypairForSigning(ephemeralKeypair)
    sinon.spy(rc)

    const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
    const options = {
      from: fromAddr,
      to: sr.address,
      // explicitly not specifying pctRelayFee or baseRelayFee
      gas_limit: 1000000,
      paymaster: paymaster.address
    }
    await rc.relayTransaction(encoded, options)
    const expectedBaseRelayFee = '300'
    const expectedPctRelayFee = '12'
    // eslint-disable-next-line no-unused-expressions
    expect(rc.sendViaRelay.calledOnce).to.be.true
    expect(rc.sendViaRelay).to.have.been.calledWith(sinon.match(({ pctRelayFee, baseRelayFee }) => {
      return pctRelayFee === expectedPctRelayFee && baseRelayFee === expectedBaseRelayFee
    }))
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
      pctRelayFee: 12,
      gas_limit: 1000000,
      paymaster: paymaster.address
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

    before(async function () {
      const response = await request(localhostOne + '/getaddr')
      relayServerAddress = JSON.parse(response.body).RelayServerAddress
      beforeOwnerBalance = await web3.eth.getBalance(relayOwner)
    })

    it('should NOT send relay balance to owner after removed', async function () {
      const gasPrice = await web3.eth.getGasPrice()
      const res = await rhub.removeRelayByOwner(relayServerAddress, {
        from: relayOwner,
        gasPrice
      })
      const etherSpentByTx = BigInt(res.receipt.gasUsed) * BigInt(gasPrice)
      assert.equal('RelayRemoved', res.logs[0].event)
      assert.equal(relayServerAddress.toLowerCase(), res.logs[0].args.relay.toLowerCase())
      await sleep(2000)
      const afterOwnerBalance = BigInt(await web3.eth.getBalance(relayOwner))
      assert.equal(afterOwnerBalance + etherSpentByTx, BigInt(beforeOwnerBalance))
    })

    it('should send relay balance to owner only after unstaked', async function () {
      beforeOwnerBalance = await web3.eth.getBalance(relayOwner)
      const unstakeDelay = (await rhub.getRelay(relayServerAddress)).unstakeDelay.toNumber()
      await increaseTime(unstakeDelay)
      const res = await rhub.unstake(relayServerAddress, { from: relayOwner })
      assert.equal('Unstaked', res.logs[0].event)
      assert.equal(relayServerAddress.toLowerCase(), res.logs[0].args.relay.toLowerCase())

      let i = 0
      let relayBalance = await web3.eth.getBalance(relayServerAddress)
      // eslint-disable-next-line eqeqeq
      while (relayBalance != 0 && i < 10) {
        await sleep(200)
        relayBalance = await web3.eth.getBalance(relayServerAddress)
        i++
      }
      assert.equal(0, relayBalance)
      const afterOwnerBalance = await web3.eth.getBalance(relayOwner)
      assert.equal(true, parseInt(afterOwnerBalance) > parseInt(beforeOwnerBalance))
    })
  })

  describe('should handle incorrect relay hub contract in recipient', async function () {
    let paymaster2
    before(async function () {
      const relayProvider = new RelayProvider(web3.currentProvider, relayClientConfig)
      SampleRecipient.web3.setProvider(relayProvider)
      SampleRecipient.web3.currentProvider.relayOptions.isRelayEnabled = false
      paymaster2 = await TestPaymasterEverythingAccepted.new()
      // eslint-disable-next-line
      SampleRecipient.web3.currentProvider.relayOptions.isRelayEnabled = true
    })

    it('should revert on zero hub in recipient contract', async function () {
      try {
        await sr.emitMessage('hello world', {
          from: gasLess,
          paymaster: paymaster2.address
        })
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'The relay hub address is set to zero in paymaster at')
      }
    })

    it('should throw on invalid recipient', async function () {
      const relayClient = new RelayClient(web3)
      try {
        await relayClient.createRelayHubFromPaymaster(gasLess)
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'Could not get relay hub address from paymaster at')
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
        await relayClient.createRelayHubFromPaymaster(paymaster.address)
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
        await relayClient.createRelayHubFromPaymaster(paymaster.address)
        assert.fail()
      } catch (error) {
        assert.include(error.message, 'Unsupported relay hub version')
        assert.include(error.message, 'wrong version')
      }
    })
  })
})
