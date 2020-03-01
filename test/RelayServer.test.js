/* global artifacts BigInt */
const Web3 = require('web3')
const RelayClient = require('../src/js/relayclient/RelayClient')
const RelayServer = require('../src/js/relayserver/RelayServer')
const RelayProvider = require('../src/js/relayclient/RelayProvider')
const utils = require('../src/js/relayclient/utils')
const RelayHub = artifacts.require('./RelayHub.sol')
const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestEverythingAcceptedSponsor = artifacts.require('./test/TestSponsorEverythingAccepted.sol')
const TestSponsorOwnerSignature = artifacts.require('./test/TestSponsorOwnerSignature.sol')
const getDataToSign = require('../src/js/relayclient/EIP712/Eip712Helper')
const KeyManager = require('../src/js/relayserver/KeyManager')
const RelayHubABI = require('../src/js/relayclient/interfaces/IRelayHub')
const GasSponsorABI = require('../src/js/relayclient/interfaces/IGasSponsor')

const Transaction = require('ethereumjs-tx')
const ethUtils = require('ethereumjs-util')
const abiDecoder = require('abi-decoder')

const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const expect = require('chai').expect
chai.use(sinonChai)
abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(GasSponsorABI)
abiDecoder.addABI(SampleRecipient.abi)
abiDecoder.addABI(TestEverythingAcceptedSponsor.abi)

const sigUtil = require('eth-sig-util')

const localhostOne = 'http://localhost:8090'
const ethereumNodeUrl = 'http://localhost:8545'

const testutils = require('./testutils')
const registerNewRelay = testutils.register_new_relay
const increaseTime = testutils.increaseTime
const assertErrorMessageCorrect = testutils.assertErrorMessageCorrect

const Big = require('big.js')

const util = require('util')
const request = util.promisify(require('request'))

contract.only('RelayServer', function (accounts) {
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
    relayServer = new RelayServer({
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

  it('should initialize relay', async function () {
    const chainId = await web3.eth.net.getId()
    assert.notEqual(relayServer.chainId, chainId)
    const receipt = await relayServer.init()
    assert.equal(relayServer.chainId, chainId)
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

  it('should run worker task to update relay blockchain view', async function () {
    const expectedGasPrice = (await web3.eth.getGasPrice()) * relayServer.gasPriceFactor
    const expectedBalance = await web3.eth.getBalance(relayServer.address)
    assert.notEqual(relayServer.gasPrice, expectedGasPrice)
    assert.notEqual(relayServer.balance, expectedBalance)
    await relayServer._worker()
    assert.equal(relayServer.gasPrice, expectedGasPrice)
    assert.equal(relayServer.balance, expectedBalance)
    // assert.equal(relayServer.lastScannedBlock, await web3.eth.getBlockNumber())
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
    await rhub.removeRelayByOwner(relayServer.address, {
      from: relayOwner
    })
    await relayServer._worker()
    assert.equal(relayServer.removed, true)
  })

  it('should handle Unstaked event', async function () {
    const relayBalanceBefore = await relayServer.getBalance()
    assert.isTrue(relayBalanceBefore > 0)
    await increaseTime(weekInSec)
    await rhub.unstake(relayServer.address, { from: relayOwner })
    await relayServer._worker()
    const relayBalanceAfter = await relayServer.getBalance()
    assert.isTrue(relayBalanceAfter === 0)
  })
})
