import Transaction from 'ethereumjs-tx/dist/transaction'
import Web3 from 'web3'
import chai from 'chai'
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
import RelayClient from '../../src/relayclient/RelayClient'
import { Address, AsyncApprovalData } from '../../src/relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'
import { configureGSN, getDependencies, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import replaceErrors from '../../src/common/ErrorReplacerJSON'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'

import BadHttpClient from '../dummies/BadHttpClient'
import BadContractInteractor from '../dummies/BadContractInteractor'
import BadRelayedTransactionValidator from '../dummies/BadRelayedTransactionValidator'
import { startRelay, stopRelay } from '../TestUtils'
import { constants } from '@openzeppelin/test-helpers'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import PingResponse from '../../src/common/PingResponse'
import { GsnRequestType } from '../../src/common/EIP712/TypedRequestData'

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const Eip712Forwarder = artifacts.require('Eip712Forwarder')

const expect = chai.expect
chai.use(sinonChai)

const localhostOne = 'http://localhost:8090'
const underlyingProvider = web3.currentProvider as HttpProvider

contract('RelayClient', function (accounts) {
  let web3: Web3
  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let testRecipient: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let gasLess: Address
  let relayProcess: ChildProcessWithoutNullStreams
  let forwarderAddress: Address

  let relayClient: RelayClient
  let gsnConfig: Partial<GSNConfig>
  let options: GsnTransactionDetails
  let to: Address
  let from: Address
  let data: PrefixedHexString

  before(async function () {
    web3 = new Web3(underlyingProvider)
    stakeManager = await StakeManager.new()
    relayHub = await RelayHub.new(stakeManager.address, constants.ZERO_ADDRESS)
    const forwarderInstance = await Eip712Forwarder.new()
    forwarderAddress = forwarderInstance.address
    testRecipient = await TestRecipient.new(forwarderAddress)
    // register hub's RelayRequest with forwarder, if not already done.
    const res = await forwarderInstance.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    )
    paymaster = await TestPaymasterEverythingAccepted.new()

    await paymaster.setRelayHub(relayHub.address)
    await paymaster.deposit({ value: web3.utils.toWei('1', 'ether') })

    relayProcess = await startRelay(relayHub.address, stakeManager, {
      stake: 1e18,
      url: 'asd',
      relayOwner: accounts[1],
      ethereumNodeUrl: underlyingProvider.host
    })

    gsnConfig = {
      relayHubAddress: relayHub.address,
      stakeManagerAddress: stakeManager.address
    }
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
      paymaster: paymaster.address
    }
  })

  after(async function () {
    await stopRelay(relayProcess)
  })

  describe('#relayTransaction()', function () {
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
      const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,address,uint256)') ?? ''
      assert(res.logs.find(log => log.topics.includes(topic)))

      const destination: string = validTransaction.to.toString('hex')
      assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())
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
      const badHttpClient = new BadHttpClient(configureGSN(gsnConfig), true, false, false)
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { httpClient: badHttpClient })
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(relayingErrors.size, 0)
      assert.equal(pingErrors.size, 1)
      assert.equal(pingErrors.get(localhostOne)!.message, BadHttpClient.message)
    })

    it('should return errors encountered in relaying', async function () {
      const badHttpClient = new BadHttpClient(configureGSN(gsnConfig), false, true, false)
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { httpClient: badHttpClient })
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(pingErrors.size, 0)
      assert.equal(relayingErrors.size, 1)
      assert.equal(relayingErrors.get(localhostOne)!.message, BadHttpClient.message)
    })
  })

  describe('#_calculateDefaultGasPrice()', function () {
    it('should use minimum gas price if calculated is to low', async function () {
      const minGasPrice = 1e18
      const gsnConfig = {
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
    const RelayServerAddress = accounts[1]
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
      await stakeManager.authorizeHub(relayManager, relayHub.address, { from: relayOwner })
      await relayHub.addRelayWorkers([RelayServerAddress], { from: relayManager })
      await relayHub.registerRelayServer(2e16.toString(), '10', 'url', { from: relayManager })
      await relayHub.depositFor(paymaster.address, { value: (2e18).toString() })
      pingResponse = {
        RelayServerAddress,
        RelayManagerAddress: relayManager,
        RelayHubAddress: relayManager,
        MinGasPrice: '',
        Ready: true,
        Version: ''
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
      const badContractInteractor = new BadContractInteractor(web3.currentProvider, configureGSN(gsnConfig), true)
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { contractInteractor: badContractInteractor })
      await relayClient._init()
      const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.isUndefined(transaction)
      assert.equal(error!.message, `local view call to 'relayCall()' reverted: ${BadContractInteractor.message}`)
    })

    it('should report relays that timeout to the Known Relays Manager', async function () {
      const badHttpClient = new BadHttpClient(configureGSN(gsnConfig), false, false, true)
      const dependencyTree = getDependencies(configureGSN(gsnConfig), underlyingProvider, { httpClient: badHttpClient })
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, dependencyTree)
      await relayClient._init()

      // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
      sinon.spy(dependencyTree.knownRelaysManager)
      const attempt = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.equal(attempt.error?.message, 'some error describing how timeout occurred somewhere')
      expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
    })

    it('should not report relays if error is not timeout', async function () {
      const badHttpClient = new BadHttpClient(configureGSN(gsnConfig), false, true, false)
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
      const badHttpClient = new BadHttpClient(configureGSN(gsnConfig), false, false, false, pingResponse, '0x123')
      let dependencyTree = getDependencies(configureGSN(gsnConfig), underlyingProvider)
      const badTransactionValidator = new BadRelayedTransactionValidator(true, dependencyTree.contractInteractor, configureGSN(gsnConfig))
      dependencyTree = getDependencies(configureGSN(gsnConfig), underlyingProvider, {
        httpClient: badHttpClient,
        transactionValidator: badTransactionValidator
      })
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, dependencyTree)

      await relayClient._init()
      // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
      sinon.spy(dependencyTree.knownRelaysManager)
      const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.isUndefined(transaction)
      assert.equal(error!.message, 'Returned transaction did not pass validation')
      expect(dependencyTree.knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
    })

    describe('#_prepareRelayHttpRequest()', function () {
      const asyncApprovalData: AsyncApprovalData = async function (_: RelayRequest): Promise<PrefixedHexString> {
        return Promise.resolve('0x1234567890')
      }
      it('should use provided approval function', async function () {
        const relayClient =
          new RelayClient(underlyingProvider, gsnConfig, { asyncApprovalData })
        const { httpRequest } = await relayClient._prepareRelayHttpRequest(relayInfo, optionsWithGas)
        assert.equal(httpRequest.approvalData, '0x1234567890')
      })
    })
  })

  describe('#_broadcastRawTx()', function () {
    // TODO: TBD: there has to be other behavior then that. Maybe query the transaction with the nonce somehow?
    it('should return \'wrongNonce\' if broadcast fails with nonce error', async function () {
      const badContractInteractor = new BadContractInteractor(underlyingProvider, configureGSN(gsnConfig), true)
      const transaction = new Transaction('0x')
      const relayClient =
        new RelayClient(underlyingProvider, gsnConfig, { contractInteractor: badContractInteractor })
      const { receipt, wrongNonce, broadcastError } = await relayClient._broadcastRawTx(transaction)
      assert.isUndefined(receipt)
      assert.isTrue(wrongNonce)
      assert.equal(broadcastError?.message, BadContractInteractor.wrongNonceMessage)
    })
  })
})
