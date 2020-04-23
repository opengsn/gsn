/* global artifacts describe */
const Web3 = require('web3')
const RelayClient = require('./TmpLegacyRelayClient')
const RelayServer = require('../src/relayserver/RelayServer')
const TxStoreManager = require('../src/relayserver/TxStoreManager').TxStoreManager
const RelayHub = artifacts.require('./RelayHub.sol')
const TestRecipient = artifacts.require('./test/TestRecipient.sol')
const TrustedForwarder = artifacts.require('TrustedForwarder')
const StakeManager = artifacts.require('./StakeManager.sol')
const Penalizer = artifacts.require('./Penalizer.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')
const KeyManager = require('../src/relayserver/KeyManager')
const RelayHubABI = require('../src/common/interfaces/IRelayHub')
const PayMasterABI = require('../src/common/interfaces/IPaymaster')
const Environments = require('../src/relayclient/types/Environments')

const ethUtils = require('ethereumjs-util')
const { Transaction } = require('ethereumjs-tx')
const abiDecoder = require('abi-decoder')
const chai = require('chai')
const sinonChai = require('sinon-chai')
chai.use(sinonChai)
abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(TestRecipient.abi)
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)

const localhostOne = 'http://localhost:8090'
const workdir = '/tmp/gsn/test/relayserver'

const testutils = require('./TestUtils')
const increaseTime = testutils.increaseTime

if (!contract.only) { contract.only = contract } // buidler "support"

contract('RelayServer', function (accounts) {
  let rhub
  let forwarder
  let stakeManager
  let penalizer
  let sr
  let paymaster
  let gasLess, gasLess2
  const relayOwner = accounts[1]
  const dayInSec = 24 * 60 * 60
  const weekInSec = dayInSec * 7
  const oneEther = 1e18
  let relayServer, defunctRelayServer
  let serverWeb3provider
  let ethereumNodeUrl
  let _web3
  let id
  let encodedFunction
  let relayClient
  let options, options2
  let keyManager

  before(async function () {
    ethereumNodeUrl = web3.currentProvider.host
    serverWeb3provider = new Web3.providers.WebsocketProvider(ethereumNodeUrl)
    _web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))

    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    rhub = await RelayHub.new(Environments.defaultEnvironment.gtxdatanonzero, stakeManager.address, penalizer.address)
    sr = await TestRecipient.new()
    const forwarderAddress = await sr.getTrustedForwarder()
    forwarder = await TrustedForwarder.at(forwarderAddress)
    paymaster = await TestPaymasterEverythingAccepted.new()

    await paymaster.setHub(rhub.address)
    await paymaster.deposit({ value: _web3.utils.toWei('1', 'ether') })
    gasLess = await _web3.eth.personal.newAccount('password')
    gasLess2 = await _web3.eth.personal.newAccount('password2')
    keyManager = new KeyManager({ count: 2, seed: Date.now().toString() })
    const txStoreManager = new TxStoreManager({ workdir })
    relayServer = new RelayServer({
      txStoreManager,
      keyManager,
      // owner: relayOwner,
      hubAddress: rhub.address,
      stakeManagerAddress: stakeManager.address,
      url: localhostOne,
      baseRelayFee: 0,
      pctRelayFee: 0,
      gasPriceFactor: 1,
      ethereumNodeUrl,
      web3provider: serverWeb3provider,
      devMode: true
    })
    relayServer.on('error', (e) => {
      console.log('error event', e.message)
    })
    console.log('Relay Manager=', relayServer.getManagerAddress(), 'Worker=', relayServer.getAddress(1))

    encodedFunction = sr.contract.methods.emitMessage('hello world').encodeABI()
    const relayClientConfig = {
      relayUrl: localhostOne,
      relayAddress: relayServer.getManagerAddress(),
      allowed_relay_nonce_gap: 0,
      verbose: process.env.DEBUG
    }

    relayClient = new RelayClient(_web3, relayClientConfig)

    options = {
      // approveFunction: approveFunction,
      from: gasLess,
      to: sr.address,
      pctRelayFee: 0,
      gas_limit: 1000000,
      paymaster: paymaster.address
    }
    options2 = {
      ...options,
      from: gasLess2
    }
  })

  before(async function () {
    await relayServer?.txStoreManager.clearAll()
  })

  const clearStorage = async function () {
    await relayServer?.txStoreManager.clearAll()
    assert.deepEqual([], await relayServer.txStoreManager.getAll())
  }
  before(clearStorage)
  after(clearStorage)

  async function assertTransactionRelayed (txhash, gasLess) {
    const receipt = await _web3.eth.getTransactionReceipt(txhash)
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(relayServer._parseEvent)
    assert.equal(decodedLogs[1].name, 'SampleRecipientEmitted')
    assert.equal(decodedLogs[1].args.message, 'hello world')
    assert.equal(decodedLogs[3].name, 'TransactionRelayed')
    assert.equal(decodedLogs[3].args.relayWorker.toLowerCase(), relayServer.getAddress(1).toLowerCase())
    assert.equal(decodedLogs[3].args.from.toLowerCase(), gasLess.toLowerCase())
    assert.equal(decodedLogs[3].args.to.toLowerCase(), sr.address.toLowerCase())
    assert.equal(decodedLogs[3].args.paymaster.toLowerCase(), paymaster.address.toLowerCase())
    return receipt
  }

  async function assertRelayAdded (receipt, relayServer) {
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(relayServer._parseEvent)
    assert.equal(decodedLogs.length, 1)
    assert.equal(decodedLogs[0].name, 'RelayServerRegistered')
    assert.equal(decodedLogs[0].args.relayManager.toLowerCase(), relayServer.getManagerAddress().toLowerCase())
    assert.equal(decodedLogs[0].args.baseRelayFee, relayServer.baseRelayFee)
    assert.equal(decodedLogs[0].args.pctRelayFee, relayServer.pctRelayFee)
    assert.equal(decodedLogs[0].args.url, relayServer.url)
  }

  async function relayTransaction (options, badArgs) {
    const { relayRequest, relayMaxNonce, approvalData, signature } = await prepareRelayRequest(options)
    return relayTransactionFromRequest(badArgs, { relayRequest, relayMaxNonce, approvalData, signature })
  }

  async function relayTransactionFromRequest (badArgs, { relayRequest, relayMaxNonce, approvalData, signature }) {
    // console.log('relayRequest is', relayRequest, signature, approvalData)
    const signedTx = await relayServer.createRelayTransaction(
      {
        senderNonce: relayRequest.relayData.senderNonce,
        gasPrice: relayRequest.gasData.gasPrice,
        encodedFunction: relayRequest.encodedFunction,
        approvalData,
        signature,
        from: relayRequest.relayData.senderAddress,
        to: relayRequest.target,
        paymaster: relayRequest.relayData.paymaster,
        gasLimit: relayRequest.gasData.gasLimit,
        relayMaxNonce,
        baseRelayFee: relayRequest.gasData.baseRelayFee,
        pctRelayFee: relayRequest.gasData.pctRelayFee,
        relayHubAddress: rhub.address,
        ...badArgs
      })

    const txhash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(signedTx, 'hex')))
    await assertTransactionRelayed(txhash, relayRequest.relayData.senderAddress)
    return signedTx
  }

  async function prepareRelayRequest (options) {
    const { relayRequest, relayMaxNonce, approvalData, signature } = await relayClient._prepareRelayHttpRequest(
      encodedFunction,
      /* relayWorker: */relayServer.getAddress(1),
      /* pctRelayFee: */0,
      /* baseRelayFee: */0,
      /* gasPrice: */parseInt(await _web3.eth.getGasPrice()),
      /* gasLimit: */1000000,
      /* senderNonce: */(await forwarder.getNonce(options.from)).toString(),
      /* paymaster: */paymaster.address,
      /* relayHub: */rhub.contract,
      forwarder.contract,
      options)
    return { relayRequest, relayMaxNonce, approvalData, signature }
  }

  // When running server before staking/funding it, or when balance gets too low
  describe('multi-step server initialization ', async function () {
    it('should initialize relay params (chainId, networkId, gasPrice)', async function () {
      const expectedGasPrice = (await _web3.eth.getGasPrice()) * relayServer.gasPriceFactor
      const chainId = await _web3.eth.getChainId()
      const networkId = await _web3.eth.net.getId()
      assert.notEqual(relayServer.gasPrice, expectedGasPrice)
      assert.notEqual(relayServer.chainId, chainId)
      assert.notEqual(relayServer.networkId, networkId)
      assert.equal(relayServer.ready, false)
      await relayServer._worker({ number: await _web3.eth.getBlockNumber() })
      assert.include(relayServer.lastError, 'Server\'s balance too low')
      assert.equal(relayServer.gasPrice, expectedGasPrice)
      assert.equal(relayServer.chainId, chainId)
      assert.equal(relayServer.networkId, networkId)
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
    })

    it('should wait for balance', async function () {
      await relayServer._worker({ number: await _web3.eth.getBlockNumber() })
      assert.include(relayServer.lastError, 'Server\'s balance too low')
      const expectedBalance = _web3.utils.toWei('2', 'ether')
      assert.notEqual(relayServer.balance, expectedBalance)
      await _web3.eth.sendTransaction({
        to: relayServer.getManagerAddress(),
        from: relayOwner,
        value: expectedBalance
      })
      await relayServer._worker({ number: await _web3.eth.getBlockNumber() })
      assert.include(relayServer.lastError, 'Waiting for stake')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
      assert.equal(relayServer.balance, expectedBalance)
    })

    it('should wait for stake and then register', async function () {
      assert.equal(relayServer.lastScannedBlock, 0)
      await relayServer._worker({ number: await _web3.eth.getBlockNumber() })
      assert.include(relayServer.lastError, 'Waiting for stake')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
      const res = await stakeManager.stakeForAddress(relayServer.getManagerAddress(), weekInSec, {
        from: relayOwner,
        value: oneEther
      })
      const res2 = await stakeManager.authorizeHub(relayServer.getManagerAddress(), rhub.address, { from: relayOwner })
      assert.ok(res.receipt.status, 'stake failed')
      assert.ok(res2.receipt.status, 'authorize hub failed')
      const expectedLastScannedBlock = await _web3.eth.getBlockNumber()
      const receipt = await relayServer._worker({ number: expectedLastScannedBlock })
      assert.equal(relayServer.lastError, null)
      assert.equal(relayServer.lastScannedBlock, expectedLastScannedBlock)
      assert.equal(relayServer.stake, oneEther)
      assert.equal(relayServer.ready, true, 'relay not ready?')
      await assertRelayAdded(receipt, relayServer)
    })

    it('should start again after restarting process', async () => {
      const newKeyManager = new KeyManager({ count: 2, seed: Date.now().toString() })
      const txStoreManager = new TxStoreManager({ workdir })
      const newRelayServer = new RelayServer({
        txStoreManager,
        keyManager: newKeyManager,
        // owner: relayOwner,
        hubAddress: rhub.address,
        stakeManagerAddress: stakeManager.address,
        url: localhostOne,
        baseRelayFee: 0,
        pctRelayFee: 0,
        gasPriceFactor: 1,
        ethereumNodeUrl,
        web3provider: serverWeb3provider,
        devMode: true
      })

      await newRelayServer._worker({ number: await _web3.eth.getBlockNumber() })
      assert.equal(relayServer.lastError, null)
      assert.equal(relayServer.ready, true, 'relay not ready?')
    })
  })

  // When running server after both staking & funding it
  describe('single step server initialization', async function () {
    it('should initialize relay after staking and funding it', async function () {
      const keyManager = new KeyManager({ count: 2, seed: Date.now().toString() })
      const txStoreManager = new TxStoreManager({ workdir: workdir + '/defunct' })
      defunctRelayServer = new RelayServer({
        txStoreManager,
        keyManager,
        // owner: relayOwner,
        hubAddress: rhub.address,
        url: localhostOne,
        baseRelayFee: 0,
        pctRelayFee: 0,
        gasPriceFactor: 1,
        ethereumNodeUrl,
        web3provider: serverWeb3provider,
        devMode: true
      })
      defunctRelayServer.on('error', (e) => {
        console.log('defunct event', e.message)
      })
      await _web3.eth.sendTransaction({
        to: defunctRelayServer.getManagerAddress(),
        from: relayOwner,
        value: _web3.utils.toWei('2', 'ether')
      })

      await stakeManager.stakeForAddress(defunctRelayServer.getManagerAddress(), weekInSec, {
        from: relayOwner,
        value: oneEther
      })
      await stakeManager.authorizeHub(defunctRelayServer.getManagerAddress(), rhub.address, {
        from: relayOwner
      })
      const stake = await defunctRelayServer.refreshStake()
      assert.equal(stake, oneEther)

      const expectedGasPrice = (await _web3.eth.getGasPrice()) * defunctRelayServer.gasPriceFactor
      const expectedBalance = await _web3.eth.getBalance(defunctRelayServer.getManagerAddress())
      assert.equal(defunctRelayServer.ready, false)
      const expectedLastScannedBlock = await _web3.eth.getBlockNumber()
      assert.equal(defunctRelayServer.lastScannedBlock, 0)
      const receipt = await defunctRelayServer._worker({ number: expectedLastScannedBlock })
      assert.equal(defunctRelayServer.lastScannedBlock, expectedLastScannedBlock)
      assert.equal(defunctRelayServer.gasPrice, expectedGasPrice)
      assert.equal(defunctRelayServer.balance, expectedBalance)
      assert.equal(defunctRelayServer.ready, true, 'relay no ready?')
      await assertRelayAdded(receipt, defunctRelayServer)
    })
    after('txstore cleanup', async function () {
      await defunctRelayServer.txStoreManager.clearAll()
      assert.deepEqual([], await defunctRelayServer.txStoreManager.getAll())
    })
  })

  describe('relay transaction flows', async function () {
    it('should relay transaction', async function () {
      await relayTransaction(options)
    })

    /*
    * encodedFunction,
      approvalData,
      signature,
      from,
      to,
      paymaster,
      gasPrice,
      gasLimit,
      senderNonce,
      relayMaxNonce,
      baseRelayFee,
      pctRelayFee,
      relayHubAddress
      *
      * */
    it('should fail to relay with undefined encodedFunction', async function () {
      try {
        await relayTransaction(options, { encodedFunction: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'invalid encodedFunction given: undefined')
      }
    })
    it('should fail to relay with undefined approvalData', async function () {
      try {
        await relayTransaction(options, { approvalData: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'invalid approvalData given: undefined')
      }
    })
    it('should fail to relay with undefined signature', async function () {
      try {
        await relayTransaction(options, { signature: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'invalid signature given: undefined')
      }
    })
    it('should fail to relay with wrong signature', async function () {
      try {
        await relayTransaction(options,
          { signature: '0xdeadface00000a58b757da7dea5678548be5ff9b16e9d1d87c6157aff6889c0f6a406289908add9ea6c3ef06d033a058de67d057e2c0ae5a02b36854be13b0731c' })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'canRelay failed in server: signature mismatch')
      }
    })
    it('should fail to relay with wrong from', async function () {
      try {
        await relayTransaction(options, { from: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'canRelay failed in server: nonce mismatch')
      }
    })
    it('should fail to relay with wrong recipient', async function () {
      try {
        await relayTransaction(options, { to: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'canRelay failed in server: getTrustedForwarder failed')
      }
    })
    it('should fail to relay with invalid paymaster', async function () {
      try {
        await relayTransaction(options, { paymaster: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, `non-existent or incompatible paymaster contract: ${accounts[1]}`)
      }
    })
    it('should fail to relay when paymaster\'s balance too low', async function () {
      id = (await testutils.snapshot()).result
      try {
        await paymaster.withdraw(accounts[0])
        await relayTransaction(options)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'paymaster balance too low:')
      } finally {
        await testutils.revert(id)
      }
    })
    it('should fail to relay with uninitialized gasPrice', async function () {
      const gasPrice = relayServer.gasPrice
      delete relayServer.gasPrice
      try {
        await relayTransaction(options)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'gasPrice not initialized')
      } finally {
        relayServer.gasPrice = gasPrice
      }
    })
    it('should fail to relay with unacceptable gasPrice', async function () {
      try {
        await relayTransaction(options, { gasPrice: 1e2 })
        assert.fail()
      } catch (e) {
        assert.include(e.message,
          `Unacceptable gasPrice: relayServer's gasPrice:${relayServer.gasPrice} request's gasPrice: 100`)
      }
    })
    it('should fail to relay with wrong senderNonce', async function () {
      // First we change the senderNonce and see nonce failure
      try {
        await relayTransaction(options, { senderNonce: 123456 })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'canRelay failed in server: nonce mismatch')
      }
      // Now we replay the same transaction so we get WrongNonce
      const { relayRequest, relayMaxNonce, approvalData, signature } = await prepareRelayRequest(options)
      await relayTransactionFromRequest({}, { relayRequest, relayMaxNonce, approvalData, signature })
      try {
        await relayTransactionFromRequest({},
          { relayRequest, relayMaxNonce: relayMaxNonce + 1, approvalData, signature })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'canRelay failed in server: nonce mismatch')
      }
    })
    it('should fail to relay with wrong relayMaxNonce', async function () {
      try {
        await relayTransaction(options, { relayMaxNonce: 0 })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable relayMaxNonce:')
      }
    })
    it('should fail to relay with wrong baseRelayFee', async function () {
      try {
        await relayTransaction(options, { baseRelayFee: -1 })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable baseRelayFee:')
      }
    })
    it('should fail to relay with wrong pctRelayFee', async function () {
      try {
        await relayTransaction(options, { pctRelayFee: -1 })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable pctRelayFee:')
      }
    })
    it('should fail to relay with wrong hub address', async function () {
      try {
        await relayTransaction(options, { relayHubAddress: '0xdeadface' })
        assert.fail()
      } catch (e) {
        assert.include(e.message,
            `Wrong hub address.\nRelay server's hub address: ${relayServer.hubAddress}, request's hub address: 0xdeadface\n`)
      }
    })
  })

  describe('resend unconfirmed transactions task', async function () {
    it('should resend unconfirmed transaction', async function () {
      // First clear db
      await relayServer.txStoreManager.clearAll()
      assert.deepEqual([], await relayServer.txStoreManager.getAll())
      // Send a transaction via the relay, but then revert to a previous snapshot
      id = (await testutils.snapshot()).result
      const signedTx = await relayTransaction(options)
      let parsedTxHash = ethUtils.bufferToHex((new Transaction(signedTx)).hash())
      const receiptBefore = await _web3.eth.getTransactionReceipt(parsedTxHash)
      const minedTxBefore = await _web3.eth.getTransaction(parsedTxHash)
      assert.equal(parsedTxHash, receiptBefore.transactionHash)
      await testutils.revert(id)
      // Ensure tx is removed by the revert
      const receiptAfter = await _web3.eth.getTransactionReceipt(parsedTxHash)
      assert.equal(null, receiptAfter)
      // Should not do anything, as not enough time has passed
      let sortedTxs = await relayServer.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      let resentTx = await relayServer._resendUnconfirmedTransactions({ number: await _web3.eth.getBlockNumber() })
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      // Increase time by hooking Date.now()
      try {
        const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
        Date.origNow = Date.now
        Date.now = function () {
          return Date.origNow() + pendingTransactionTimeout
        }
        // Resend tx, now should be ok
        resentTx = await relayServer._resendUnconfirmedTransactions({ number: await _web3.eth.getBlockNumber() })
        parsedTxHash = ethUtils.bufferToHex((new Transaction(resentTx)).hash())

        // Validate relayed tx with increased gasPrice
        const minedTxAfter = await _web3.eth.getTransaction(parsedTxHash)
        assert.equal(minedTxAfter.gasPrice, minedTxBefore.gasPrice * 1.2)
        await assertTransactionRelayed(parsedTxHash, gasLess)
      } finally {
        // Release hook
        Date.now = Date.origNow
      }
      // Check the tx is removed from the store only after enough blocks
      resentTx = await relayServer._resendUnconfirmedTransactions({ number: await _web3.eth.getBlockNumber() })
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      const confirmationsNeeded = 12
      await testutils.evmMineMany(confirmationsNeeded)
      resentTx = await relayServer._resendUnconfirmedTransactions({ number: await _web3.eth.getBlockNumber() })
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.txStoreManager.getAll()
      assert.deepEqual([], sortedTxs)

      // Revert for following tests
      await testutils.revert(id)
    })

    it('should resend multiple unconfirmed transactions', async function () {
      // First clear db
      await relayServer.txStoreManager.clearAll()
      assert.deepEqual([], await relayServer.txStoreManager.getAll())
      // Send 3 transactions, separated by 1 min each, and revert the last 2
      const signedTx1 = await relayTransaction(options)
      id = (await testutils.snapshot()).result
      // Increase time by hooking Date
      let constructorIncrease = 2 * 60 * 1000 // 1 minute in milliseconds
      let nowIncrease = 0
      const origDate = Date
      try {
        const NewDate = class extends Date {
          constructor () {
            super(Date.origNow() + constructorIncrease)
          }

          static now () {
            return super.now() + nowIncrease
          }

          static origNow () {
            return super.now()
          }
        }
        Date = NewDate // eslint-disable-line no-global-assign
        await relayTransaction(options)
        constructorIncrease = 4 * 60 * 1000 // 4 minutes in milliseconds
        const signedTx3 = await relayTransaction(options)
        await testutils.revert(id)
        const nonceBefore = parseInt(await _web3.eth.getTransactionCount(relayServer.getManagerAddress()))
        // Check tx1 still went fine after revert
        const parsedTxHash1 = ethUtils.bufferToHex((new Transaction(signedTx1)).hash())
        await assertTransactionRelayed(parsedTxHash1, gasLess)
        // After 10 minutes, tx2 is not resent because tx1 is still unconfirmed
        nowIncrease = 10 * 60 * 1000 // 10 minutes in milliseconds
        constructorIncrease = 0
        let sortedTxs = await relayServer.txStoreManager.getAll()
        // console.log('times:', sortedTxs[0].createdAt, sortedTxs[1].createdAt, sortedTxs[2].createdAt )
        assert.equal(sortedTxs[0].txId, parsedTxHash1)
        let resentTx = await relayServer._resendUnconfirmedTransactions({ number: await _web3.eth.getBlockNumber() })
        assert.equal(null, resentTx)
        assert.equal(nonceBefore, parseInt(await _web3.eth.getTransactionCount(relayServer.getManagerAddress())))
        sortedTxs = await relayServer.txStoreManager.getAll()
        // console.log('sortedTxs?', sortedTxs)
        assert.equal(sortedTxs[0].txId, parsedTxHash1)
        // Mine a bunch of blocks, so tx1 is confirmed and tx2 is resent
        const confirmationsNeeded = 12
        await testutils.evmMineMany(confirmationsNeeded)
        const resentTx2 = await relayServer._resendUnconfirmedTransactions({ number: await _web3.eth.getBlockNumber() })
        const parsedTxHash2 = ethUtils.bufferToHex((new Transaction(resentTx2)).hash())
        await assertTransactionRelayed(parsedTxHash2, gasLess)
        // Re-inject tx3 into the chain as if it were mined once tx2 goes through
        await _web3.eth.sendSignedTransaction(signedTx3)
        const parsedTxHash3 = ethUtils.bufferToHex((new Transaction(signedTx3)).hash())
        await assertTransactionRelayed(parsedTxHash3, gasLess)
        // Check that tx3 does not get resent, even after time passes or blocks get mined, and that store is empty
        nowIncrease = 60 * 60 * 1000 // 60 minutes in milliseconds
        await testutils.evmMineMany(confirmationsNeeded)
        resentTx = await relayServer._resendUnconfirmedTransactions({ number: await _web3.eth.getBlockNumber() })
        assert.equal(null, resentTx)
        assert.deepEqual([], await relayServer.txStoreManager.getAll())
      } finally {
        // Release hook
        Date = origDate // eslint-disable-line no-global-assign
      }
    })
  })

  describe('listener task', async function () {
    let origWorker
    let started
    beforeEach(async function () {
      origWorker = relayServer._worker
      started = false
      relayServer._worker = async function () {
        started = true
        this.emit('error', new Error('GOTCHA'))
      }
    })
    afterEach(async function () {
      relayServer._worker = origWorker
    })
    it('should start block listener', async function () {
      relayServer.start()
      await testutils.evmMine()
      assert.isTrue(started, 'could not start task correctly')
    })
    it('should stop block listener', async function () {
      relayServer.stop()
      await testutils.evmMine()
      assert.isFalse(started, 'could not stop task correctly')
    })
  })

  describe('nonce sense', async function () {
    before(async function () {
      relayServer._pollNonceOrig = relayServer._pollNonce
      relayServer._pollNonce = async function (signerIndex) {
        const signer = this.getAddress(signerIndex)
        const nonce = await this.web3.eth.getTransactionCount(signer, 'pending')
        return nonce
      }
    })
    after(async function () {
      relayServer._pollNonce = relayServer._pollNonceOrig
    })
    it('should fail if nonce is not mutexed', async function () {
      relayServer.nonceMutexOrig = relayServer.nonceMutex
      relayServer.nonceMutex = {
        acquire: function () {
          return function releaseMutex () {}
        },
        isLocked: () => false
      }
      try {
        const promises = [relayTransaction(options), relayTransaction(options2)]
        await Promise.all(promises)
        assert.fail()
      } catch (e) {
        console.log(e)
        assert.include(e.message, 'violates the unique constraint')
        // since we forced the server to create an illegal tx with an already used nonce, we decrease the nonce
        relayServer.nonce--
      } finally {
        relayServer.nonceMutex = relayServer.nonceMutexOrig
      }
    })
    it('should handle nonce atomically', async function () {
      const promises = [relayTransaction(options), relayTransaction(options2)]
      await Promise.all(promises)
    })
    it('should not deadlock if server returned error while locked', async function () {
      try {
        relayServer.keyManager.signTransactionOrig = relayServer.keyManager.signTransaction
        relayServer.keyManager.signTransaction = function () {
          throw new Error('no tx for you')
        }
        try {
          await relayTransaction(options)
        } catch (e) {
          console.log(e)
          assert.equal(e.message, 'no tx for you')
          assert.isFalse(relayServer.nonceMutex.isLocked(), 'nonce mutex not released after exception')
        }
      } finally {
        relayServer.keyManager.signTransaction = relayServer.keyManager.signTransactionOrig
      }
    })
  })

  describe('event handlers', async function () {
    it.skip('should handle RelayRemoved event', async function () {
      assert.equal(relayServer.removed, false)
      assert.equal(relayServer.isReady(), true)
      await rhub.removeRelayByOwner(relayServer.getManagerAddress(), {
        from: relayOwner
      })
      await relayServer._worker({ number: await _web3.eth.getBlockNumber() })
      assert.equal(relayServer.removed, true)
      assert.equal(relayServer.isReady(), false)
    })

    it('should handle Unstaked event - send balance to owner', async function () {
      const relayBalanceBefore = await relayServer.refreshBalance()
      assert.isTrue(relayBalanceBefore > 0)
      await increaseTime(weekInSec)
      await stakeManager.unlockStake(relayServer.getManagerAddress(), { from: relayOwner })
      await relayServer._worker({ number: await _web3.eth.getBlockNumber() })
      const relayBalanceAfter = await relayServer.refreshBalance()
      assert.equal(relayBalanceAfter.toNumber(), 0, 'relayBalanceAfter is not zero: ' + relayBalanceAfter)
    })
    // TODO add failure tests
  })
})
