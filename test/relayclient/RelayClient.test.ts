import Transaction from 'ethereumjs-tx/dist/transaction'
import Web3 from 'web3'
import axios from 'axios'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import express from 'express'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'

import {
  RelayHubInstance,
  StakeManagerInstance,
  TestRecipientInstance,
  TestPaymasterEverythingAcceptedInstance
} from '../../types/truffle-contracts'

import RelayRequest from '../../src/common/EIP712/RelayRequest'
import { _dumpRelayingResult, RelayClient } from '../../src/relayclient/RelayClient'
import { Address } from '../../src/relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'
import { configureGSN, getDependencies, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import replaceErrors from '../../src/common/ErrorReplacerJSON'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'

import BadHttpClient from '../dummies/BadHttpClient'
import BadContractInteractor from '../dummies/BadContractInteractor'
import BadRelayedTransactionValidator from '../dummies/BadRelayedTransactionValidator'
import { deployHub, revert, snapshot, startRelay, stopRelay } from '../TestUtils'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import PingResponse from '../../src/common/PingResponse'
import { registerForwarderForGsn } from '../../src/common/EIP712/ForwarderUtil'
import { GsnEvent } from '../../src/relayclient/GsnEvents'
import { Web3Provider } from '../../src/relayclient/ContractInteractor'
import bodyParser from 'body-parser'
import { Server } from 'http'
import HttpClient from '../../src/relayclient/HttpClient'
import HttpWrapper from '../../src/relayclient/HttpWrapper'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import { createClientLogger } from '../../src/relayclient/ClientWinstonLogger'
import { LoggerInterface } from '../../src/common/LoggerInterface'
import { ether } from '@openzeppelin/test-helpers'

const StakeManager = artifacts.require('StakeManager')
const TestRecipient = artifacts.require('TestRecipient')
const TestVersions = artifacts.require('TestVersions')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const Forwarder = artifacts.require('Forwarder')

const { expect, assert } = chai.use(chaiAsPromised)
chai.use(sinonChai)

const localhostOne = 'http://localhost:8090'
const underlyingProvider = web3.currentProvider as HttpProvider

class MockHttpClient extends HttpClient {
  constructor (readonly mockPort: number,
    logger: LoggerInterface,
    httpWrapper: HttpWrapper, config: Partial<GSNConfig>) {
    super(httpWrapper, logger, config)
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<PrefixedHexString> {
    return await super.relayTransaction(this.mapUrl(relayUrl), request)
  }

  private mapUrl (relayUrl: string): string {
    return relayUrl.replace(':8090', `:${this.mockPort}`)
  }
}

contract('RelayClient', function (accounts) {
  let web3: Web3
  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let testRecipient: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let gasLess: Address
  let relayProcess: ChildProcessWithoutNullStreams
  let forwarderAddress: Address
  let logger: LoggerInterface

  let relayClient: RelayClient
  let gsnConfig: Partial<GSNConfig>
  let options: GsnTransactionDetails
  let to: Address
  let from: Address
  let data: PrefixedHexString
  let gsnEvents: GsnEvent[] = []
  const cheapRelayerUrl = 'http://localhost:54321'

  // register a very cheap relayer, so client will attempt to use it first.
  async function registerCheapRelayer (relayHub: RelayHubInstance): Promise<void> {
    const relayWorker = '0x'.padEnd(42, '2')
    const relayOwner = accounts[3]
    const relayManager = accounts[4]
    await stakeManager.stakeForAddress(relayManager, 1000, {
      value: ether('2'),
      from: relayOwner
    })
    await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })

    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    await relayHub.registerRelayServer(1, 1, cheapRelayerUrl, { from: relayManager })
  }

  before(async function () {
    web3 = new Web3(underlyingProvider)
    stakeManager = await StakeManager.new()
    relayHub = await deployHub(stakeManager.address)
    const forwarderInstance = await Forwarder.new()
    forwarderAddress = forwarderInstance.address
    testRecipient = await TestRecipient.new(forwarderAddress)
    // register hub's RelayRequest with forwarder, if not already done.
    await registerForwarderForGsn(forwarderInstance)
    paymaster = await TestPaymasterEverythingAccepted.new()
    await paymaster.setTrustedForwarder(forwarderAddress)
    await paymaster.setRelayHub(relayHub.address)
    await paymaster.deposit({ value: web3.utils.toWei('1', 'ether') })

    relayProcess = await startRelay(relayHub.address, stakeManager, {
      stake: 1e18,
      relayOwner: accounts[1],
      ethereumNodeUrl: underlyingProvider.host
    })

    gsnConfig = {
      relayHubAddress: relayHub.address
    }
    logger = createClientLogger('error', '', '', '')
    relayClient = new RelayClient(underlyingProvider, gsnConfig)
    gasLess = await web3.eth.personal.newAccount('password')
    from = gasLess
    to = testRecipient.address
    data = testRecipient.contract.methods.emitMessage('hello world').encodeABI()
    options = {
      from,
      to,
      data,
      forwarder: forwarderAddress,
      paymaster: paymaster.address,
      paymasterData: '0x',
      clientId: '1'
    }
  })

  after(async function () {
    await stopRelay(relayProcess)
  })

  describe('#resolveForwarder()', function () {
    it('should try to get forwarder address from recipient if none given as transaction details', async function () {
      const noForwarderDetails = Object.assign({}, options, { forwarder: undefined })
      const forwarder = await relayClient.resolveForwarder(noForwarderDetails)
      assert.equal(forwarder, forwarderAddress)
    })

    it('should throw an exception if recipient does not return address for getTrustedForwarder', async function () {
      const badRecipient = await TestVersions.new()
      const noForwarderDetails = Object.assign({}, options, { forwarder: undefined, to: badRecipient.address })
      await expect(relayClient.resolveForwarder(noForwarderDetails))
        .to.eventually.be.rejectedWith('No forwarder address configured and no getTrustedForwarder in target contract')
    })

    it('should throw an exception if passed forwarder is not trusted', async function () {
      const badForwarderDetails = Object.assign({}, options, { forwarder: accounts[0] })
      await expect(relayClient.resolveForwarder(badForwarderDetails))
        .to.eventually.be.rejectedWith('The Forwarder address configured but is not trusted by the Recipient contract')
    })

    it('should not throw an exception if check is disabled in configuration', async function () {
      relayClient.config.skipRecipientForwarderValidation = true
      const badForwarderDetails = Object.assign({}, options, { forwarder: accounts[0] })
      const forwarder = await relayClient.resolveForwarder(badForwarderDetails)
      assert.equal(forwarder, accounts[0])
    })
  })

  describe('#relayTransaction()', function () {
    it('should warn if called relayTransaction without calling init first', async function () {
      relayClient = new RelayClient(underlyingProvider, gsnConfig)
      sinon.spy(relayClient, '_warn')
      try {
        await relayClient.relayTransaction(options)
        expect(relayClient._warn).to.have.been.calledWithMatch(/.*call RelayClient.init*/)
      } finally {
        // @ts-ignore
        relayClient._warn.restore()
      }
    })
    it('should not warn if called "new RelayClient().init()"', async function () {
      relayClient = await new RelayClient(underlyingProvider, gsnConfig).init()
      sinon.spy(relayClient, '_warn')
      try {
        await relayClient.relayTransaction(options)
        expect(relayClient._warn).to.have.not.been.called
      } finally {
        // @ts-ignore
        relayClient._warn.restore()
      }
    })

    it('should send transaction to a relay and receive a signed transaction in response', async function () {
      const relayingResult = await relayClient.relayTransaction(options)
      const validTransaction = relayingResult.transaction
      if (validTransaction == null) {
        assert.fail(`validTransaction is null: ${JSON.stringify(relayingResult, replaceErrors)}`)
        return
      }
      const validTransactionHash: string = validTransaction.hash(true).toString('hex')
      const txHash = `0x${validTransactionHash}`
      const res = await web3.eth.getTransactionReceipt(txHash)

      // validate we've got the "SampleRecipientEmitted" event
      // TODO: use OZ test helpers
      const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,address,uint256,uint256)') ?? ''
      assert(res.logs.find(log => log.topics.includes(topic)))

      const destination: string = validTransaction.to.toString('hex')
      assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())
    })

    it('should skip timed-out server', async function () {
      let server: Server | undefined
      try {
        const pingResponse = await axios.get('http://localhost:8090/getaddr').then(res => res.data)
        const mockServer = express()
        mockServer.use(bodyParser.urlencoded({ extended: false }))
        mockServer.use(bodyParser.json())

        mockServer.get('/getaddr', async (req, res) => {
          console.log('=== got GET ping', req.query)
          res.send(pingResponse)
        })
        mockServer.post('/relay', () => {
          console.log('== got relay.. ignoring')
          // don't answer... keeping client in limbo
        })

        await new Promise((resolve) => {
          server = mockServer.listen(0, resolve)
        })
        const mockServerPort = (server as any).address().port

        // MockHttpClient alter the server port, so the client "thinks" it works with relayUrl, but actually
        // it uses the mockServer's port
        const relayClient = new RelayClient(underlyingProvider, gsnConfig, {
          httpClient: new MockHttpClient(mockServerPort, logger, new HttpWrapper({ timeout: 100 }), gsnConfig)
        })

        // async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<PrefixedHexString> {
        const relayingResult = await relayClient.relayTransaction(options)
        assert.match(_dumpRelayingResult(relayingResult), /timeout.*exceeded/)
      } finally {
        server?.close()
      }
    })

    it('should use forceGasPrice if provided', async function () {
      const forceGasPrice = '0x777777777'
      const optionsForceGas = Object.assign({}, options, { forceGasPrice })
      const { transaction, pingErrors, relayingErrors } = await relayClient.relayTransaction(optionsForceGas)
      assert.equal(pingErrors.size, 0)
      assert.equal(relayingErrors.size, 0)
      assert.equal(parseInt(transaction!.gasPrice.toString('hex'), 16), parseInt(forceGasPrice))
    })

    it('should return errors encountered in ping', async function () {
      const badHttpClient = new BadHttpClient(logger, configureGSN(gsnConfig), true, false, false)
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { httpClient: badHttpClient })
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(relayingErrors.size, 0)
      assert.equal(pingErrors.size, 1)
      assert.equal(pingErrors.get(localhostOne)!.message, BadHttpClient.message)
    })

    it('should return errors encountered in relaying', async function () {
      const badHttpClient = new BadHttpClient(logger, configureGSN(gsnConfig), false, true, false)
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { httpClient: badHttpClient })
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(pingErrors.size, 0)
      assert.equal(relayingErrors.size, 1)
      assert.equal(relayingErrors.get(localhostOne)!.message, BadHttpClient.message)
    })

    it('should return errors in callback (asyncApprovalData) ', async function () {
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, {
          asyncApprovalData: async () => { throw new Error('approval-error') }
        })
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(pingErrors.size, 0)
      assert.equal(relayingErrors.size, 1)
      assert.match(relayingErrors.values().next().value.message, /approval-error/)
    })

    it('should return errors in callback (asyncPaymasterData) ', async function () {
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, {
          asyncPaymasterData: async () => { throw new Error('paymasterData-error') }
        })
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(pingErrors.size, 0)
      assert.equal(relayingErrors.size, 1)
      assert.match(relayingErrors.values().next().value.message, /paymasterData-error/)
    })

    it.skip('should return errors in callback (scoreCalculator) ', async function () {
      // can't be used: scoring is completely disabled
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, {
          scoreCalculator: async () => { throw new Error('score-error') }
        })
      const ret = await relayClient.relayTransaction(options)
      const { transaction, relayingErrors, pingErrors } = ret
      assert.isUndefined(transaction)
      assert.equal(pingErrors.size, 0)
      assert.equal(relayingErrors.size, 1)
      assert.match(relayingErrors.values().next().value.message, /score-error/)
    })
    describe('with events listener', () => {
      function eventsHandler (e: GsnEvent): void {
        gsnEvents.push(e)
      }

      before('registerEventsListener', async () => {
        relayClient = await new RelayClient(underlyingProvider, gsnConfig).init()
        relayClient.registerEventListener(eventsHandler)
      })
      it('should call all events handler', async function () {
        await relayClient.relayTransaction(options)
        assert.equal(gsnEvents.length, 7)
        assert.equal(gsnEvents[0].step, 1)
        assert.equal(gsnEvents[0].total, 7)
        assert.equal(gsnEvents[6].step, 7)
      })
      describe('removing events listener', () => {
        before('registerEventsListener', () => {
          gsnEvents = []
          relayClient.unregisterEventListener(eventsHandler)
        })
        it('should call events handler', async function () {
          await relayClient.relayTransaction(options)
          assert.equal(gsnEvents.length, 0)
        })
      })
    })
  })

  describe('#_calculateDefaultGasPrice()', function () {
    it('should use minimum gas price if calculated is to low', async function () {
      const minGasPrice = 1e18
      const gsnConfig: Partial<GSNConfig> = {
        logLevel: 'error',
        relayHubAddress: relayHub.address,
        minGasPrice
      }
      const relayClient = new RelayClient(underlyingProvider, gsnConfig)
      const calculatedGasPrice = await relayClient._calculateGasPrice()
      assert.equal(calculatedGasPrice, `0x${minGasPrice.toString(16)}`)
    })
  })

  describe('#_attemptRelay()', function () {
    const relayUrl = localhostOne
    const relayWorkerAddress = accounts[1]
    const relayManager = accounts[2]
    const relayOwner = accounts[3]
    let pingResponse: PingResponse
    let relayInfo: RelayInfo
    let optionsWithGas: GsnTransactionDetails

    before(async function () {
      await stakeManager.stakeForAddress(relayManager, 7 * 24 * 3600, {
        from: relayOwner,
        value: (2e18).toString()
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      await relayHub.addRelayWorkers([relayWorkerAddress], { from: relayManager })
      await relayHub.registerRelayServer(2e16.toString(), '10', 'url', { from: relayManager })
      await relayHub.depositFor(paymaster.address, { value: (2e18).toString() })
      pingResponse = {
        relayWorkerAddress: relayWorkerAddress,
        relayManagerAddress: relayManager,
        relayHubAddress: relayManager,
        minGasPrice: '',
        maxAcceptanceBudget: 1e10.toString(),
        ready: true,
        version: ''
      }
      relayInfo = {
        relayInfo: {
          relayManager,
          relayUrl,
          baseRelayFee: '',
          pctRelayFee: ''
        },
        pingResponse
      }
      optionsWithGas = Object.assign({}, options, {
        gas: '0xf4240',
        gasPrice: '0x51f4d5c00'
      })
    })

    it('should return error if view call to \'relayCall()\' fails', async function () {
      const badContractInteractor = new BadContractInteractor(web3.currentProvider as Web3Provider, logger, configureGSN(gsnConfig), true)
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { contractInteractor: badContractInteractor })
      await relayClient.init()
      const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.isUndefined(transaction)
      assert.equal(error!.message, `local view call to 'relayCall()' reverted: ${BadContractInteractor.message}`)
    })

    it('should report relays that timeout to the Known Relays Manager', async function () {
      const badHttpClient = new BadHttpClient(logger, configureGSN(gsnConfig), false, false, true)
      const dependencyTree = getDependencies(configureGSN(gsnConfig), underlyingProvider, { httpClient: badHttpClient })
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, dependencyTree)
      await relayClient.init()

      // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
      sinon.spy(dependencyTree.knownRelaysManager)
      const attempt = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.equal(attempt.error?.message, 'some error describing how timeout occurred somewhere')
      expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
    })

    it('should not report relays if error is not timeout', async function () {
      const badHttpClient = new BadHttpClient(logger, configureGSN(gsnConfig), false, true, false)
      const dependencyTree = getDependencies(configureGSN(gsnConfig), underlyingProvider, { httpClient: badHttpClient })
      dependencyTree.httpClient = badHttpClient
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, dependencyTree)
      // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
      sinon.spy(dependencyTree.knownRelaysManager)
      await relayClient._attemptRelay(relayInfo, optionsWithGas)
      expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.not.been.called
    })

    it('should return error if transaction returned by a relay does not pass validation', async function () {
      const badHttpClient = new BadHttpClient(logger, configureGSN(gsnConfig), false, false, false, pingResponse, '0x123')
      let dependencyTree = getDependencies(configureGSN(gsnConfig), underlyingProvider)
      const badTransactionValidator = new BadRelayedTransactionValidator(logger, true, dependencyTree.contractInteractor, configureGSN(gsnConfig))
      dependencyTree = getDependencies(configureGSN(gsnConfig), underlyingProvider, {
        httpClient: badHttpClient,
        transactionValidator: badTransactionValidator
      })
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, dependencyTree)

      await relayClient.init()
      // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
      sinon.spy(dependencyTree.knownRelaysManager)
      const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.isUndefined(transaction)
      assert.equal(error!.message, 'Returned transaction did not pass validation')
      expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
    })

    describe('#_prepareRelayHttpRequest()', function () {
      const asyncApprovalData = async function (_: RelayRequest): Promise<PrefixedHexString> {
        return await Promise.resolve('0x1234567890')
      }
      const asyncPaymasterData = async function (_: RelayRequest): Promise<PrefixedHexString> {
        return await Promise.resolve('0xabcd')
      }

      it('should use provided approval function', async function () {
        const relayClient =
          new RelayClient(underlyingProvider, gsnConfig, {
            asyncApprovalData,
            asyncPaymasterData
          })
        const httpRequest = await relayClient._prepareRelayHttpRequest(relayInfo, optionsWithGas)
        assert.equal(httpRequest.metadata.approvalData, '0x1234567890')
        assert.equal(httpRequest.relayRequest.relayData.paymasterData, '0xabcd')
      })
    })
  })

  describe('#_broadcastRawTx()', function () {
    // TODO: TBD: there has to be other behavior then that. Maybe query the transaction with the nonce somehow?
    it('should return \'wrongNonce\' if broadcast fails with nonce error', async function () {
      const badContractInteractor = new BadContractInteractor(underlyingProvider, logger, configureGSN(gsnConfig), true)
      const transaction = new Transaction('0x')
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { contractInteractor: badContractInteractor })
      const { hasReceipt, wrongNonce, broadcastError } = await relayClient._broadcastRawTx(transaction)
      assert.isFalse(hasReceipt)
      assert.isTrue(wrongNonce)
      assert.equal(broadcastError?.message, BadContractInteractor.wrongNonceMessage)
    })
  })

  describe('multiple relayers', () => {
    let id: string
    before(async () => {
      id = (await snapshot()).result
      await registerCheapRelayer(relayHub)
    })
    after(async () => {
      await revert(id)
    })

    it('should succeed to relay, but report ping error', async () => {
      const relayingResult = await relayClient.relayTransaction(options)
      assert.isNotNull(relayingResult.transaction)
      assert.match(relayingResult.pingErrors.get(cheapRelayerUrl)?.message as string, /ECONNREFUSED/,
        `relayResult: ${_dumpRelayingResult(relayingResult)}`)
    })

    it('use preferred relay if one is set', async () => {
      relayClient = new RelayClient(underlyingProvider, {
        preferredRelays: ['http://localhost:8090'],
        ...gsnConfig
      })

      const relayingResult = await relayClient.relayTransaction(options)
      assert.isNotNull(relayingResult.transaction)
      assert.equal(relayingResult.pingErrors.size, 0)
    })
  })
})
