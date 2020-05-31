/* global artifacts describe */
import Web3 from 'web3'
import RelayClient from '../src/relayclient/RelayClient'
import { RelayServer, RelayServerParams } from '../src/relayserver/RelayServer'
import { TxStoreManager } from '../src/relayserver/TxStoreManager'
import { KeyManager } from '../src/relayserver/KeyManager'
import RelayHubABI from '../src/common/interfaces/IRelayHub.json'
import PayMasterABI from '../src/common/interfaces/IPaymaster.json'
import { defaultEnvironment } from '../src/relayclient/types/Environments'
import * as ethUtils from 'ethereumjs-util'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
// @ts-ignore
import abiDecoder from 'abi-decoder'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import { sleep, revert, snapshot, evmMine, evmMineMany, increaseTime } from './TestUtils'
import { removeHexPrefix } from '../src/common/utils'
import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance, TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance,
  TrustedForwarderInstance
} from '../types/truffle-contracts'
import { Address } from '../src/relayclient/types/Aliases'
import { HttpProvider, TransactionReceipt } from 'web3-core'
import { configureGSN } from '../src/relayclient/GSNConfigurator'
import { RelayInfo } from '../src/relayclient/types/RelayInfo'
import PingResponse from '../src/common/PingResponse'
import { RelayRegisteredEventInfo } from '../src/relayclient/types/RelayRegisteredEventInfo'
import GsnTransactionDetails from '../src/relayclient/types/GsnTransactionDetails'
import { BlockHeader } from 'web3-eth'
import { toBN, toHex } from 'web3-utils'
import RelayRequest from '../src/common/EIP712/RelayRequest'
import TmpRelayTransactionJsonRequest from '../src/relayclient/types/TmpRelayTransactionJsonRequest'
import Mutex from 'async-mutex/lib/Mutex'

const RelayHub = artifacts.require('./RelayHub.sol')
const TestRecipient = artifacts.require('./test/TestRecipient.sol')
const TrustedForwarder = artifacts.require('TrustedForwarder')
const StakeManager = artifacts.require('./StakeManager.sol')
const Penalizer = artifacts.require('./Penalizer.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')

const { expect } = require('chai').use(chaiAsPromised).use(sinonChai)

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(TestRecipient.abi)
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)

const localhostOne = 'http://localhost:8090'
const workdir = '/tmp/gsn/test/relayserver'

contract('RelayServer', function (accounts) {
  let rhub: RelayHubInstance
  let forwarder: TrustedForwarderInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let sr: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let gasLess: Address, gasLess2: Address
  const relayOwner = accounts[1]
  const dayInSec = 24 * 60 * 60
  const weekInSec = dayInSec * 7
  const oneEther = toBN(1e18)
  let relayServer: RelayServer, defunctRelayServer: RelayServer
  let serverWeb3provider: provider
  let ethereumNodeUrl: string
  let _web3: Web3
  let id: string, globalId: string
  let encodedFunction: PrefixedHexString
  let relayClient: RelayClient
  let options: any, options2: any
  let keyManager: KeyManager

  before(async function () {
    globalId = (await snapshot()).result
    ethereumNodeUrl = (web3.currentProvider as HttpProvider).host
    serverWeb3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
    _web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))

    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    rhub = await RelayHub.new(stakeManager.address, penalizer.address)
    sr = await TestRecipient.new()
    const forwarderAddress = await sr.getTrustedForwarder()
    forwarder = await TrustedForwarder.at(forwarderAddress)
    paymaster = await TestPaymasterEverythingAccepted.new()

    await paymaster.setRelayHub(rhub.address)
    await paymaster.deposit({ value: _web3.utils.toWei('1', 'ether') })
    gasLess = await _web3.eth.personal.newAccount('password')
    gasLess2 = await _web3.eth.personal.newAccount('password2')
    keyManager = new KeyManager(2, workdir)
    const txStoreManager = new TxStoreManager({ workdir })
    const params = {
      txStoreManager,
      keyManager,
      hubAddress: rhub.address,
      url: localhostOne,
      baseRelayFee: 0,
      pctRelayFee: 0,
      gasPriceFactor: 1,
      web3provider: serverWeb3provider,
      devMode: true
    }
    relayServer = new RelayServer(params as RelayServerParams)
    relayServer.on('error', (e) => {
      console.log('error event', e.message)
    })
    console.log('Relay Manager=', relayServer.getManagerAddress(), 'Worker=', relayServer.getAddress(1))

    encodedFunction = sr.contract.methods.emitMessage('hello world').encodeABI()
    const relayClientConfig = {
      preferredRelays: [localhostOne],
      maxRelayNonceGap: 0,
      verbose: process.env.DEBUG != null
    }

    /*
     *   preferredRelays: string[]
     relayLookupWindowBlocks: number
     methodSuffix: string
     jsonStringifyRequest: boolean
     relayTimeoutGrace: number
     gtxdatanonzero: number
     sliceSize: number
     verbose: boolean
     gasPriceFactorPercent: number
     minGasPrice: number
     maxRelayNonceGap: number
     relayHubAddress: Address
     stakeManagerAddress: Address
     paymasterAddress: Address
     chainId: number
     */

    const config = configureGSN(relayClientConfig)
    relayClient = new RelayClient(new Web3.providers.HttpProvider(ethereumNodeUrl), config)

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
    await clearStorage()
  })

  after(async function () {
    await revert(globalId)
  })

  const clearStorage = async function (): Promise<void> {
    await relayServer?.txStoreManager.clearAll()
    assert.deepEqual([], await relayServer.txStoreManager.getAll())
  }
  before(clearStorage)
  after(clearStorage)

  async function assertTransactionRelayed (txhash: PrefixedHexString, gasLess: Address): Promise<TransactionReceipt> {
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

  function assertRelayAdded (receipt: TransactionReceipt, relayServer: RelayServer): void {
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(relayServer._parseEvent)
    assert.equal(decodedLogs.length, 1)
    assert.equal(decodedLogs[0].name, 'RelayServerRegistered')
    assert.equal(decodedLogs[0].args.relayManager.toLowerCase(), relayServer.getManagerAddress().toLowerCase())
    assert.equal(decodedLogs[0].args.baseRelayFee, relayServer.baseRelayFee)
    assert.equal(decodedLogs[0].args.pctRelayFee, relayServer.pctRelayFee)
    assert.equal(decodedLogs[0].args.relayUrl, relayServer.url)
  }

  async function relayTransaction (options: any, badArgs?: any): Promise<PrefixedHexString> {
    const { relayRequest, relayMaxNonce, approvalData, signature } = await prepareRelayRequest({ ...options, ...badArgs })
    return relayTransactionFromRequest(badArgs, { relayRequest, relayMaxNonce, approvalData, signature })
  }

  async function relayTransactionFromRequest (badArgs: any, { relayRequest, relayMaxNonce, approvalData, signature }: any): Promise<PrefixedHexString> {
    // console.log('relayRequest is', relayRequest, signature, approvalData)
    // console.log('badArgs is', badArgs)
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
        forwarder: relayRequest.relayData.forwarder,
        ...badArgs
      })
    const txhash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(removeHexPrefix(signedTx), 'hex')))
    await assertTransactionRelayed(txhash, relayRequest.relayData.senderAddress)
    return signedTx
  }

  async function prepareRelayRequest (options: any): Promise<{ relayRequest: RelayRequest, relayMaxNonce: number, approvalData: PrefixedHexString, signature: PrefixedHexString, httpRequest: TmpRelayTransactionJsonRequest }> {
    const pingResponse = {
      // Ready,
      // MinGasPrice: await _web3.eth.getGasPrice(),
      RelayHubAddress: rhub.address,
      RelayServerAddress: relayServer.getAddress(1)
      // RelayManagerAddress,
      // Version
    }
    const eventInfo = {
      baseRelayFee: '0',
      pctRelayFee: '0'
      // relayManager: ,
      // relayUrl
    }
    const relayInfo: RelayInfo = {
      pingResponse: pingResponse as PingResponse,
      relayInfo: eventInfo as RelayRegisteredEventInfo
    }
    const gsnTransactionDetails: GsnTransactionDetails = {
      paymaster: options.paymaster,
      data: encodedFunction,
      forwarder: forwarder.address,
      from: options.from,
      gas: toHex(1e6),
      gasPrice: toHex(await _web3.eth.getGasPrice()),
      to: options.to
    }
    const { relayRequest, relayMaxNonce, approvalData, signature, httpRequest } = await relayClient._prepareRelayHttpRequest(relayInfo,
      gsnTransactionDetails)
    // const { relayRequest, relayMaxNonce, approvalData, signature } = await relayClient._prepareRelayHttpRequest(
    //   encodedFunction,
    //   /* relayWorker: */relayServer.getAddress(1),
    //   /* pctRelayFee: */0,
    //   /* baseRelayFee: */0,
    //   /* gasPrice: */parseInt(await _web3.eth.getGasPrice()),
    //   /* gasLimit: */1000000,
    //   /* senderNonce: */(await forwarder.getNonce(options.from)).toString(),
    //   /* paymaster: */paymaster.address,
    //   /* relayHub: */rhub.contract,
    //   forwarder.contract,
    //   options)
    return { relayRequest, relayMaxNonce, approvalData, signature, httpRequest }
  }

  // When running server before staking/funding it, or when balance gets too low
  describe('multi-step server initialization ', function () {
    it('should initialize relay params (chainId, networkId, gasPrice)', async function () {
      const expectedGasPrice = parseInt(await _web3.eth.getGasPrice()) * relayServer.gasPriceFactor
      const chainId = await _web3.eth.getChainId()
      const networkId = await _web3.eth.net.getId()
      assert.notEqual(relayServer.gasPrice, expectedGasPrice)
      assert.notEqual(relayServer.chainId, chainId)
      assert.notEqual(relayServer.networkId, networkId)
      assert.equal(relayServer.ready, false)
      const header = await _web3.eth.getBlock('latest')
      await expect(relayServer._worker(header))
        .to.be.eventually.rejectedWith('Server\'s balance too low')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
    })

    it('should wait for balance', async function () {
      let header = await _web3.eth.getBlock('latest')
      await expect(
        relayServer._worker(header)
      ).to.be.eventually.rejectedWith('Server\'s balance too low')
      const expectedBalance = _web3.utils.toWei('2', 'ether')
      assert.notEqual((await relayServer.getManagerBalance()).cmp(toBN(expectedBalance)), 0)
      await _web3.eth.sendTransaction({
        to: relayServer.getManagerAddress(),
        from: relayOwner,
        value: expectedBalance
      })
      header = await _web3.eth.getBlock('latest')
      await expect(
        relayServer._worker(header)
      ).to.be.eventually.rejectedWith('Waiting for stake')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
      assert.equal((await relayServer.getManagerBalance()).cmp(toBN(expectedBalance)), 0)
    })

    it('should wait for stake and then register', async function () {
      assert.equal(relayServer.lastScannedBlock, 0)
      let header = await _web3.eth.getBlock('latest')
      await expect(
        relayServer._worker(header)
      ).to.be.eventually.rejectedWith('Waiting for stake')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
      const res = await stakeManager.stakeForAddress(relayServer.getManagerAddress(), weekInSec, {
        from: relayOwner,
        value: oneEther
      })
      const res2 = await stakeManager.authorizeHub(relayServer.getManagerAddress(), rhub.address, { from: relayOwner })
      assert.ok(res.receipt.status, 'stake failed')
      assert.ok(res2.receipt.status, 'authorize hub failed')
      header = await _web3.eth.getBlock('latest')
      const receipt = await relayServer._worker(header)
      assert.equal(relayServer.lastError, null)
      assert.equal(relayServer.lastScannedBlock, header.number)
      assert.deepEqual(relayServer.stake, oneEther)
      assert.equal(relayServer.owner, relayOwner)
      assert.equal(relayServer.ready, true, 'relay not ready?')
      await assertRelayAdded(receipt as TransactionReceipt, relayServer)
    })

    it('should start again after restarting process', async () => {
      const newKeyManager = new KeyManager(2, workdir)
      const txStoreManager = new TxStoreManager({ workdir })
      const params = {
        txStoreManager,
        keyManager: newKeyManager,
        hubAddress: rhub.address,
        url: localhostOne,
        baseRelayFee: 0,
        pctRelayFee: 0,
        gasPriceFactor: 1,
        web3provider: serverWeb3provider,
        devMode: true
      }
      const newRelayServer = new RelayServer(params as RelayServerParams)
      await newRelayServer._worker(await _web3.eth.getBlock('latest'))
      assert.equal(relayServer.ready, true, 'relay not ready?')
    })
  })

  // When running server after both staking & funding it
  describe('single step server initialization', function () {
    it('should initialize relay after staking and funding it', async function () {
      const keyManager = new KeyManager(2, undefined, Date.now().toString())
      const txStoreManager = new TxStoreManager({ workdir: workdir + '/defunct' })
      const params = {
        txStoreManager,
        keyManager,
        // owner: relayOwner,
        hubAddress: rhub.address,
        url: localhostOne,
        baseRelayFee: 0,
        pctRelayFee: 0,
        gasPriceFactor: 1,
        web3provider: serverWeb3provider,
        devMode: true
      }
      defunctRelayServer = new RelayServer(params as RelayServerParams)
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
      assert.deepEqual(stake, oneEther)
      assert.equal(defunctRelayServer.owner, relayOwner, 'owner should be set after refreshing stake')

      const expectedGasPrice = parseInt(await _web3.eth.getGasPrice()) * defunctRelayServer.gasPriceFactor
      assert.equal(defunctRelayServer.ready, false)
      const expectedLastScannedBlock = await _web3.eth.getBlockNumber()
      assert.equal(defunctRelayServer.lastScannedBlock, 0)
      const receipt = await defunctRelayServer._worker(await _web3.eth.getBlock('latest'))
      assert.equal(defunctRelayServer.lastScannedBlock, expectedLastScannedBlock)
      assert.equal(defunctRelayServer.gasPrice, expectedGasPrice)
      assert.equal(defunctRelayServer.ready, true, 'relay no ready?')
      await assertRelayAdded(receipt as TransactionReceipt, defunctRelayServer)
    })
    after('txstore cleanup', async function () {
      await defunctRelayServer.txStoreManager.clearAll()
      assert.deepEqual([], await defunctRelayServer.txStoreManager.getAll())
    })
  })

  // TODO: most of this tests have literally nothing to do with Relay Server and actually double-check the client code.
  describe('relay transaction flows', function () {
    it('should relay transaction', async function () {
      await relayTransaction(options)
    })
    it('should fail to relay with undefined encodedFunction', async function () {
      try {
        await relayTransaction(options, { encodedFunction: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })
    it('should fail to relay with undefined approvalData', async function () {
      try {
        await relayTransaction(options, { approvalData: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })
    it('should fail to relay with undefined signature', async function () {
      try {
        await relayTransaction(options, { signature: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
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

    // this test does not check what it declares to. nonce mismatch is accidental.
    it.skip('should fail to relay with wrong from', async function () {
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
        assert.include(e.message, 'Cannot create instance of IRelayRecipient; no code at address')
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
      id = (await snapshot()).result
      try {
        await paymaster.withdrawAll(accounts[0])
        await relayTransaction(options)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster balance too low')
      } finally {
        await revert(id)
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
        await relayTransaction(options, { senderNonce: '123456' })
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

  describe('resend unconfirmed transactions task', function () {
    it('should resend unconfirmed transaction', async function () {
      // First clear db
      await relayServer.txStoreManager.clearAll()
      assert.deepEqual([], await relayServer.txStoreManager.getAll())
      // Send a transaction via the relay, but then revert to a previous snapshot
      id = (await snapshot()).result
      const signedTx = await relayTransaction(options)
      let parsedTxHash = ethUtils.bufferToHex((new Transaction(signedTx, relayServer.rawTxOptions)).hash())
      const receiptBefore = await _web3.eth.getTransactionReceipt(parsedTxHash)
      const minedTxBefore = await _web3.eth.getTransaction(parsedTxHash)
      assert.equal(parsedTxHash, receiptBefore.transactionHash)
      await revert(id)
      // Ensure tx is removed by the revert
      const receiptAfter = await _web3.eth.getTransactionReceipt(parsedTxHash)
      assert.equal(null, receiptAfter)
      // Should not do anything, as not enough time has passed
      let sortedTxs = await relayServer.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      let resentTx = await relayServer._resendUnconfirmedTransactions(await _web3.eth.getBlock('latest'))
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      // Increase time by hooking Date.now()
      // @ts-ignore
      // @ts-ignore
      try {
        const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
        // @ts-ignore
        Date.origNow = Date.now
        Date.now = function () {
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
          return Date.origNow() + pendingTransactionTimeout
        }
        // Resend tx, now should be ok
        resentTx = await relayServer._resendUnconfirmedTransactions(await _web3.eth.getBlock('latest'))
        parsedTxHash = ethUtils.bufferToHex((new Transaction(resentTx, relayServer.rawTxOptions)).hash())

        // Validate relayed tx with increased gasPrice
        const minedTxAfter = await _web3.eth.getTransaction(parsedTxHash)
        // BN.muln() does not support floats so to mul by 1.2, we have to mul by 12 and div by 10 to keep precision
        assert.equal(toBN(minedTxAfter.gasPrice).toString(), toBN(minedTxBefore.gasPrice).muln(12).divn(10).toString())
        await assertTransactionRelayed(parsedTxHash, gasLess)
      } finally {
        // Release hook
        // @ts-ignore
        Date.now = Date.origNow
      }
      // Check the tx is removed from the store only after enough blocks
      resentTx = await relayServer._resendUnconfirmedTransactions(await _web3.eth.getBlock('latest'))
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.txStoreManager.getAll()
      assert.equal(sortedTxs[0].txId, parsedTxHash)
      const confirmationsNeeded = 12
      await evmMineMany(confirmationsNeeded)
      resentTx = await relayServer._resendUnconfirmedTransactions(await _web3.eth.getBlock('latest'))
      assert.equal(null, resentTx)
      sortedTxs = await relayServer.txStoreManager.getAll()
      assert.deepEqual([], sortedTxs)

      // Revert for following tests
      await revert(id)
    })

    it('should resend multiple unconfirmed transactions', async function () {
      // First clear db
      await relayServer.txStoreManager.clearAll()
      assert.deepEqual([], await relayServer.txStoreManager.getAll())
      // Send 3 transactions, separated by 1 min each, and revert the last 2
      const signedTx1 = await relayTransaction(options)
      id = (await snapshot()).result
      // Increase time by hooking Date
      let constructorIncrease = 2 * 60 * 1000 // 1 minute in milliseconds
      let nowIncrease = 0
      const origDate = Date
      try {
        const NewDate = class extends Date {
          constructor () {
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            super(Date.origNow() + constructorIncrease)
          }

          static now (): number {
            return super.now() + nowIncrease
          }

          static origNow (): number {
            return super.now()
          }
        }
        // @ts-ignore
        Date = NewDate // eslint-disable-line no-global-assign
        await relayTransaction(options)
        constructorIncrease = 4 * 60 * 1000 // 4 minutes in milliseconds
        const signedTx3 = await relayTransaction(options)
        await revert(id)
        const nonceBefore = await _web3.eth.getTransactionCount(relayServer.getManagerAddress())
        // Check tx1 still went fine after revert
        const parsedTxHash1 = ethUtils.bufferToHex((new Transaction(signedTx1, relayServer.rawTxOptions)).hash())
        await assertTransactionRelayed(parsedTxHash1, gasLess)
        // After 10 minutes, tx2 is not resent because tx1 is still unconfirmed
        nowIncrease = 10 * 60 * 1000 // 10 minutes in milliseconds
        constructorIncrease = 0
        let sortedTxs = await relayServer.txStoreManager.getAll()
        // console.log('times:', sortedTxs[0].createdAt, sortedTxs[1].createdAt, sortedTxs[2].createdAt )
        assert.equal(sortedTxs[0].txId, parsedTxHash1)
        let resentTx = await relayServer._resendUnconfirmedTransactions(await _web3.eth.getBlock('latest'))
        assert.equal(null, resentTx)
        assert.equal(nonceBefore, await _web3.eth.getTransactionCount(relayServer.getManagerAddress()))
        sortedTxs = await relayServer.txStoreManager.getAll()
        // console.log('sortedTxs?', sortedTxs)
        assert.equal(sortedTxs[0].txId, parsedTxHash1)
        // Mine a bunch of blocks, so tx1 is confirmed and tx2 is resent
        const confirmationsNeeded = 12
        await evmMineMany(confirmationsNeeded)
        const resentTx2 = await relayServer._resendUnconfirmedTransactions(await _web3.eth.getBlock('latest'))
        const parsedTxHash2 = ethUtils.bufferToHex((new Transaction(resentTx2, relayServer.rawTxOptions)).hash())
        await assertTransactionRelayed(parsedTxHash2, gasLess)
        // Re-inject tx3 into the chain as if it were mined once tx2 goes through
        await _web3.eth.sendSignedTransaction(signedTx3)
        const parsedTxHash3 = ethUtils.bufferToHex((new Transaction(signedTx3, relayServer.rawTxOptions)).hash())
        await assertTransactionRelayed(parsedTxHash3, gasLess)
        // Check that tx3 does not get resent, even after time passes or blocks get mined, and that store is empty
        nowIncrease = 60 * 60 * 1000 // 60 minutes in milliseconds
        await evmMineMany(confirmationsNeeded)
        resentTx = await relayServer._resendUnconfirmedTransactions(await _web3.eth.getBlock('latest'))
        assert.equal(null, resentTx)
        assert.deepEqual([], await relayServer.txStoreManager.getAll())
      } finally {
        // Release hook
        Date = origDate // eslint-disable-line no-global-assign
      }
    })
  })

  describe('nonce sense', function () {
    let _pollNonceOrig: (signerIndex: number) => Promise<number>
    let nonceMutexOrig: Mutex
    let signTransactionOrig: (signer: string, tx: Transaction) => PrefixedHexString
    before(function () {
      _pollNonceOrig = relayServer._pollNonce
      relayServer._pollNonce = async function (signerIndex) {
        const signer = this.getAddress(signerIndex)
        // @ts-ignore
        const nonce = await this.contractInteractor.getTransactionCount(signer, 'pending')
        return nonce
      }
    })
    after(function () {
      relayServer._pollNonce = _pollNonceOrig
    })
    it('should fail if nonce is not mutexed', async function () {
      nonceMutexOrig = relayServer.nonceMutex
      relayServer.nonceMutex = {
        // @ts-ignore
        acquire: function () {
          // eslint-disable-next-line @typescript-eslint/no-empty-function
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
        relayServer.nonces[1]--
      } finally {
        relayServer.nonceMutex = nonceMutexOrig
      }
    })
    it('should handle nonce atomically', async function () {
      const promises = [relayTransaction(options), relayTransaction(options2)]
      await Promise.all(promises)
    })
    it('should not deadlock if server returned error while locked', async function () {
      try {
        signTransactionOrig = relayServer.keyManager.signTransaction
        relayServer.keyManager.signTransaction = function () {
          throw new Error('no tx for you')
        }
        try {
          await relayTransaction(options)
        } catch (e) {
          assert.include(e.message, 'no tx for you')
          assert.isFalse(relayServer.nonceMutex.isLocked(), 'nonce mutex not released after exception')
        }
      } finally {
        relayServer.keyManager.signTransaction = signTransactionOrig
      }
    })
  })

  describe('listener task', function () {
    let origWorker: (blockHeader: BlockHeader) => Promise<TransactionReceipt | void>
    let started: boolean
    beforeEach(function () {
      origWorker = relayServer._worker
      started = false
      relayServer._worker = async function () {
        await Promise.resolve()
        started = true
        this.emit('error', new Error('GOTCHA'))
      }
    })
    afterEach(function () {
      relayServer._worker = origWorker
    })
    it('should start block listener', async function () {
      relayServer.start()
      await evmMine()
      await sleep(200)
      assert.isTrue(started, 'could not start task correctly')
    })
    it('should stop block listener', async function () {
      relayServer.stop()
      await evmMine()
      await sleep(200)
      assert.isFalse(started, 'could not stop task correctly')
    })
  })

  describe('event handlers', function () {
    it('should handle Unstaked event - send balance to owner', async function () {
      const relayBalanceBefore = await relayServer.getManagerBalance()
      assert.isTrue(relayBalanceBefore.gtn(0))
      await increaseTime(weekInSec)
      await stakeManager.unlockStake(relayServer.getManagerAddress(), { from: relayOwner })
      await relayServer._worker(await _web3.eth.getBlock('latest'))
      const relayBalanceAfter = await relayServer.getManagerBalance()
      assert.equal(relayBalanceAfter.toNumber(), 0, `relayBalanceAfter is not zero: ${relayBalanceAfter.toString()}`)
    })

    it('_handleHubAuthorizedEvent')

    it('_handleStakedEvent')
    // TODO add failure tests
  })

  // describe('network errors')
  //
  describe('Function testing', function () {
    it('_workerSemaphore', async function () {
      // @ts-ignore
      assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false first')
      const workerOrig = relayServer._worker
      let shouldRun = true
      try {
        relayServer._worker = async function (blockHeader: BlockHeader): Promise<TransactionReceipt | void> {
          // eslint-disable-next-line no-unmodified-loop-condition
          while (shouldRun) {
            await sleep(200)
          }
        }
        relayServer._workerSemaphore(await _web3.eth.getBlock('latest'))
        // @ts-ignore
        assert.isTrue(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be true after')
        shouldRun = false
        await sleep(200)
        // @ts-ignore
        assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false after')
      } finally {
        relayServer._worker = workerOrig
      }
    })
    // it('_init', async function () {
    // })
    // it('replenishWorker', async function () {
    // })
    // it('_worker', async function () {
    // })
    // it('getManagerBalance', async function () {
    // })
    // it('refreshStake', async function () {
    // })
    // it('_handleHubAuthorizedEvent', async function () {
    // })
    // it('_handleStakedEvent', async function () {
    // })
    // it('_registerIfNeeded', async function () {
    // })
    // it('_resendUnconfirmedTransactions', async function () {
    // })
    // it('_resendUnconfirmedTransactionsForSigner', async function () {
    // })
    // it('_sendTransaction', async function () {
    // })
    // it('_resendTransaction', async function () {
    // })
    // it('_pollNonce', async function () {
    // })
    // it('_parseEvent', async function () {
    // })
  })
})
