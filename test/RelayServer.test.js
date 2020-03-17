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
const Transaction = require('ethereumjs-tx')
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
  let id

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
    assert.deepEqual([], await relayServer.txStoreManager.getAll())
  })

  async function assertTransactionRelayed (txhash) {
    const receipt = await web3.eth.getTransactionReceipt(txhash)
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(relayServer._parseEvent)
    assert.equal(decodedLogs[1].name, 'SampleRecipientEmitted')
    assert.equal(decodedLogs[1].args.message, 'hello world')
    assert.equal(decodedLogs[3].name, 'TransactionRelayed')
    assert.equal(decodedLogs[3].args.relay.toLowerCase(), relayServer.address.toLowerCase())
    assert.equal(decodedLogs[3].args.from.toLowerCase(), gasLess.toLowerCase())
    assert.equal(decodedLogs[3].args.to.toLowerCase(), sr.address.toLowerCase())
    assert.equal(decodedLogs[3].args.sponsor.toLowerCase(), gasSponsor.address.toLowerCase())
    return receipt
  }

  async function relayTransactionThroughClient () {
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
    await assertTransactionRelayed(txhash)
    return signedTx
  }

  it('should initialize relay', async function () {
    const expectedGasPrice = (await web3.eth.getGasPrice()) * relayServer.gasPriceFactor
    const expectedBalance = await web3.eth.getBalance(relayServer.address)
    const chainId = await web3.eth.net.getId()
    assert.notEqual(relayServer.gasPrice, expectedGasPrice)
    assert.notEqual(relayServer.balance, expectedBalance)
    assert.notEqual(relayServer.chainId, chainId)
    assert.equal(relayServer.ready, false)
    const receipt = await relayServer._worker({ number: await web3.eth.getBlockNumber() })
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
    await relayTransactionThroughClient()
  })

  it('should resend unconfirmed transaction', async function () {
    // First clear db
    await relayServer.txStoreManager.clearAll()
    assert.deepEqual([], await relayServer.txStoreManager.getAll())
    // Send a transaction via the relay, but then revert to a previous snapshot
    id = (await testutils.snapshot()).result
    const signedTx = await relayTransactionThroughClient()
    let parsedTxHash = ethUtils.bufferToHex((new Transaction(signedTx)).hash())
    const receiptBefore = await web3.eth.getTransactionReceipt(parsedTxHash)
    const minedTxBefore = await web3.eth.getTransaction(parsedTxHash)
    assert.equal(parsedTxHash, receiptBefore.transactionHash)
    await testutils.revert(id)
    // Ensure tx is removed by the revert
    const receiptAfter = await web3.eth.getTransactionReceipt(parsedTxHash)
    assert.equal(null, receiptAfter)
    // Should not do anything, as not enough time has passed
    let sortedTxs = await relayServer.txStoreManager.getAll()
    assert.equal(sortedTxs[0].txId, parsedTxHash)
    let resentTx = await relayServer._resendUnconfirmedTransactions({ number: await web3.eth.getBlockNumber() })
    assert.equal(null, resentTx)
    sortedTxs = await relayServer.txStoreManager.getAll()
    assert.equal(sortedTxs[0].txId, parsedTxHash)
    // Increase time by hooking Date.now()
    const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
    Date.origNow = Date.now
    Date.now = function () {
      return Date.origNow() + pendingTransactionTimeout
    }
    // Resend tx, now should be ok
    resentTx = await relayServer._resendUnconfirmedTransactions({ number: await web3.eth.getBlockNumber() })
    parsedTxHash = ethUtils.bufferToHex((new Transaction(resentTx)).hash())

    // validate relayed tx with increased gasPrice
    const minedTxAfter = await web3.eth.getTransaction(parsedTxHash)
    assert.equal(minedTxAfter.gasPrice, minedTxBefore.gasPrice * 1.2)
    await assertTransactionRelayed(parsedTxHash)
    // release hook
    Date.now = Date.origNow
    // Check the tx is removed from the store only after enough blocks
    resentTx = await relayServer._resendUnconfirmedTransactions({ number: await web3.eth.getBlockNumber() })
    assert.equal(null, resentTx)
    sortedTxs = await relayServer.txStoreManager.getAll()
    assert.equal(sortedTxs[0].txId, parsedTxHash)
    const confirmationsNeeded = 12
    for (let i =0; i < confirmationsNeeded; i++) {
      await testutils.evmMine()
    }
    resentTx = await relayServer._resendUnconfirmedTransactions({ number: await web3.eth.getBlockNumber() })
    assert.equal(null, resentTx)
    sortedTxs = await relayServer.txStoreManager.getAll()
    assert.deepEqual([],sortedTxs)

    //revert for following tests
    await testutils.revert(id)
  })

  it('should resend multiple unconfirmed transactions', async function () {
    // Send 3 transactions, separated by 1 min each, and revert the last 2
    await relayTransactionThroughClient()
    await relayTransactionThroughClient()
    await relayTransactionThroughClient()
  })

  it('should handle RelayRemoved event', async function () {
    assert.equal(relayServer.removed, false)
    assert.equal(relayServer.isReady(), true)
    await rhub.removeRelayByOwner(relayServer.address, {
      from: relayOwner
    })
    await relayServer._worker({ number: await web3.eth.getBlockNumber() })
    assert.equal(relayServer.removed, true)
    assert.equal(relayServer.isReady(), false)
  })

  it('should handle Unstaked event - send balance to owner', async function () {
    const relayBalanceBefore = await relayServer.getBalance()
    assert.isTrue(relayBalanceBefore > 0)
    await increaseTime(weekInSec)
    await rhub.unstake(relayServer.address, { from: relayOwner })
    await relayServer._worker({ number: await web3.eth.getBlockNumber() })
    const relayBalanceAfter = await relayServer.getBalance()
    assert.isTrue(relayBalanceAfter === 0)
  })
})
