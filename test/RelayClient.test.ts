import Transaction from 'ethereumjs-tx/dist/transaction'
import Web3 from 'web3'
import chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { PromiEvent, TransactionReceipt } from 'web3-core'

import {
  RelayHubInstance,
  StakeManagerInstance,
  TestRecipientInstance,
  TestPaymasterEverythingAcceptedInstance
} from '../types/truffle-contracts'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import RelayClient, { EmptyApprove, GasPricePingFilter } from '../src/relayclient/RelayClient'
import { defaultEnvironment } from '../src/relayclient/types/Environments'
import { Address, AsyncApprove } from '../src/relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'
import { configureGSN, GSNConfig } from '../src/relayclient/GSNConfigurator'
import replaceErrors from '../src/common/ErrorReplacerJSON'
import GsnTransactionDetails from '../src/relayclient/types/GsnTransactionDetails'
import ContractInteractor from '../src/relayclient/ContractInteractor'
import KnownRelaysManager, { EmptyFilter } from '../src/relayclient/KnownRelaysManager'
import AccountManager from '../src/relayclient/AccountManager'
import RelayedTransactionValidator from '../src/relayclient/RelayedTransactionValidator'
import RelayInfo from '../src/relayclient/types/RelayInfo'
import HttpClient from '../src/relayclient/HttpClient'
import HttpWrapper from '../src/relayclient/HttpWrapper'

import BadHttpClient from './dummies/BadHttpClient'
import BadContractInteractor from './dummies/BadContractInteractor'
import BadRelayedTransactionValidator from './dummies/BadRelayedTransactionValidator'
import { startRelay, stopRelay } from './TestUtils'

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

const expect = chai.expect
chai.use(sinonChai)

const localhostOne = 'http://localhost:8090'
const underlyingProvider = web3.currentProvider

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
  let httpClient: HttpClient
  let contractInteractor: ContractInteractor
  let knownRelaysManager: KnownRelaysManager
  let accountManager: AccountManager
  let transactionValidator: RelayedTransactionValidator
  let gsnConfig: GSNConfig
  let options: GsnTransactionDetails
  let to: Address
  let from: Address
  let data: PrefixedHexString

  before(async function () {
    web3 = new Web3(underlyingProvider)
    stakeManager = await StakeManager.new()
    relayHub = await RelayHub.new(defaultEnvironment.gtxdatanonzero, stakeManager.address)
    testRecipient = await TestRecipient.new()
    forwarderAddress = await testRecipient.getTrustedForwarder()
    paymaster = await TestPaymasterEverythingAccepted.new()

    await paymaster.setHub(relayHub.address)
    await paymaster.deposit({ value: web3.utils.toWei('1', 'ether') })
    gasLess = await web3.eth.personal.newAccount('password')

    relayProcess = await startRelay(relayHub.address, stakeManager, {
      stake: 1e18,
      url: 'asd',
      relayOwner: accounts[1],
      // @ts-ignore
      EthereumNodeUrl: underlyingProvider.host,
      GasPricePercent: 20,
      relaylog: process.env.relaylog
    })

    gsnConfig = configureGSN({ relayHubAddress: relayHub.address })
    relayClient = RelayClient.new(web3, gsnConfig)
    const httpWrapper = new HttpWrapper()
    httpClient = new HttpClient(httpWrapper, { verbose: false })
    contractInteractor = new ContractInteractor(web3.currentProvider, gsnConfig.contractInteractorConfig)
    knownRelaysManager = new KnownRelaysManager(web3, gsnConfig.relayHubAddress, contractInteractor, EmptyFilter, gsnConfig.knownRelaysManagerConfig)
    accountManager = new AccountManager(web3, defaultEnvironment.chainId, gsnConfig.accountManagerConfig)
    transactionValidator = new RelayedTransactionValidator(contractInteractor, gsnConfig.relayHubAddress, defaultEnvironment.chainId, gsnConfig.transactionValidatorConfig)
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
      const topic: string = web3.utils.sha3('SampleRecipientEmitted(string,address,address,address)') ?? ''
      assert(res.logs.find(log => log.topics.includes(topic)))

      const destination: string = validTransaction.to.toString('hex')
      assert.equal(`0x${destination}`, relayHub.address.toString().toLowerCase())
    })

    it('should use forceGasPrice if provided', async function () {
      const forceGasPrice = '77777777777'
      const optionsForceGas = Object.assign({}, options, { forceGasPrice })
      const { transaction } = await relayClient.relayTransaction(optionsForceGas)
      assert.equal(parseInt(transaction!.gasPrice.toString('hex'), 16), parseInt(forceGasPrice))
    })

    it('should return errors encountered in ping', async function () {
      const badHttpClient = new BadHttpClient(true, false, false)
      const relayClient =
        new RelayClient(web3, badHttpClient, contractInteractor, knownRelaysManager, accountManager,
          transactionValidator, relayHub.address, GasPricePingFilter, EmptyApprove, gsnConfig.relayClientConfig)
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(relayingErrors.size, 0)
      assert.equal(pingErrors.size, 1)
      assert.equal(pingErrors.get(localhostOne)!.message, BadHttpClient.message)
    })

    it('should return errors encountered in relaying', async function () {
      const badHttpClient = new BadHttpClient(false, true, false)
      const relayClient =
        new RelayClient(web3, badHttpClient, contractInteractor, knownRelaysManager, accountManager,
          transactionValidator, relayHub.address, GasPricePingFilter, EmptyApprove, gsnConfig.relayClientConfig)
      const { transaction, relayingErrors, pingErrors } = await relayClient.relayTransaction(options)
      assert.isUndefined(transaction)
      assert.equal(pingErrors.size, 0)
      assert.equal(relayingErrors.size, 1)
      assert.equal(relayingErrors.get(localhostOne)!.message, BadHttpClient.message)
    })
  })

  describe('#_calculateDefaultGasPrice()', function () {
    it('should use minimum gas price if calculated is to low', async function () {
      const minGasPrice = (1e18).toString()
      const gsnConfig = configureGSN({
        relayHubAddress: relayHub.address,
        relayClientConfig: {
          minGasPrice
        }
      })
      const relayClient = RelayClient.new(web3, gsnConfig)
      const calculatedGasPrice = await relayClient._calculateGasPrice()
      assert.equal(calculatedGasPrice, minGasPrice)
    })
  })

  describe('#_attemptRelay()', function () {
    const relayUrl = localhostOne
    const RelayServerAddress = '0x0000000000000000000000000000000000000001'
    const relayManager = '0x0000000000000000000000000000000000000002'
    const pingResponse = {
      RelayServerAddress,
      MinGasPrice: '',
      Ready: true,
      Version: ''
    }
    const relayInfo: RelayInfo = {
      eventInfo: {
        relayManager,
        relayUrl,
        baseRelayFee: '',
        pctRelayFee: ''
      },
      pingResponse
    }
    let optionsWithGas: GsnTransactionDetails

    before(function () {
      optionsWithGas = Object.assign({}, options, {
        gas: '1000000',
        gasPrice: '22000000000'
      })
      // @ts-ignore (sinon allows spying on all methods of the object, but TypeScript does not seem to know that)
      sinon.spy(knownRelaysManager)
    })

    beforeEach(function () {
      sinon.resetHistory()
    })

    it('should return error if canRelay/acceptRelayedCall fail', async function () {
      const badContractInteractor = new BadContractInteractor(web3.currentProvider, gsnConfig.contractInteractorConfig, true)
      const relayClient =
        new RelayClient(web3, httpClient, badContractInteractor, knownRelaysManager, accountManager,
          transactionValidator, relayHub.address, GasPricePingFilter, EmptyApprove, gsnConfig.relayClientConfig)
      const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.isUndefined(transaction)
      assert.equal(error!.message, `canRelay failed: ${BadContractInteractor.message}`)
    })

    it('should report relays that timeout to the Known Relays Manager', async function () {
      const badHttpClient = new BadHttpClient(false, false, true)
      const relayClient =
        new RelayClient(web3, badHttpClient, contractInteractor, knownRelaysManager, accountManager,
          transactionValidator, relayHub.address, GasPricePingFilter, EmptyApprove, gsnConfig.relayClientConfig)
      await relayClient._attemptRelay(relayInfo, optionsWithGas)
      expect(knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
    })

    it('should not report relays if error is not timeout', async function () {
      const badHttpClient = new BadHttpClient(false, true, false)
      const relayClient =
        new RelayClient(web3, badHttpClient, contractInteractor, knownRelaysManager, accountManager,
          transactionValidator, relayHub.address, GasPricePingFilter, EmptyApprove, gsnConfig.relayClientConfig)
      await relayClient._attemptRelay(relayInfo, optionsWithGas)
      expect(knownRelaysManager.saveRelayFailure).to.have.not.been.called
    })

    it('should return error if transaction returned by a relay does not pass validation', async function () {
      const badHttpClient = new BadHttpClient(false, false, false, pingResponse, '0x123')
      const badTransactionValidator = new BadRelayedTransactionValidator(true, contractInteractor, gsnConfig.relayHubAddress, defaultEnvironment.chainId, gsnConfig.transactionValidatorConfig)
      const relayClient =
        new RelayClient(web3, badHttpClient, contractInteractor, knownRelaysManager, accountManager,
          badTransactionValidator, relayHub.address, GasPricePingFilter, EmptyApprove, gsnConfig.relayClientConfig)
      const { transaction, error } = await relayClient._attemptRelay(relayInfo, optionsWithGas)
      assert.isUndefined(transaction)
      assert.equal(error!.message, 'Returned transaction did not pass validation')
      expect(knownRelaysManager.saveRelayFailure).to.have.been.calledWith(sinon.match.any, relayManager, relayUrl)
    })

    describe('#_prepareRelayHttpRequest()', function () {
      const asyncApprove: AsyncApprove = async function (_: RelayRequest): Promise<PrefixedHexString> {
        return Promise.resolve('0x1234567890')
      }

      it('should use provided approval function', async function () {
        const relayClient =
          new RelayClient(web3, httpClient, contractInteractor, knownRelaysManager, accountManager,
            transactionValidator, relayHub.address, GasPricePingFilter, asyncApprove, gsnConfig.relayClientConfig)
        const { httpRequest } = await relayClient._prepareRelayHttpRequest(relayInfo, optionsWithGas)
        assert.equal(httpRequest.approvalData, '0x1234567890')
      })
    })
  })

  describe('#_broadcastRawTx()', function () {
    // TODO: TBD: there has to be other behavior then that. Maybe query the transaction with the nonce somehow?
    it('should return \'wrongNonce\' if broadcast fails with nonce error', async function () {
      const message = 'the tx doesn\'t have the correct nonce'
      const web3 = new Web3(underlyingProvider)
      // eslint-disable-next-line @typescript-eslint/promise-function-async
      web3.eth.sendSignedTransaction = function (_: string, __?: (error: Error, hash: string) => void): PromiEvent<TransactionReceipt> {
        throw new Error(message)
      }
      const transaction = new Transaction('0x')
      const relayClient = RelayClient.new(web3, gsnConfig)
      const { receipt, wrongNonce, broadcastError } = await relayClient._broadcastRawTx(transaction)
      assert.isUndefined(receipt)
      assert.isTrue(wrongNonce)
      assert.equal(broadcastError?.message, message)
    })
  })
})
