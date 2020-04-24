import { HttpProvider } from 'web3-core'
import { RelayProvider, BaseTransactionReceipt } from '../../src/relayclient/RelayProvider'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import {
  RelayHubInstance, StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRecipientInstance
} from '../../types/truffle-contracts'
import { Address } from '../../src/relayclient/types/Aliases'
import Web3 from 'web3'
import { defaultEnvironment } from '../../src/relayclient/types/Environments'
import { startRelay, stopRelay } from '../TestUtils'
import { ChildProcessWithoutNullStreams } from 'child_process'
import BadRelayClient from '../dummies/BadRelayClient'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'

import chaiAsPromised from 'chai-as-promised'
import { constants, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import getDataToSign from '../../src/common/EIP712/Eip712Helper'
import { getEip712Signature } from '../../src/common/utils'
import RelayRequest from '../../src/common/EIP712/RelayRequest'

const { expect, assert } = require('chai').use(chaiAsPromised)

const RelayHub = artifacts.require('RelayHub')
const TrustedForwarder = artifacts.require('TrustedForwarder')
const StakeManager = artifacts.require('StakeManager')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

const underlyingProvider = web3.currentProvider as HttpProvider

// TODO: once Utils.js is translated to TypeScript, move to Utils.ts
export async function prepareTransaction (testRecipient: TestRecipientInstance, account: string, relayWorker: string, paymaster: string, web3: Web3): Promise<{ relayRequest: RelayRequest, signature: string }> {
  const testRecipientForwarderAddress = await testRecipient.getTrustedForwarder()
  const testRecipientForwarder = await TrustedForwarder.at(testRecipientForwarderAddress)
  const senderNonce = (await testRecipientForwarder.getNonce(account)).toString()
  const relayRequest = new RelayRequest({
    senderAddress: account,
    encodedFunction: testRecipient.contract.methods.emitMessage('hello world').encodeABI(),
    senderNonce,
    target: testRecipient.address,
    pctRelayFee: '1',
    baseRelayFee: '1',
    gasPrice: '1',
    gasLimit: '10000',
    relayWorker,
    paymaster
  })
  const dataToSign = await getDataToSign({
    chainId: defaultEnvironment.chainId,
    verifier: testRecipientForwarderAddress,
    relayRequest: relayRequest
  })
  const signature = await getEip712Signature({
    web3,
    dataToSign
  })
  return {
    relayRequest,
    signature
  }
}

contract('RelayProvider', function (accounts) {
  let web3: Web3
  let gasLess: Address
  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let paymaster: Address
  let relayProcess: ChildProcessWithoutNullStreams
  let relayProvider: provider

  before(async function () {
    web3 = new Web3(underlyingProvider)
    gasLess = await web3.eth.personal.newAccount('password')
    stakeManager = await StakeManager.new()
    relayHub = await RelayHub.new(defaultEnvironment.gtxdatanonzero, stakeManager.address, constants.ZERO_ADDRESS)
    const paymasterInstance = await TestPaymasterEverythingAccepted.new()
    paymaster = paymasterInstance.address
    await paymasterInstance.setHub(relayHub.address)
    await paymasterInstance.deposit({ value: web3.utils.toWei('2', 'ether') })
    relayProcess = await startRelay(relayHub.address, stakeManager, {
      stake: 1e18,
      url: 'asd',
      relayOwner: accounts[1],
      EthereumNodeUrl: underlyingProvider.host
    })
  })

  after(async function () {
    await stopRelay(relayProcess)
  })

  describe('Use Provider to relay transparently', () => {
    let testRecipient: TestRecipientInstance
    before(async () => {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new()
      const gsnConfig = configureGSN({
        relayHubAddress: relayHub.address,
        stakeManagerAddress: stakeManager.address
      })
      const websocketProvider = new Web3.providers.WebsocketProvider(underlyingProvider.host)
      relayProvider = new RelayProvider(websocketProvider as any, gsnConfig)
      // NOTE: in real application its enough to set the provider in web3.
      // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
      // so changing the global one is not enough.
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)
    })
    it('should relay transparently', async function () {
      const res = await testRecipient.emitMessage('hello world', {
        from: gasLess,
        forceGasPrice: '0x51f4d5c00',
        // TODO: for some reason estimated values are crazy high!
        gas: '100000',
        paymaster
      })

      expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
        message: 'hello world',
        realSender: gasLess
      })
    })

    it('should subscribe to events', async () => {
      const block = await web3.eth.getBlockNumber()

      const eventPromise = new Promise((resolve, reject) => {
        // @ts-ignore
        testRecipient.contract.once('SampleRecipientEmitted', { fromBlock: block }, (err, ev) => {
          if (err !== null) {
            reject(err)
          } else {
            resolve(ev)
          }
        })
      })

      await testRecipient.emitMessage('hello again', { from: gasLess, paymaster })
      const log: any = await eventPromise

      assert.equal(log.returnValues.message, 'hello again')
    })

    it('should fail if transaction failed', async () => {
      await expectRevert(testRecipient.testRevert({ from: gasLess, paymaster }), 'always fail')
    })
  })

  describe('_ethSendTransaction', function () {
    const id = 777
    let testRecipient: TestRecipientInstance
    let gsnConfig: GSNConfig
    let jsonRpcPayload: JsonRpcPayload

    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new()
      const forwarder = await testRecipient.getTrustedForwarder()
      gsnConfig = configureGSN({ relayHubAddress: relayHub.address })
      // call to emitMessage('hello world')
      jsonRpcPayload = {
        jsonrpc: '2.0',
        id,
        method: 'eth_sendTransaction',
        params: [
          {
            from: gasLess,
            gas: '0x186a0',
            gasPrice: '0x4a817c800',
            forceGasPrice: '0x51f4d5c00',
            paymaster,
            forwarder,
            to: testRecipient.address,
            data: testRecipient.contract.methods.emitMessage('hello world').encodeABI()
          }
        ]
      }
    })

    it('should call callback with error if relayTransaction throws', async function () {
      const badRelayClient = new BadRelayClient(true, false, underlyingProvider, gsnConfig)
      const relayProvider = new RelayProvider(underlyingProvider, gsnConfig, {}, badRelayClient)
      const promisified = new Promise((resolve, reject) => relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null): void => {
        reject(error)
      }))
      await expect(promisified).to.be.eventually.rejectedWith(`Rejected relayTransaction call - should not happen. Reason: Error: ${BadRelayClient.message}`)
    })

    it('should call callback with error containing relaying results dump if relayTransaction does not return a transaction object', async function () {
      const badRelayClient = new BadRelayClient(false, true, underlyingProvider, gsnConfig)
      const relayProvider = new RelayProvider(underlyingProvider, gsnConfig, {}, badRelayClient)
      const promisified = new Promise((resolve, reject) => relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null): void => {
        reject(error)
      }))
      await expect(promisified).to.be.eventually.rejectedWith('Failed to relay call. Results:')
    })

    it('should convert a returned transaction to a compatible rpc transaction hash response', async function () {
      const gsnConfig = configureGSN({ relayHubAddress: relayHub.address, stakeManagerAddress: stakeManager.address })
      const relayProvider = new RelayProvider(underlyingProvider, gsnConfig)
      const response: JsonRpcResponse = await new Promise((resolve, reject) => relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null, result: JsonRpcResponse | undefined): void => {
        if (error != null) {
          reject(error)
        } else {
          resolve(result)
        }
      }))
      assert.equal(id, response.id)
      assert.equal('2.0', response.jsonrpc)
      // I don't want to hard-code tx hash, so for now just checking it is there
      assert.equal(66, response.result.length)
    })
  })

  // TODO: most of this code is copy-pasted from the RelayHub.test.ts. Maybe extract better utils?
  describe('_getTranslatedGsnResponseResult', function () {
    let relayProvider: RelayProvider
    let testRecipient: TestRecipientInstance
    let canRelayFailedTxReceipt: BaseTransactionReceipt
    let innerTxFailedReceipt: BaseTransactionReceipt
    let innerTxSucceedReceipt: BaseTransactionReceipt
    let notRelayedTxReceipt: BaseTransactionReceipt
    let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
    // It is not strictly necessary to make this test against actual tx receipt, but I prefer to do it anyway
    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new()
      const gsnConfig = configureGSN({ relayHubAddress: relayHub.address })
      // @ts-ignore
      Object.keys(TestRecipient.events).forEach(function (topic) {
        // @ts-ignore
        RelayHub.network.events[topic] = TestRecipient.events[topic]
      })
      relayProvider = new RelayProvider(underlyingProvider, gsnConfig)

      // add accounts[0], accounts[1] and accounts[2] as worker, manager and owner
      await stakeManager.stakeForAddress(accounts[1], 1000, {
        value: ether('1'),
        from: accounts[2]
      })
      await stakeManager.authorizeHub(accounts[1], relayHub.address, { from: accounts[2] })
      await relayHub.addRelayWorkers([accounts[0]], {
        from: accounts[1]
      })

      // create desired transactions
      misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await misbehavingPaymaster.setHub(relayHub.address)
      await misbehavingPaymaster.deposit({ value: web3.utils.toWei('2', 'ether') })
      const { relayRequest, signature } = await prepareTransaction(testRecipient, accounts[0], accounts[0], misbehavingPaymaster.address, web3)
      await misbehavingPaymaster.setReturnInvalidErrorCode(true)
      const canRelayFailedReceiptTruffle = await relayHub.relayCall(relayRequest, signature, '0x', {
        from: accounts[0],
        gasPrice: '1'
      })
      expectEvent.inLogs(canRelayFailedReceiptTruffle.logs, 'CanRelayFailed')
      canRelayFailedTxReceipt = await web3.eth.getTransactionReceipt(canRelayFailedReceiptTruffle.tx)

      await misbehavingPaymaster.setReturnInvalidErrorCode(false)
      await misbehavingPaymaster.setRevertPreRelayCall(true)

      const innerTxFailedReceiptTruffle = await relayHub.relayCall(relayRequest, signature, '0x', {
        from: accounts[0],
        gasPrice: '1'
      })
      expectEvent.inLogs(innerTxFailedReceiptTruffle.logs, 'TransactionRelayed', {
        status: '2'
      })
      innerTxFailedReceipt = await web3.eth.getTransactionReceipt(innerTxFailedReceiptTruffle.tx)

      await misbehavingPaymaster.setRevertPreRelayCall(false)
      const innerTxSuccessReceiptTruffle = await relayHub.relayCall(relayRequest, signature, '0x', {
        from: accounts[0],
        gasPrice: '1'
      })
      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'SampleRecipientEmitted')
      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'TransactionRelayed', {
        status: '0'
      })
      innerTxSucceedReceipt = await web3.eth.getTransactionReceipt(innerTxSuccessReceiptTruffle.tx)

      const notRelayedTxReceiptTruffle = await testRecipient.emitMessage('hello world with gas')
      assert.equal(notRelayedTxReceiptTruffle.logs.length, 1)
      expectEvent.inLogs(notRelayedTxReceiptTruffle.logs, 'SampleRecipientEmitted')
      notRelayedTxReceipt = await web3.eth.getTransactionReceipt(notRelayedTxReceiptTruffle.tx)
    })

    it('should convert relayed transactions receipt with failed \'canRelay\' to be a failed transaction receipt', function () {
      assert.equal(canRelayFailedTxReceipt.status, true)
      const modifiedReceipt = relayProvider._getTranslatedGsnResponseResult(canRelayFailedTxReceipt)
      assert.equal(modifiedReceipt.status, false)
    })

    it('should convert relayed transactions receipt with failed internal transaction to be a failed transaction receipt', function () {
      assert.equal(innerTxFailedReceipt.status, true)
      const modifiedReceipt = relayProvider._getTranslatedGsnResponseResult(innerTxFailedReceipt)
      assert.equal(modifiedReceipt.status, false)
    })

    it('should not modify relayed transactions receipt with successful internal transaction', function () {
      assert.equal(innerTxSucceedReceipt.status, true)
      const modifiedReceipt = relayProvider._getTranslatedGsnResponseResult(innerTxSucceedReceipt)
      assert.equal(modifiedReceipt.status, true)
    })

    it('should not modify receipts for all other transactions ', function () {
      assert.equal(notRelayedTxReceipt.status, true)
      const modifiedReceipt = relayProvider._getTranslatedGsnResponseResult(notRelayedTxReceipt)
      assert.equal(modifiedReceipt.status, true)
    })
  })
})
