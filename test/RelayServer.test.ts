/* global artifacts describe */
import Web3 from 'web3'
import crypto from 'crypto'
import { RelayClient } from '../src/relayclient/RelayClient'
import { CreateTransactionDetails, RelayServer, RelayServerParams } from '../src/relayserver/RelayServer'
import { TxStoreManager } from '../src/relayserver/TxStoreManager'
import { KeyManager } from '../src/relayserver/KeyManager'
import RelayHubABI from '../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../src/common/interfaces/IStakeManager.json'
import PayMasterABI from '../src/common/interfaces/IPaymaster.json'
import { defaultEnvironment } from '../src/common/Environments'
import * as ethUtils from 'ethereumjs-util'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
// @ts-ignore
import abiDecoder from 'abi-decoder'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import { deployHub, evmMine, evmMineMany, revert, sleep, snapshot } from './TestUtils'
import { removeHexPrefix } from '../src/common/Utils'
import {
  ForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance
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
import { GsnRequestType } from '../src/common/EIP712/TypedRequestData'
import ContractInteractor from '../src/relayclient/ContractInteractor'

const TestRecipient = artifacts.require('TestRecipient')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

const { expect } = require('chai').use(chaiAsPromised).use(sinonChai)

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)

const localhostOne = 'http://localhost:8090'
const workdir = '/tmp/gsn/test/relayserver'
const managerWorkdir = workdir + '/manager'
const workersWorkdir = workdir + '/workers'

contract('RelayServer', function (accounts) {
  const pctRelayFee = 11
  const baseRelayFee = 12
  const workerIndex = 0
  let rhub: RelayHubInstance
  let forwarder: ForwarderInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let sr: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let gasLess: Address, gasLess2: Address
  const relayOwner = accounts[1]
  const dayInSec = 24 * 60 * 60
  const weekInSec = dayInSec * 7
  const oneEther = toBN(1e18)

  const paymasterData = '0x'
  const clientId = '0'
  let relayServer: RelayServer
  let ethereumNodeUrl: string
  let _web3: Web3
  let id: string, globalId: string
  let encodedFunction: PrefixedHexString
  let relayClient: RelayClient
  let options: any, options2: any
  let managerKeyManager, workersKeyManager: KeyManager

  async function bringUpNewRelay (): Promise<RelayServer> {
    const managerKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
    const workersKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
    assert.equal(await _web3.eth.getBalance(managerKeyManager.getAddress(0)), '0')
    assert.equal(await _web3.eth.getBalance(workersKeyManager.getAddress(0)), '0')
    const txStoreManager = new TxStoreManager({ workdir: workdir + '/defunct' + Date.now().toString() })
    const serverWeb3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
    const interactor = new ContractInteractor(serverWeb3provider,
      configureGSN({}))
    const params = {
      txStoreManager,
      managerKeyManager,
      workersKeyManager,
      hubAddress: rhub.address,
      url: localhostOne,
      baseRelayFee: 0,
      pctRelayFee: 0,
      gasPriceFactor: 1,
      contractInteractor: interactor,
      devMode: true
    }
    const newServer = new RelayServer(params as RelayServerParams)
    newServer.on('error', (e) => {
      console.log('newServer event', e.message)
    })
    await _web3.eth.sendTransaction({
      to: newServer.getManagerAddress(),
      from: relayOwner,
      value: _web3.utils.toWei('2', 'ether')
    })

    const stakeForAddressReceipt = await stakeManager.stakeForAddress(newServer.getManagerAddress(), weekInSec, {
      from: relayOwner,
      value: oneEther
    })
    assert.equal(stakeForAddressReceipt.logs[0].event, 'StakeAdded')
    const authorizeHubReceipt = await stakeManager.authorizeHubByOwner(newServer.getManagerAddress(), rhub.address, {
      from: relayOwner
    })
    assert.equal(authorizeHubReceipt.logs[0].event, 'HubAuthorized')
    return newServer
  }

  function getTotalTxCosts (receipts: TransactionReceipt[], gasPrice: string): ethUtils.BN {
    return receipts.map(r => toBN(r.gasUsed).mul(toBN(gasPrice))).reduce(
      (previous, current) => previous.add(current), toBN(0))
  }

  before(async function () {
    globalId = (await snapshot()).result
    ethereumNodeUrl = (web3.currentProvider as HttpProvider).host
    const serverWeb3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
    _web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))

    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    rhub = await deployHub(stakeManager.address, penalizer.address)
    forwarder = await Forwarder.new()
    const forwarderAddress = forwarder.address
    sr = await TestRecipient.new(forwarderAddress)
    paymaster = await TestPaymasterEverythingAccepted.new()
    // register hub's RelayRequest with forwarder, if not already done.
    await forwarder.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    )

    await paymaster.setTrustedForwarder(forwarderAddress)
    await paymaster.setRelayHub(rhub.address)
    await paymaster.deposit({ value: _web3.utils.toWei('1', 'ether') })
    gasLess = await _web3.eth.personal.newAccount('password')
    gasLess2 = await _web3.eth.personal.newAccount('password2')
    managerKeyManager = new KeyManager(1, managerWorkdir)
    workersKeyManager = new KeyManager(1, workersWorkdir)
    const txStoreManager = new TxStoreManager({ workdir })
    const interactor = new ContractInteractor(serverWeb3provider,
      configureGSN({}))
    const params = {
      txStoreManager,
      managerKeyManager,
      workersKeyManager,
      hubAddress: rhub.address,
      url: localhostOne,
      baseRelayFee: baseRelayFee,
      pctRelayFee: pctRelayFee,
      gasPriceFactor: 1,
      contractInteractor: interactor,
      trustedPaymasters: [paymaster.address],
      devMode: true
    }
    relayServer = new RelayServer(params as RelayServerParams)
    assert.deepEqual(relayServer.trustedPaymasters, [paymaster.address.toLowerCase()], 'trusted paymaster not initialized correctly')
    relayServer.on('error', (e) => {
      console.log('error event', e.message)
    })
    console.log('Relay Manager=', relayServer.getManagerAddress(), 'Worker=', relayServer.getWorkerAddress(workerIndex))

    encodedFunction = sr.contract.methods.emitMessage('hello world').encodeABI()
    const relayClientConfig = {
      preferredRelays: [localhostOne],
      maxRelayNonceGap: 0,
      verbose: process.env.DEBUG != null
    }

    const config = configureGSN(relayClientConfig)
    relayClient = new RelayClient(new Web3.providers.HttpProvider(ethereumNodeUrl), config)

    options = {
      // approveFunction: approveFunction,
      from: gasLess,
      to: sr.address,
      pctRelayFee: pctRelayFee,
      gas_limit: 1000000,
      paymaster: paymaster.address,
      paymasterData,
      clientId
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

  async function assertTransactionRelayed (server: RelayServer, txhash: PrefixedHexString, gasLess: Address): Promise<TransactionReceipt> {
    const receipt = await _web3.eth.getTransactionReceipt(txhash)
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(server._parseEvent)
    const event1 = decodedLogs.find((e: { name: string }) => e.name === 'SampleRecipientEmitted')
    assert.equal(event1.args.message, 'hello world')
    const event2 = decodedLogs.find((e: { name: string }) => e.name === 'TransactionRelayed')
    assert.equal(event2.name, 'TransactionRelayed')
    assert.equal(event2.args.relayWorker.toLowerCase(), server.getWorkerAddress(workerIndex).toLowerCase())
    assert.equal(event2.args.from.toLowerCase(), gasLess.toLowerCase())
    assert.equal(event2.args.to.toLowerCase(), sr.address.toLowerCase())
    assert.equal(event2.args.paymaster.toLowerCase(), paymaster.address.toLowerCase())
    return receipt
  }

  function assertRelayAdded (receipts: TransactionReceipt[], server: RelayServer, checkWorkers = true): void {
    const registeredReceipt = receipts.find(r => {
      const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server._parseEvent)
      return decodedLogs[0].name === 'RelayServerRegistered'
    })
    const registeredLogs = abiDecoder.decodeLogs(registeredReceipt!.logs).map(server._parseEvent)
    assert.equal(registeredLogs.length, 1)
    assert.equal(registeredLogs[0].name, 'RelayServerRegistered')
    assert.equal(registeredLogs[0].args.relayManager.toLowerCase(), server.getManagerAddress().toLowerCase())
    assert.equal(registeredLogs[0].args.baseRelayFee, server.baseRelayFee)
    assert.equal(registeredLogs[0].args.pctRelayFee, server.pctRelayFee)
    assert.equal(registeredLogs[0].args.relayUrl, server.url)

    if (checkWorkers) {
      const workersAddedReceipt = receipts.find(r => {
        const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server._parseEvent)
        return decodedLogs[0].name === 'RelayWorkersAdded'
      })
      const workersAddedLogs = abiDecoder.decodeLogs(workersAddedReceipt!.logs).map(server._parseEvent)
      assert.equal(workersAddedLogs.length, 1)
      assert.equal(workersAddedLogs[0].name, 'RelayWorkersAdded')
    }
  }

  async function relayTransaction (server: RelayServer, options: any, overrideArgs?: Partial<CreateTransactionDetails>): Promise<PrefixedHexString> {
    const { relayRequest, relayMaxNonce, approvalData, signature, httpRequest } = await prepareRelayRequest(server,
      { ...options, ...overrideArgs })
    return await relayTransactionFromRequest(server, overrideArgs ?? {},
      { relayRequest, relayMaxNonce, approvalData, signature, httpRequest })
  }

  async function relayTransactionFromRequest (server: RelayServer, overrideArgs: Partial<CreateTransactionDetails>, { relayRequest, relayMaxNonce, approvalData, signature, httpRequest }: { relayRequest: RelayRequest, relayMaxNonce: number, approvalData: PrefixedHexString, signature: PrefixedHexString, httpRequest: TmpRelayTransactionJsonRequest }): Promise<PrefixedHexString> {
    // console.log('relayRequest is', relayRequest, signature, approvalData)
    // console.log('overrideArgs is', overrideArgs)
    const signedTx = await server.createRelayTransaction(
      {
        relayWorker: httpRequest.relayWorker,
        senderNonce: relayRequest.request.nonce,
        gasPrice: relayRequest.relayData.gasPrice,
        data: relayRequest.request.data,
        approvalData,
        signature,
        from: relayRequest.request.from,
        to: relayRequest.request.to,
        value: '0',
        paymaster: relayRequest.relayData.paymaster,
        paymasterData: relayRequest.relayData.paymasterData,
        clientId: relayRequest.relayData.clientId,
        gasLimit: relayRequest.request.gas,
        relayMaxNonce,
        baseRelayFee: relayRequest.relayData.baseRelayFee,
        pctRelayFee: relayRequest.relayData.pctRelayFee,
        relayHubAddress: rhub.address,
        forwarder: relayRequest.relayData.forwarder,
        ...overrideArgs
      })
    const txhash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(removeHexPrefix(signedTx), 'hex')))
    await assertTransactionRelayed(server, txhash, relayRequest.request.from)
    return signedTx
  }

  async function prepareRelayRequest (server: RelayServer, options: any): Promise<{ relayRequest: RelayRequest, relayMaxNonce: number, approvalData: PrefixedHexString, signature: PrefixedHexString, httpRequest: TmpRelayTransactionJsonRequest }> {
    const pingResponse = {
      // Ready,
      // MinGasPrice: await _web3.eth.getGasPrice(),
      RelayHubAddress: rhub.address,
      RelayServerAddress: server.getWorkerAddress(0)
      // RelayManagerAddress,
      // Version
    }
    const eventInfo = {
      baseRelayFee: (options.baseRelayFee ?? baseRelayFee).toString(),
      pctRelayFee: (options.pctRelayFee ?? pctRelayFee).toString()
      // relayManager: ,
      // relayUrl
    }
    const relayInfo: RelayInfo = {
      pingResponse: pingResponse as PingResponse,
      relayInfo: eventInfo as RelayRegisteredEventInfo
    }
    const gsnTransactionDetails: GsnTransactionDetails = {
      paymaster: options.paymaster,
      paymasterData,
      clientId,
      data: encodedFunction,
      forwarder: forwarder.address,
      from: options.from,
      gas: toHex(1e6),
      gasPrice: toHex(await _web3.eth.getGasPrice()),
      to: options.to
    }
    const { relayRequest, relayMaxNonce, approvalData, signature, httpRequest } = await relayClient._prepareRelayHttpRequest(relayInfo,
      gsnTransactionDetails)
    return { relayRequest, relayMaxNonce, approvalData, signature, httpRequest }
  }

  // When running server before staking/funding it, or when balance gets too low
  describe('multi-step server initialization', function () {
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
      assert.equal(relayServer.gasPrice, expectedGasPrice)
      assert.equal(relayServer.chainId, chainId)
      assert.equal(relayServer.networkId, networkId)
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

    it('should wait for stake, register and fund workers', async function () {
      let header = await _web3.eth.getBlock('latest')
      await expect(
        relayServer._worker(header)
      ).to.be.eventually.rejectedWith('Waiting for stake')
      assert.equal(relayServer.ready, false, 'relay should not be ready yet')
      const res = await stakeManager.stakeForAddress(relayServer.getManagerAddress(), weekInSec, {
        from: relayOwner,
        value: oneEther
      })
      const res2 = await stakeManager.authorizeHubByOwner(relayServer.getManagerAddress(), rhub.address, { from: relayOwner })
      assert.ok(res.receipt.status, 'stake failed')
      assert.ok(res2.receipt.status, 'authorize hub failed')
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalanceBefore.toString(), '0')
      header = await _web3.eth.getBlock('latest')
      const receipts = await relayServer._worker(header)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(relayServer.lastError, null)
      assert.equal(relayServer.lastScannedBlock, header.number)
      assert.deepEqual(relayServer.stake, oneEther)
      assert.equal(relayServer.owner, relayOwner)
      assert.equal(workerBalanceAfter.toString(), relayServer.workerTargetBalance.toString())
      assert.equal(relayServer.ready, true, 'relay not ready?')
      await assertRelayAdded(receipts, relayServer)
    })

    it('should start again after restarting process', async () => {
      const managerKeyManager = new KeyManager(1, managerWorkdir)
      const workersKeyManager = new KeyManager(1, workersWorkdir)
      const txStoreManager = new TxStoreManager({ workdir })
      const serverWeb3provider = new Web3.providers.HttpProvider(ethereumNodeUrl)
      const interactor = new ContractInteractor(serverWeb3provider,
        configureGSN({}))
      const params = {
        txStoreManager,
        managerKeyManager,
        workersKeyManager,
        hubAddress: rhub.address,
        url: localhostOne,
        baseRelayFee: 0,
        pctRelayFee: 0,
        gasPriceFactor: 1,
        contractInteractor: interactor,
        devMode: true
      }
      const newRelayServer = new RelayServer(params as RelayServerParams)
      await newRelayServer._worker(await _web3.eth.getBlock('latest'))
      assert.equal(relayServer.ready, true, 'relay not ready?')
    })
  })

  // When running server after both staking & funding it
  describe('single step server initialization', function () {
    beforeEach(async function () {
      id = (await snapshot()).result
    })
    afterEach(async function () {
      await revert(id)
    })
    let newServer: RelayServer
    it('should initialize relay after staking and funding it', async function () {
      newServer = await bringUpNewRelay()
      const stake = await newServer.refreshStake()
      assert.deepEqual(stake, oneEther)
      assert.equal(newServer.owner, relayOwner, 'owner should be set after refreshing stake')

      const expectedGasPrice = parseInt(await _web3.eth.getGasPrice()) * newServer.gasPriceFactor
      assert.equal(newServer.ready, false)
      const expectedLastScannedBlock = await _web3.eth.getBlockNumber()
      assert.equal(newServer.lastScannedBlock, 0)
      const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalanceBefore.toString(), '0')
      const receipts = await newServer._worker(await _web3.eth.getBlock('latest'))
      assert.equal(newServer.lastScannedBlock, expectedLastScannedBlock)
      assert.equal(newServer.gasPrice, expectedGasPrice)
      assert.equal(newServer.ready, true, 'relay no ready?')
      const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
      assert.equal(newServer.lastError, null)
      assert.deepEqual(newServer.stake, oneEther)
      assert.equal(newServer.owner, relayOwner)
      assert.equal(workerBalanceAfter.toString(), newServer.workerTargetBalance.toString())
      await assertRelayAdded(receipts, newServer)
    })
    after('txstore cleanup', async function () {
      await newServer.txStoreManager.clearAll()
      assert.deepEqual([], await newServer.txStoreManager.getAll())
    })
  })

  describe.skip('server readiness state', function () {
    // todo
  })

  // TODO: most of this tests have literally nothing to do with Relay Server and actually double-check the client code.
  describe('relay transaction flows', function () {
    it('should relay transaction', async function () {
      await relayTransaction(relayServer, options)
    })
    it('should fail to relay with undefined data', async function () {
      try {
        await relayTransaction(relayServer, options, { data: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })
    it('should fail to relay with undefined approvalData', async function () {
      try {
        await relayTransaction(relayServer, options, { approvalData: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })
    it('should fail to relay with undefined signature', async function () {
      try {
        await relayTransaction(relayServer, options, { signature: undefined })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Expected argument to be of type `string` but received type `undefined`')
      }
    })
    it('should fail to relay with wrong signature', async function () {
      try {
        await relayTransaction(relayServer, options,
          { signature: '0xdeadface00000a58b757da7dea5678548be5ff9b16e9d1d87c6157aff6889c0f6a406289908add9ea6c3ef06d033a058de67d057e2c0ae5a02b36854be13b0731c' })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster rejected in server: signature mismatch')
      }
    })

    // this test does not check what it declares to. nonce mismatch is accidental.
    it.skip('should fail to relay with wrong from', async function () {
      try {
        await relayTransaction(relayServer, options, { from: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster rejected in server: nonce mismatch')
      }
    })

    it('should fail to relay with wrong relay worker', async function () {
      try {
        await relayTransaction(relayServer, options, { relayWorker: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, `Wrong worker address: ${accounts[1]}`)
      }
    })

    it('should fail to relay with wrong recipient', async function () {
      try {
        await relayTransaction(relayServer, options, { to: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Paymaster rejected in server: isTrustedForwarder returned invalid response')
      }
    })
    it('should fail to relay with invalid paymaster', async function () {
      try {
        await relayTransaction(relayServer, options, { paymaster: accounts[1] })
        assert.fail()
      } catch (e) {
        assert.include(e.message, `non-existent or incompatible paymaster contract: ${accounts[1]}`)
      }
    })
    it('should fail to relay when paymaster\'s balance too low', async function () {
      id = (await snapshot()).result
      try {
        await paymaster.withdrawAll(accounts[0])
        await relayTransaction(relayServer, options)
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
        await relayTransaction(relayServer, options)
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'gasPrice not initialized')
      } finally {
        relayServer.gasPrice = gasPrice
      }
    })
    it('should fail to relay with unacceptable gasPrice', async function () {
      try {
        await relayTransaction(relayServer, options, { gasPrice: 1e2.toString() })
        assert.fail()
      } catch (e) {
        assert.include(e.message,
          `Unacceptable gasPrice: relayServer's gasPrice:${relayServer.gasPrice} request's gasPrice: 100`)
      }
    })
    it('should fail to relay with wrong senderNonce', async function () {
      // @ts-ignore
      const contractInteractor = relayServer.contractInteractor
      const saveGetSenderNonce = contractInteractor.getSenderNonce
      try {
        contractInteractor.getSenderNonce = async () => await Promise.resolve('1234')
        const { relayRequest, relayMaxNonce, approvalData, signature, httpRequest } = await prepareRelayRequest(relayServer, options)
        await relayTransactionFromRequest(relayServer, {}, { relayRequest, relayMaxNonce, approvalData, signature, httpRequest })
        try {
          await relayTransactionFromRequest(relayServer, {},
            { relayRequest, relayMaxNonce: relayMaxNonce + 1, approvalData, signature, httpRequest })
          assert.fail()
        } catch (e) {
          assert.include(e.message, 'Paymaster rejected in server: nonce mismatch')
        }
      } finally {
        contractInteractor.getSenderNonce = saveGetSenderNonce
      }
    })
    it('should fail to relay with wrong relayMaxNonce', async function () {
      try {
        await relayTransaction(relayServer, options, { relayMaxNonce: 0 })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable relayMaxNonce:')
      }
    })
    it('should fail to relay with wrong baseRelayFee', async function () {
      const trustedPaymaster = relayServer.trustedPaymasters.pop()
      try {
        await relayTransaction(relayServer, options, { baseRelayFee: (relayServer.baseRelayFee - 1).toString() })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable baseRelayFee:')
      } finally {
        relayServer.trustedPaymasters.push(trustedPaymaster!)
      }
    })
    it('should fail to relay with wrong pctRelayFee', async function () {
      const trustedPaymaster = relayServer.trustedPaymasters.pop()
      try {
        await relayTransaction(relayServer, options, { pctRelayFee: (relayServer.pctRelayFee - 1).toString() })
        assert.fail()
      } catch (e) {
        assert.include(e.message, 'Unacceptable pctRelayFee:')
      } finally {
        relayServer.trustedPaymasters.push(trustedPaymaster!)
      }
    })
    it('should  bypass fee checks if given trusted paymasters', async function () {
      await relayTransaction(relayServer, options, { baseRelayFee: (relayServer.baseRelayFee - 1).toString() })
    })
    it('should fail to relay with wrong hub address', async function () {
      try {
        await relayTransaction(relayServer, options, { relayHubAddress: '0xdeadface' })
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
      const signedTx = await relayTransaction(relayServer, options)
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
        await assertTransactionRelayed(relayServer, parsedTxHash, gasLess)
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
      const signedTx1 = await relayTransaction(relayServer, options)
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
        await relayTransaction(relayServer, options)
        constructorIncrease = 4 * 60 * 1000 // 4 minutes in milliseconds
        const signedTx3 = await relayTransaction(relayServer, options)
        await revert(id)
        const nonceBefore = await _web3.eth.getTransactionCount(relayServer.getManagerAddress())
        // Check tx1 still went fine after revert
        const parsedTxHash1 = ethUtils.bufferToHex((new Transaction(signedTx1, relayServer.rawTxOptions)).hash())
        await assertTransactionRelayed(relayServer, parsedTxHash1, gasLess)
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
        await assertTransactionRelayed(relayServer, parsedTxHash2, gasLess)
        // Re-inject tx3 into the chain as if it were mined once tx2 goes through
        await _web3.eth.sendSignedTransaction(signedTx3)
        const parsedTxHash3 = ethUtils.bufferToHex((new Transaction(signedTx3, relayServer.rawTxOptions)).hash())
        await assertTransactionRelayed(relayServer, parsedTxHash3, gasLess)
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
    let _pollNonceOrig: (signer: string) => Promise<number>
    let nonceMutexOrig: Mutex
    let signTransactionOrig: (signer: string, tx: Transaction) => PrefixedHexString
    before(function () {
      _pollNonceOrig = relayServer._pollNonce
      relayServer._pollNonce = async function (signer) {
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
        const promises = [relayTransaction(relayServer, options), relayTransaction(relayServer, options2)]
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
      const promises = [relayTransaction(relayServer, options), relayTransaction(relayServer, options2)]
      await Promise.all(promises)
    })
    it('should not deadlock if server returned error while locked', async function () {
      try {
        signTransactionOrig = relayServer.workersKeyManager.signTransaction
        relayServer.workersKeyManager.signTransaction = function () {
          throw new Error('no tx for you')
        }
        try {
          await relayTransaction(relayServer, options)
        } catch (e) {
          assert.include(e.message, 'no tx for you')
          assert.isFalse(relayServer.nonceMutex.isLocked(), 'nonce mutex not released after exception')
        }
      } finally {
        relayServer.workersKeyManager.signTransaction = signTransactionOrig
      }
    })
  })

  describe('relay workers rebalancing', function () {
    const gasPrice = 1e9
    let beforeDescribeId: string
    const txcost = toBN(defaultEnvironment.mintxgascost * gasPrice)
    before('deplete worker balance', async function () {
      beforeDescribeId = (await snapshot()).result
      await relayServer._sendTransaction({
        signer: relayServer.getWorkerAddress(workerIndex),
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost.toString(),
        gasPrice: gasPrice.toString(),
        value: toHex((await relayServer.getWorkerBalance(workerIndex)).sub(txcost))
      })
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.lt(toBN(relayServer.workerMinBalance)),
        'worker balance should be lower than min balance')
    })
    after(async function () {
      await revert(beforeDescribeId)
    })
    beforeEach(async function () {
      id = (await snapshot()).result
      await relayServer.txStoreManager.clearAll()
    })
    afterEach(async function () {
      await revert(id)
      await relayServer.txStoreManager.clearAll()
    })
    it('should fund from manager hub balance first when sufficient before using eth balance', async function () {
      await rhub.depositFor(relayServer.getManagerAddress(), { value: 1e18.toString() })
      const managerHubBalanceBefore = await rhub.balanceOf(relayServer.getManagerAddress())
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.gte(refill), 'manager hub balance should be sufficient to replenish worker')
      assert.isTrue(managerEthBalance.gte(refill), 'manager eth balance should be sufficient to replenish worker')
      await relayServer.replenishWorker(workerIndex)
      const managerHubBalanceAfter = await rhub.balanceOf(relayServer.getManagerAddress())
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(managerHubBalanceAfter.eq(managerHubBalanceBefore.sub(refill)),
        `managerHubBalanceAfter (${managerHubBalanceAfter.toString()}) != managerHubBalanceBefore (${managerHubBalanceBefore.toString()}) - refill (${refill.toString()}`)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
    })
    it('should fund from manager eth balance when sufficient and hub balance too low', async function () {
      const managerHubBalanceBefore = await rhub.balanceOf(relayServer.getManagerAddress())
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.gte(refill), 'manager eth balance should be sufficient to replenish worker')
      await relayServer.replenishWorker(workerIndex)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
    })
    it('should emit \'funding needed\' when both eth and hub balances are too low', async function () {
      await relayServer._sendTransaction({
        signer: relayServer.getManagerAddress(),
        destination: accounts[0],
        gasLimit: defaultEnvironment.mintxgascost.toString(),
        gasPrice: gasPrice.toString(),
        value: toHex((await relayServer.getManagerBalance()).sub(txcost))
      })
      const managerHubBalanceBefore = await rhub.balanceOf(relayServer.getManagerAddress())
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.lt(refill), 'manager eth balance should be insufficient to replenish worker')
      let fundingNeededEmitted = false
      relayServer.on('fundingNeeded', () => { fundingNeededEmitted = true })
      await relayServer.replenishWorker(workerIndex)
      assert.isTrue(fundingNeededEmitted, 'fundingNeeded not emitted')
    })
  })

  describe('listener task', function () {
    let origWorker: (blockHeader: BlockHeader) => Promise<TransactionReceipt[]>
    let started: boolean
    beforeEach(function () {
      origWorker = relayServer._worker
      started = false
      relayServer._worker = async function () {
        await Promise.resolve()
        started = true
        this.emit('error', new Error('GOTCHA'))
        return []
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
    describe('Unstaked event', function () {
      async function assertSendBalancesToOwner (
        server: RelayServer,
        managerHubBalanceBefore: BN,
        managerBalanceBefore: BN,
        workerBalanceBefore: BN): Promise<void> {
        const gasPrice = await _web3.eth.getGasPrice()
        const ownerBalanceBefore = toBN(await _web3.eth.getBalance(newServer.owner!))
        assert.equal(newServer.stake.toString(), oneEther.toString())
        assert.equal(newServer.withdrawBlock?.toString(), '0')
        const receipts = await newServer._worker(await _web3.eth.getBlock('latest'))
        const totalTxCosts = getTotalTxCosts(receipts, gasPrice)
        const ownerBalanceAfter = toBN(await _web3.eth.getBalance(newServer.owner!))
        assert.equal(
          ownerBalanceAfter.sub(
            ownerBalanceBefore).toString(),
          managerHubBalanceBefore.add(managerBalanceBefore).add(workerBalanceBefore)
            .sub(totalTxCosts).toString(),
          `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) != 
         managerHubBalanceBefore(${managerHubBalanceBefore.toString()}) + managerBalanceBefore(${managerBalanceBefore.toString()}) + workerBalanceBefore(${workerBalanceBefore.toString()})
         - totalTxCosts(${totalTxCosts.toString()})`)
        const managerHubBalanceAfter = await rhub.balanceOf(newServer.getManagerAddress())
        const managerBalanceAfter = await newServer.getManagerBalance()
        const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceAfter.eqn(0))
        assert.isTrue(managerBalanceAfter.eqn(0))
        assert.isTrue(workerBalanceAfter.eqn(0))
        assert.isTrue(newServer.withdrawBlock?.gtn(0))
      }

      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        newServer = await bringUpNewRelay()
        await newServer._worker(await _web3.eth.getBlock('latest'))
        await relayTransaction(newServer, options)
        await stakeManager.unlockStake(newServer.getManagerAddress(), { from: relayOwner })
      })
      afterEach(async function () {
        await revert(id)
      })
      it('send balances to owner when all balances > tx costs', async function () {
        const managerHubBalanceBefore = await rhub.balanceOf(newServer.getManagerAddress())
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.gtn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        await assertSendBalancesToOwner(newServer, managerHubBalanceBefore, managerBalanceBefore, workerBalanceBefore)
      })
      it('send balances to owner when manager hub balance < tx cost ', async function () {
        const workerAddress = newServer.getWorkerAddress(workerIndex)
        const managerHubBalance = await rhub.balanceOf(newServer.getManagerAddress())
        const method = rhub.contract.methods.withdraw(toHex(managerHubBalance), workerAddress)
        await newServer._sendTransaction({
          signer: newServer.getManagerAddress(),
          destination: rhub.address,
          method
        })
        const managerHubBalanceBefore = await rhub.balanceOf(newServer.getManagerAddress())
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceBefore.eqn(0))
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        await assertSendBalancesToOwner(newServer, managerHubBalanceBefore, managerBalanceBefore, workerBalanceBefore)
      })
    })
    describe('HubAuthorized event', function () {
      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        newServer = await bringUpNewRelay()
      })
      afterEach(async function () {
        await revert(id)
      })
      it('set hubAuthorized', async function () {
        await newServer._worker(await _web3.eth.getBlock('latest'))
        assert.isTrue(newServer.authorizedHub, 'Hub should be authorized in server')
      })
    })

    describe('HubUnauthorized event', function () {
      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        newServer = await bringUpNewRelay()
        await newServer._worker(await _web3.eth.getBlock('latest'))
        await relayTransaction(newServer, options)
      })
      afterEach(async function () {
        await revert(id)
      })
      it('send only manager hub balance and workers\' balances to owner (not manager eth balance)', async function () {
        await stakeManager.unauthorizeHubByOwner(newServer.getManagerAddress(), rhub.address, { from: relayOwner })

        const managerHubBalanceBefore = await rhub.balanceOf(newServer.getManagerAddress())
        const managerBalanceBefore = await newServer.getManagerBalance()
        const workerBalanceBefore = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerBalanceBefore.gtn(0))
        assert.isTrue(managerHubBalanceBefore.gtn(0))
        assert.isTrue(workerBalanceBefore.gtn(0))
        const ownerBalanceBefore = toBN(await _web3.eth.getBalance(relayOwner))
        assert.isTrue(newServer.authorizedHub, 'Hub should be authorized in server')
        const receipts = await newServer._worker(await _web3.eth.getBlock('latest'))
        assert.isFalse(newServer.authorizedHub, 'Hub should not be authorized in server')
        const gasPrice = await _web3.eth.getGasPrice()
        const workerEthTxCost = getTotalTxCosts([receipts[0]], gasPrice)
        const managerHubSendTxCost = getTotalTxCosts([receipts[1]], gasPrice)
        const ownerBalanceAfter = toBN(await _web3.eth.getBalance(relayOwner))
        const managerHubBalanceAfter = await rhub.balanceOf(newServer.getManagerAddress())
        const managerBalanceAfter = await newServer.getManagerBalance()
        const workerBalanceAfter = await newServer.getWorkerBalance(workerIndex)
        assert.isTrue(managerHubBalanceAfter.eqn(0))
        assert.isTrue(workerBalanceAfter.eqn(0))
        assert.equal(managerBalanceAfter.toString(), managerBalanceBefore.sub(managerHubSendTxCost).toString())
        assert.equal(
          ownerBalanceAfter.sub(
            ownerBalanceBefore).toString(),
          managerHubBalanceBefore.add(workerBalanceBefore).sub(workerEthTxCost).toString(),
          `ownerBalanceAfter(${ownerBalanceAfter.toString()}) - ownerBalanceBefore(${ownerBalanceBefore.toString()}) != 
         managerHubBalanceBefore(${managerHubBalanceBefore.toString()}) + workerBalanceBefore(${workerBalanceBefore.toString()})
         - workerEthTxCost(${workerEthTxCost.toString()})`)
      })
    })

    it('_handleStakedEvent')
    // TODO add failure tests
  })

  describe('Function testing', function () {
    it('_workerSemaphore', async function () {
      // @ts-ignore
      assert.isFalse(relayServer._workerSemaphoreOn, '_workerSemaphoreOn should be false first')
      const workerOrig = relayServer._worker
      let shouldRun = true
      try {
        relayServer._worker = async function (blockHeader: BlockHeader): Promise<TransactionReceipt[]> {
          // eslint-disable-next-line no-unmodified-loop-condition
          while (shouldRun) {
            await sleep(200)
          }
          return []
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
    describe('_registerIfNeeded', function () {
      let newServer: RelayServer
      beforeEach(async function () {
        id = (await snapshot()).result
        newServer = await bringUpNewRelay()
        // @ts-ignore
        newServer.authorizedHub = true
        const stake = await newServer.refreshStake()
        assert.deepEqual(stake, oneEther)
        assert.equal(newServer.owner, relayOwner, 'owner should be set after refreshing stake')
      })
      afterEach(async function () {
        await revert(id)
      })
      it('register server and add workers when not registered', async function () {
        const receipts = await newServer._registerIfNeeded()
        assertRelayAdded(receipts, newServer)
      })
      it('do not register server when already registered', async function () {
        let receipts = await newServer._registerIfNeeded()
        assertRelayAdded(receipts, newServer)
        receipts = await newServer._registerIfNeeded()
        assert.equal(receipts.length, 0, 'should not re-register if already registered')
      })
      it('re-register server when params changed', async function () {
        let receipts = await newServer._registerIfNeeded()
        assertRelayAdded(receipts, newServer)
        // @ts-ignore
        newServer.baseRelayFee++
        receipts = await newServer._registerIfNeeded()
        assertRelayAdded(receipts, newServer, false)
        // @ts-ignore
        newServer.pctRelayFee++
        receipts = await newServer._registerIfNeeded()
        assertRelayAdded(receipts, newServer, false)
        // @ts-ignore
        newServer.url = 'fakeUrl'
        receipts = await newServer._registerIfNeeded()
        assertRelayAdded(receipts, newServer, false)
      })
    })
    // it('_resendUnconfirmedTransactions', async function () {
    // })
    // it('_resendUnconfirmedTransactionsForWorker', async function () {
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

  describe.skip('runServer', function () {
    it('with config file', async function () {
      // await startRelay()
    })
    it('with env vars', async function () {
    })
    it('with command line', async function () {
    })
    it(' command line > command line > env vars', async function () {
    })
    it('missing vars', async function () {
    })
  })
})
