/* global artifacts BigInt describe */
const Web3 = require('web3')
const RelayClient = require('../src/js/relayclient/RelayClient')
const RelayServer = require('../src/js/relayserver/RelayServer')
const TxStoreManager = require('../src/js/relayserver/TxStoreManager').TxStoreManager
const utils = require('../src/js/relayclient/utils')
const RelayHub = artifacts.require('./RelayHub.sol')
const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestEverythingAcceptedSponsor = artifacts.require('./test/TestSponsorEverythingAccepted.sol')
const getDataToSign = require('../src/js/relayclient/EIP712/Eip712Helper')
const KeyManager = require('../src/js/relayserver/KeyManager')
const RelayHubABI = require('../src/js/relayclient/interfaces/IRelayHub')
const GasSponsorABI = require('../src/js/relayclient/interfaces/IGasSponsor')

const ethUtils = require('ethereumjs-util')
const abiDecoder = require('abi-decoder')

const chai = require('chai')
const sinonChai = require('sinon-chai')
chai.use(sinonChai)
abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(GasSponsorABI)
abiDecoder.addABI(SampleRecipient.abi)
abiDecoder.addABI(TestEverythingAcceptedSponsor.abi)

const localhostOne = 'http://localhost:8090'
const ethereumNodeUrl = 'http://localhost:8545'
const workdir = '/tmp/gsn/test/relayserver'

const testutils = require('./testutils')
const increaseTime = testutils.increaseTime

const util = require('util')

contract('RelayServer', function (accounts) {
  let rhub
  let sr
  let gasSponsor
  let gasLess
  let gasPrice
  const relayOwner = accounts[1]
  const dayInSec = 24 * 60 * 60
  const weekInSec = dayInSec * 7
  const oneEther = 1e18
  let relayServer
  let serverWeb3provider
  let web3

  before(async function () {
    serverWeb3provider = new Web3.providers.WebsocketProvider(ethereumNodeUrl)
    web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))
    const gasPricePercent = 20
    gasPrice = (await web3.eth.getGasPrice()) * (100 + gasPricePercent) / 100

    rhub = await RelayHub.deployed()
    sr = await SampleRecipient.deployed()
    gasSponsor = await TestEverythingAcceptedSponsor.deployed()

    await gasSponsor.deposit({ value: web3.utils.toWei('1', 'ether') })
    gasLess = await web3.eth.personal.newAccount('password')
    const keyManager = new KeyManager({ ecdsaKeyPair: KeyManager.newKeypair() })
    const txStoreManager = new TxStoreManager({ workdir })
    relayServer = new RelayServer({
      txStoreManager,
      keyManager,
      // owner: relayOwner,
      hubAddress: rhub.address,
      url: localhostOne,
      txFee: 0,
      gasPriceFactor: 1,
      ethereumNodeUrl,
      web3provider: serverWeb3provider,
      devMode: true
    })
    console.log('Relay Server Address', relayServer.address)
    await web3.eth.sendTransaction({
      to: relayServer.address,
      from: relayOwner,
      value: web3.utils.toWei('2', 'ether')
    })
    await rhub.stake(relayServer.address, weekInSec, {
      from: relayOwner,
      value: oneEther
    })
    const stake = await relayServer.getStake()
    assert.equal(stake, oneEther)
  })

  after('txstore cleanup', async function () {
    await relayServer.txStoreManager.clearAll()
  })

  it('should initialize relay', async function () {
    const expectedGasPrice = (await web3.eth.getGasPrice()) * relayServer.gasPriceFactor
    const expectedBalance = await web3.eth.getBalance(relayServer.address)
    const chainId = await web3.eth.net.getId()
    assert.notEqual(relayServer.gasPrice, expectedGasPrice)
    assert.notEqual(relayServer.balance, expectedBalance)
    assert.notEqual(relayServer.chainId, chainId)
    assert.equal(relayServer.ready, false)
    const receipt = await relayServer._worker({number: await web3.eth.getBlockNumber()})
    assert.equal(relayServer.gasPrice, expectedGasPrice)
    assert.equal(relayServer.balance, expectedBalance)
    assert.equal(relayServer.chainId, chainId)
    assert.equal(relayServer.ready, true)
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(relayServer._parseEvent)
    assert.equal(decodedLogs.length, 1)
    assert.equal(decodedLogs[0].name, 'RelayAdded')
    assert.equal(decodedLogs[0].args.relay.toLowerCase(), relayServer.address.toLowerCase())
    assert.equal(decodedLogs[0].args.owner.toLowerCase(), relayServer.owner.toLowerCase())
    assert.equal(decodedLogs[0].args.transactionFee, relayServer.txFee)
    assert.equal(decodedLogs[0].args.stake, relayServer.stake)
    assert.equal(decodedLogs[0].args.unstakeDelay, relayServer.unstakeDelay)
    assert.equal(decodedLogs[0].args.url, relayServer.url)
  })

  it('should relay transaction', async function () {
    const encoded = sr.contract.methods.emitMessage('hello world').encodeABI()
    const options = {
      // approveFunction: approveFunction,
      from: gasLess,
      to: sr.address,
      txfee: 0,
      gas_limit: 1000000,
      gasSponsor: gasSponsor.address
    }
    console.log('server address', relayServer.address)
    const relayClientConfig = {
      relayUrl: localhostOne,
      relayAddress: relayServer.address,
      allowed_relay_nonce_gap: 0,
      verbose: process.env.DEBUG
    }

    // const jsonRequestData = {
    //   encodedFunction: encodedFunction,
    //   signature: parseHexString(signature.replace(/^0x/, '')),
    //   approvalData: parseHexString(approvalData.toString('hex').replace(/^0x/, '')),
    //   from: from,
    //   to: to,
    //   gasPrice,
    //   gasLimit,
    //   gasSponsor,
    //   relayFee: relayFee,
    //   SenderNonce: parseInt(senderNonce),
    //   RelayMaxNonce: parseInt(relayMaxNonce),
    //   RelayHubAddress: relayHubAddress
    // }

    const relayClient = new RelayClient(web3, relayClientConfig)
    relayClient.sendViaRelay = async function (
      {
        relayAddress,
        from,
        to,
        encodedFunction,
        relayFee,
        gasPrice,
        gasLimit,
        gasSponsor,
        senderNonce,
        signature,
        approvalData,
        relayUrl,
        relayHubAddress,
        relayMaxNonce
      }) {
      console.log('hooked!')
      return relayServer.createRelayTransaction(
        {
          relayAddress,
          from,
          to,
          encodedFunction,
          relayFee,
          gasPrice,
          gasLimit,
          gasSponsor,
          senderNonce,
          signature,
          approvalData,
          relayUrl,
          relayHubAddress,
          relayMaxNonce
        })
    }
    relayClient.serverHelper.newActiveRelayPinger = function () {
      return {
        nextRelay: function () {
          return {
            RelayServerAddress: relayServer.address,
            relayUrl: localhostOne,
            transactionFee: 0
          }
        }
      }
    }

    const signedTx = await relayClient.relayTransaction(encoded, options)
    const txhash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(signedTx, 'hex')))
    const receipt = await web3.eth.getTransactionReceipt(txhash)
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(relayServer._parseEvent)
    assert.equal(decodedLogs[1].name, 'SampleRecipientEmitted')
    assert.equal(decodedLogs[1].args.message, 'hello world')
    assert.equal(decodedLogs[3].name, 'TransactionRelayed')
    assert.equal(decodedLogs[3].args.relay.toLowerCase(), relayServer.address.toLowerCase())
    assert.equal(decodedLogs[3].args.from.toLowerCase(), gasLess.toLowerCase())
    assert.equal(decodedLogs[3].args.to.toLowerCase(), sr.address.toLowerCase())
    assert.equal(decodedLogs[3].args.sponsor.toLowerCase(), gasSponsor.address.toLowerCase())
  })

  it('should handle RelayRemoved event', async function () {
    assert.equal(relayServer.removed, false)
    assert.equal(relayServer.isReady(), true)
    await rhub.removeRelayByOwner(relayServer.address, {
      from: relayOwner
    })
    await relayServer._worker({number: await web3.eth.getBlockNumber()})
    assert.equal(relayServer.removed, true)
    assert.equal(relayServer.isReady(), false)
  })

  it('should handle Unstaked event - send balance to owner', async function () {
    const relayBalanceBefore = await relayServer.getBalance()
    assert.isTrue(relayBalanceBefore > 0)
    await increaseTime(weekInSec)
    await rhub.unstake(relayServer.address, { from: relayOwner })
    await relayServer._worker({number: await web3.eth.getBlockNumber()})
    const relayBalanceAfter = await relayServer.getBalance()
    assert.isTrue(relayBalanceAfter === 0)
  })

  it('should resend unconfirmed transactions', async function () {

  })

  describe('Http server', async function () {

  })
})
