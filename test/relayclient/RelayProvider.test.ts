import { constants, ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import chaiAsPromised from 'chai-as-promised'
import Web3 from 'web3'
import { toBN } from 'web3-utils'

import { BaseTransactionReceipt, RelayProvider } from '../../src/relayclient/RelayProvider'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import {
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRecipientContract,
  TestRecipientInstance
} from '../../types/truffle-contracts'
import { Address } from '../../src/relayclient/types/Aliases'
import { defaultEnvironment } from '../../src/relayclient/types/Environments'
import { startRelay, stopRelay } from '../TestUtils'
import BadRelayClient from '../dummies/BadRelayClient'

import { getEip712Signature } from '../../src/common/Utils'
import RelayRequest from '../../src/common/EIP712/RelayRequest'
import TypedRequestData, { GsnRequestType } from '../../src/common/EIP712/TypedRequestData'

const { expect, assert } = require('chai').use(chaiAsPromised)

const RelayHub = artifacts.require('RelayHub')
const IForwarder = artifacts.require('IForwarder')
const Eip712Forwarder = artifacts.require('Eip712Forwarder')
const StakeManager = artifacts.require('StakeManager')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

const underlyingProvider = web3.currentProvider as HttpProvider

// TODO: once Utils.js is translated to TypeScript, move to Utils.ts
export async function prepareTransaction (testRecipient: TestRecipientInstance, account: Address, relayWorker: Address, paymaster: Address, web3: Web3): Promise<{ relayRequest: RelayRequest, signature: string }> {
  const testRecipientForwarderAddress = await testRecipient.getTrustedForwarder()
  const testRecipientForwarder = await IForwarder.at(testRecipientForwarderAddress)
  const senderNonce = (await testRecipientForwarder.getNonce(account)).toString()
  const relayRequest: RelayRequest = {
    request: {
      to: testRecipient.address,
      data: testRecipient.contract.methods.emitMessage('hello world').encodeABI(),
      from: account,
      nonce: senderNonce,
      value: '0',
      gas: '10000'
    },
    relayData: {
      pctRelayFee: '1',
      baseRelayFee: '1',
      gasPrice: '1',
      paymaster,
      forwarder: testRecipientForwarderAddress,
      relayWorker
    }
  }
  const dataToSign = new TypedRequestData(
    defaultEnvironment.chainId,
    testRecipientForwarderAddress,
    relayRequest
  )
  const signature = await getEip712Signature(
    web3,
    dataToSign
  )
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
  let forwarderAddress: Address

  before(async function () {
    web3 = new Web3(underlyingProvider)
    gasLess = await web3.eth.personal.newAccount('password')
    stakeManager = await StakeManager.new()
    relayHub = await RelayHub.new(stakeManager.address, constants.ZERO_ADDRESS)
    const forwarderInstance = await Eip712Forwarder.new()
    forwarderAddress = forwarderInstance.address
    await forwarderInstance.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    )

    const paymasterInstance = await TestPaymasterEverythingAccepted.new()
    paymaster = paymasterInstance.address
    await paymasterInstance.setRelayHub(relayHub.address)
    await paymasterInstance.deposit({ value: web3.utils.toWei('2', 'ether') })
    relayProcess = await startRelay(relayHub.address, stakeManager, {
      relaylog: process.env.relaylog,
      stake: 1e18,
      url: 'asd',
      relayOwner: accounts[1],
      ethereumNodeUrl: underlyingProvider.host
    })
  })

  after(async function () {
    await stopRelay(relayProcess)
  })

  describe('Use Provider to relay transparently', () => {
    let testRecipient: TestRecipientInstance
    before(async () => {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new(forwarderAddress)
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

      await testRecipient.emitMessage('hello again', {
        from: gasLess,
        gas: '100000',
        paymaster
      })
      const log: any = await eventPromise

      assert.equal(log.returnValues.message, 'hello again')
    })

    it('should fail if transaction failed', async () => {
      await expectRevert(testRecipient.testRevert({
        from: gasLess,
        paymaster
      }), 'always fail')
    })
  })

  describe('_ethSendTransaction', function () {
    const id = 777
    let testRecipient: TestRecipientInstance
    let gsnConfig: GSNConfig
    let jsonRpcPayload: JsonRpcPayload

    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new(forwarderAddress)

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
            forwarder: forwarderAddress,
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
      const gsnConfig = configureGSN({
        relayHubAddress: relayHub.address,
        stakeManagerAddress: stakeManager.address
      })
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
    let paymasterRejectedTxReceipt: BaseTransactionReceipt
    let innerTxFailedReceipt: BaseTransactionReceipt
    let innerTxSucceedReceipt: BaseTransactionReceipt
    let notRelayedTxReceipt: BaseTransactionReceipt
    let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
    const gas = toBN(3e6).toString()
    // It is not strictly necessary to make this test against actual tx receipt, but I prefer to do it anyway
    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new(forwarderAddress)
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
      await misbehavingPaymaster.setRelayHub(relayHub.address)
      await misbehavingPaymaster.deposit({ value: web3.utils.toWei('2', 'ether') })
      const { relayRequest, signature } = await prepareTransaction(testRecipient, accounts[0], accounts[0], misbehavingPaymaster.address, web3)
      await misbehavingPaymaster.setReturnInvalidErrorCode(true)
      const paymasterRejectedReceiptTruffle = await relayHub.relayCall(relayRequest, signature, '0x', gas, {
        from: accounts[0],
        gas,
        gasPrice: '1'
      })
      expectEvent.inLogs(paymasterRejectedReceiptTruffle.logs, 'TransactionRejectedByPaymaster')
      paymasterRejectedTxReceipt = await web3.eth.getTransactionReceipt(paymasterRejectedReceiptTruffle.tx)

      await misbehavingPaymaster.setReturnInvalidErrorCode(false)
      await misbehavingPaymaster.setRevertPreRelayCall(true)

      const innerTxFailedReceiptTruffle = await relayHub.relayCall(relayRequest, signature, '0x', gas, {
        from: accounts[0],
        gas,
        gasPrice: '1'
      })
      expectEvent.inLogs(innerTxFailedReceiptTruffle.logs, 'TransactionRelayed', {
        status: '2'
      })
      innerTxFailedReceipt = await web3.eth.getTransactionReceipt(innerTxFailedReceiptTruffle.tx)

      await misbehavingPaymaster.setRevertPreRelayCall(false)
      const innerTxSuccessReceiptTruffle = await relayHub.relayCall(relayRequest, signature, '0x', gas, {
        from: accounts[0],
        gas,
        gasPrice: '1'
      })
      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'TransactionRelayed', {
        status: '0'
      })
      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'SampleRecipientEmitted')
      innerTxSucceedReceipt = await web3.eth.getTransactionReceipt(innerTxSuccessReceiptTruffle.tx)

      const notRelayedTxReceiptTruffle = await testRecipient.emitMessage('hello world with gas')
      assert.equal(notRelayedTxReceiptTruffle.logs.length, 1)
      expectEvent.inLogs(notRelayedTxReceiptTruffle.logs, 'SampleRecipientEmitted')
      notRelayedTxReceipt = await web3.eth.getTransactionReceipt(notRelayedTxReceiptTruffle.tx)
    })

    it('should convert relayed transactions receipt with paymaster rejection to be a failed transaction receipt', function () {
      assert.equal(paymasterRejectedTxReceipt.status, true)
      const modifiedReceipt = relayProvider._getTranslatedGsnResponseResult(paymasterRejectedTxReceipt)
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

  describe('_getAccounts', function () {
    it('should append ephemeral accounts to the ones from the underlying provider', async function () {
      const relayProvider = new RelayProvider(underlyingProvider, {})
      const web3 = new Web3(relayProvider)
      const accountsBefore = await web3.eth.getAccounts()
      const newAccount = relayProvider.newAccount()
      const address = '0x982a8cbe734cb8c29a6a7e02a3b0e4512148f6f9'
      relayProvider.addAccount({
        privateKey: Buffer.from('d353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c', 'hex'),
        address
      })
      const accountsAfter = await web3.eth.getAccounts()
      const newAccounts = accountsAfter.filter(value => !accountsBefore.includes(value)).map(it => it.toLowerCase())
      assert.equal(newAccounts.length, 2)
      assert.include(newAccounts, address)
      assert.include(newAccounts, newAccount.address)
    })
  })

  describe('new contract deployment', function () {
    let TestRecipient: TestRecipientContract
    before(function () {
      TestRecipient = artifacts.require('TestRecipient')
      const gsnConfig = configureGSN({
        relayHubAddress: relayHub.address,
        stakeManagerAddress: stakeManager.address
      })
      const websocketProvider = new Web3.providers.WebsocketProvider(underlyingProvider.host)
      relayProvider = new RelayProvider(websocketProvider as any, gsnConfig)
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)
    })

    it('should throw on calling .new without useGSN: false', async function () {
      await expect(TestRecipient.new(forwarderAddress)).to.be.eventually.rejectedWith('GSN cannot relay contract deployment transactions. Add {from: accountWithEther, useGSN: false}.')
    })

    it('should deploy a contract without GSN on calling .new with useGSN: false', async function () {
      const testRecipient = await TestRecipient.new(forwarderAddress, {
        from: accounts[0],
        useGSN: false
      })
      const receipt = await web3.eth.getTransactionReceipt(testRecipient.transactionHash)
      assert.equal(receipt.from.toLowerCase(), accounts[0].toLowerCase())
    })
  })
})
