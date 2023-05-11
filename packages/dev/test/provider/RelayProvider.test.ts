/* eslint-disable no-void */
import Web3 from 'web3'
import chaiAsPromised from 'chai-as-promised'
import sinon from 'sinon'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'
import { TypedMessage } from '@metamask/eth-sig-util'
import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { toBN } from 'web3-utils'
import { toChecksumAddress } from 'ethereumjs-util'
import { StaticJsonRpcProvider, TransactionReceipt } from '@ethersproject/providers'

import { registerForwarderForGsn } from '@opengsn/cli/dist/ForwarderUtil'
import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import { defaultGsnConfig, GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import {
  RelayHubInstance,
  PenalizerInstance,
  StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRecipientContract,
  TestRecipientInstance,
  TestTokenInstance,
  TestUtilInstance
} from '@opengsn/contracts/types/truffle-contracts'
import {
  Address,
  JsonRpcPayload,
  JsonRpcResponse,
  RelayRequest,
  constants,
  defaultEnvironment,
  getEcRecoverMeta,
  getEip712Signature
} from '@opengsn/common'

import { deployHub, emptyBalance, encodeRevertReason, hardhatNodeChainId, startRelay, stopRelay } from '../TestUtils'
import { BadRelayClient } from '../dummies/BadRelayClient'

import {
  EIP712DomainType,
  MessageTypeProperty,
  MessageTypes,
  TypedRequestData
} from '@opengsn/common/dist/EIP712/TypedRequestData'

const { expect, assert } = require('chai').use(chaiAsPromised)

const IForwarder = artifacts.require('IForwarder')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestToken = artifacts.require('TestToken')
const TestUtils = artifacts.require('TestUtil')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

// @ts-ignore
const currentProviderHost = web3.currentProvider.host
const underlyingProvider = new StaticJsonRpcProvider(currentProviderHost)

const paymasterData = '0x'
const clientId = '1'

const config: Partial<GSNConfig> = { loggerConfiguration: { logLevel: 'error' }, skipErc165Check: true }

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
      gas: '10000',
      validUntilTime: '0'
    },
    relayData: {
      transactionCalldataGasUsed: '0',
      maxFeePerGas: '4494095',
      maxPriorityFeePerGas: '4494095',
      paymaster,
      paymasterData,
      clientId,
      forwarder: testRecipientForwarderAddress,
      relayWorker
    }
  }
  const dataToSign = new TypedRequestData(
    defaultGsnConfig.domainSeparatorName,
    hardhatNodeChainId,
    testRecipientForwarderAddress,
    relayRequest
  )
  const signature = await getEip712Signature(
    underlyingProvider.getSigner(),
    dataToSign
  )
  return {
    relayRequest,
    signature
  }
}

contract('RelayProvider', function (accounts) {
  const stake = ether('1')

  let web3: Web3
  let gasLess: Address
  let relayHub: RelayHubInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let testToken: TestTokenInstance
  let paymasterInstance: TestPaymasterEverythingAcceptedInstance
  let paymaster: Address
  let relayProcess: ChildProcessWithoutNullStreams
  let relayProvider: RelayProvider
  let forwarderAddress: Address

  before(async function () {
    web3 = new Web3(currentProviderHost)
    testToken = await TestToken.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString())
    const forwarderInstance = await Forwarder.new()
    forwarderAddress = forwarderInstance.address
    await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, forwarderInstance)

    paymasterInstance = await TestPaymasterEverythingAccepted.new()
    paymaster = paymasterInstance.address
    await paymasterInstance.setTrustedForwarder(forwarderAddress)
    await paymasterInstance.setRelayHub(relayHub.address)
    await paymasterInstance.deposit({ value: web3.utils.toWei('2', 'ether') })
    config.paymasterAddress = paymaster
    await testToken.mint(stake, { from: accounts[1] })
    await testToken.approve(stakeManager.address, stake, { from: accounts[1] })
    relayProcess = await startRelay(relayHub.address, testToken, stakeManager, {
      relaylog: process.env.relaylog,
      initialReputation: 100,
      stake: stake.toString(),
      relayOwner: accounts[1],
      ethereumNodeUrl: currentProviderHost
    })
  })

  after(async function () {
    await stopRelay(relayProcess)
  })

  afterEach(async function () {
    await web3.eth.sendTransaction({ from: accounts[0], to: accounts[0], maxPriorityFeePerGas: 0 })
  })

  describe('Use Provider to relay transparently', () => {
    let testRecipient: TestRecipientInstance
    before(async () => {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new(forwarderAddress)
      relayProvider = await RelayProvider.newWeb3Provider({
        provider: underlyingProvider,
        config: {
          paymasterAddress: paymasterInstance.address,
          ...config
        }
      })
      // NOTE: in real application its enough to set the provider in web3.
      // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
      // so changing the global one is not enough.
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)
      gasLess = accounts[10]
      await emptyBalance(gasLess, accounts[0])
      console.log('gasLess is', gasLess)
    })

    it('should relay transparently', async function () {
      const res = await testRecipient.emitMessage('hello world', {
        from: gasLess,
        gasPrice: '0x51f4d5c00',
        gas: '100000',
        // @ts-ignore
        paymaster
      })

      expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
        message: 'hello world',
        realSender: gasLess,
        msgValue: '0',
        balance: '0'
      })
    })

    it('should initiate lookup for forgotten transaction based on its identifier having a prefix', async function () {
      // @ts-ignore
      const stubGet = sinon.stub(relayProvider.submittedRelayRequests, 'get').returns(undefined)
      const pingResponse = await relayProvider.relayClient.dependencies.httpClient.getPingResponse('http://127.0.0.1:8090')
      const res = await testRecipient.emitMessage('hello world', {
        from: gasLess,
        gasPrice: (parseInt(pingResponse.minMaxPriorityFeePerGas) * 2).toString(),
        gas: '100000',
        // @ts-ignore
        paymaster
      })

      expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
        message: 'hello world',
        realSender: gasLess,
        msgValue: '0',
        balance: '0'
      })
      stubGet.restore()
    })

    it('should relay transparently with value', async function () {
      const value = 1e18.toString()
      // note: this test only validates we process the "value" parameter of the request properly.
      // a real use-case should have a paymaster to transfer the value into the forwarder,
      // probably by swapping user's tokens into eth.
      await web3.eth.sendTransaction({
        from: accounts[0],
        to: forwarderAddress,
        value
      })
      const res = await testRecipient.emitMessage('hello world', {
        from: gasLess,
        gasPrice: '0x61f4d5c00',
        value,
        gas: '100000',
        // @ts-ignore
        paymaster
      })

      expectEvent.inLogs(res.logs, 'SampleRecipientEmitted', {
        message: 'hello world',
        realSender: gasLess,
        msgValue: value,
        balance: value
      })
    })

    // TODO: enable event subscriptions
    it.skip('should subscribe to events', async () => {
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
        gasPrice: '0x71f4d5c00',
        // @ts-ignore
        paymaster
      })
      const log: any = await eventPromise

      assert.equal(log.returnValues.message, 'hello again')
    })

    // note that the revert reason here was discovered via some truffle/ganache magic (see truffle/reason.js)
    // this is not the way the revert reason is being reported by GSN solidity contracts
    it('should fail if transaction failed', async () => {
      await expectRevert(testRecipient.testRevert({
        from: accounts[0],
        // @ts-ignore
        paymaster
      }), 'always fail')
    })
  })

  describe('_ethSendTransaction', function () {
    const id = 777
    let testRecipient: TestRecipientInstance
    let jsonRpcPayload: JsonRpcPayload

    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new(forwarderAddress)

      // call to emitMessage('hello world')
      jsonRpcPayload = {
        jsonrpc: '2.0',
        id,
        method: 'eth_sendTransaction',
        params: [
          {
            from: gasLess,
            gas: '0x186a0',
            gasPrice: '0x81f4d5c00',
            paymaster,
            forwarder: forwarderAddress,
            to: testRecipient.address,
            data: testRecipient.contract.methods.emitMessage('hello world').encodeABI()
          }
        ]
      }
    })

    it('should call callback with error if relayTransaction throws', async function () {
      const badRelayClient = new BadRelayClient(true, false, {
        config: {
          paymasterAddress: paymasterInstance.address,
          ...config
        },
        provider: underlyingProvider
      })
      const relayProvider = new RelayProvider(badRelayClient)
      // @ts-ignore
      await relayProvider.init()
      const promisified = new Promise((resolve, reject) => {
        void relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null): void => {
          reject(error)
        })
      })
      await expect(promisified).to.be.eventually.rejectedWith(`Rejected relayTransaction call with reason: ${BadRelayClient.message}`)
    })

    it('should call callback with error containing relaying results dump if relayTransaction does not return a transaction object', async function () {
      const badRelayClient = new BadRelayClient(false, true, { provider: underlyingProvider, config })
      const relayProvider = new RelayProvider(badRelayClient)
      // @ts-ignore
      await relayProvider.init()
      const promisified = new Promise((resolve, reject) => {
        void relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null): void => {
          reject(error)
        })
      })
      await expect(promisified).to.be.eventually.rejectedWith('Failed to relay call. Results:')
    })

    it('should convert a returned transaction to a compatible rpc transaction hash response', async function () {
      const relayProvider = await RelayProvider.newWeb3Provider({
        provider: underlyingProvider,
        config: {
          paymasterAddress: paymasterInstance.address,
          ...config
        }
      })
      const response: JsonRpcResponse = await new Promise((resolve, reject) => {
        void relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null, result: JsonRpcResponse | undefined): void => {
          if (error != null) {
            reject(error)
          } else {
            // @ts-ignore
            resolve(result)
          }
        })
      })
      assert.equal(id, response.id)
      assert.equal('2.0', response.jsonrpc)
      // I don't want to hard-code tx hash, so for now just checking it is there
      assert.equal(66, response.result.length)
    })
    it('should call _fixGasFees()', async function () {
      const spyFixGasFees = sinon.spy(relayProvider, '_fixGasFees')
      await new Promise((resolve, reject) => {
        void relayProvider._ethSendTransaction(jsonRpcPayload, (error: Error | null, result: JsonRpcResponse | undefined): void => {
          if (error != null) {
            reject(error)
          } else {
            // @ts-ignore
            resolve(result)
          }
        })
      })
      sinon.assert.calledOnce(spyFixGasFees)
      sinon.restore()
    })
    describe('_fixGasFees', function () {
      it('should set maxFeePerGas and maxPriorityFeePerGas to gasPrice if only gasPrice given', async function () {
        const gasPrice = 1234
        const fixedTxDetails = await relayProvider._fixGasFees({ gasPrice })
        assert.equal(gasPrice, fixedTxDetails.maxFeePerGas)
        assert.equal(gasPrice, fixedTxDetails.maxPriorityFeePerGas)
        // @ts-ignore
        assert.notExists(fixedTxDetails.gasPrice)
      })
      it('should return only maxFeePerGas and maxPriorityFeePerGas', async function () {
        const maxFeePerGas = 123
        const maxPriorityFeePerGas = 456
        const gasPrice = 789
        const fixedTxDetails = await relayProvider._fixGasFees({ maxFeePerGas, maxPriorityFeePerGas, gasPrice })
        assert.equal(maxFeePerGas, fixedTxDetails.maxFeePerGas)
        assert.equal(maxPriorityFeePerGas, fixedTxDetails.maxPriorityFeePerGas)
        // @ts-ignore
        assert.notExists(fixedTxDetails.gasPrice)
      })
      it('should call calculateGasFees if no fees given', async function () {
        const spyCalculate = sinon.spy(relayProvider, 'calculateGasFees')
        await relayProvider._fixGasFees({})
        sinon.assert.calledOnce(spyCalculate)
        sinon.restore()
      })
      it('should throw error if only one of maxPriorityFeePerGas/maxFeePerGas given', async function () {
        await expect(relayProvider._fixGasFees({ maxFeePerGas: 1 })).to.be.eventually.rejectedWith('Relay Provider: cannot provide only one of maxFeePerGas and maxPriorityFeePerGas')
        await expect(relayProvider._fixGasFees({ maxPriorityFeePerGas: 1 })).to.be.eventually.rejectedWith('Relay Provider: cannot provide only one of maxFeePerGas and maxPriorityFeePerGas')
      })
    })
  })

  // TODO: most of this code is copy-pasted from the RelayHub.test.ts. Maybe extract better utils?
  describe('_getTranslatedGsnResponseResult', function () {
    let relayProvider: RelayProvider
    let testRecipient: TestRecipientInstance
    let paymasterRejectedTxReceipt: TransactionReceipt
    let innerTxFailedReceipt: TransactionReceipt
    let innerTxSucceedReceipt: TransactionReceipt
    let notRelayedTxReceipt: TransactionReceipt
    let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
    const gas = toBN(3e6).toString()
    // It is not strictly necessary to make this test against actual tx receipt, but I prefer to do it anyway
    before(async function () {
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new(forwarderAddress)

      // @ts-ignore
      Object.keys(TestRecipient.events).forEach(function (topic) {
        // @ts-ignore
        relayHub.constructor.network.events[topic] = TestRecipient.events[topic]
      })

      await stakeManager.setRelayManagerOwner(accounts[2], { from: accounts[1] })

      await testToken.mint(stake, { from: accounts[2] })
      await testToken.approve(stakeManager.address, stake, { from: accounts[2] })
      // add accounts[0], accounts[1] and accounts[2] as worker, manager and owner
      await stakeManager.stakeForRelayManager(testToken.address, accounts[1], 15000, stake, {
        from: accounts[2]
      })
      await stakeManager.authorizeHubByOwner(accounts[1], relayHub.address, { from: accounts[2] })
      await relayHub.addRelayWorkers([accounts[0]], {
        from: accounts[1]
      })

      // create desired transactions
      misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await misbehavingPaymaster.setTrustedForwarder(forwarderAddress)
      await misbehavingPaymaster.setRelayHub(relayHub.address)
      await misbehavingPaymaster.deposit({ value: web3.utils.toWei('2', 'ether') })
      const {
        relayRequest,
        signature
      } = await prepareTransaction(testRecipient, accounts[0], accounts[0], misbehavingPaymaster.address, web3)
      await misbehavingPaymaster.setReturnInvalidErrorCode(true)
      const paymasterRejectedReceiptTruffle = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, '0x', {
        from: accounts[0],
        gas,
        gasPrice: '4494095'
      })
      expectEvent.inLogs(paymasterRejectedReceiptTruffle.logs, 'TransactionRejectedByPaymaster')
      paymasterRejectedTxReceipt = await underlyingProvider.getTransactionReceipt(paymasterRejectedReceiptTruffle.tx)

      await misbehavingPaymaster.setReturnInvalidErrorCode(false)
      await misbehavingPaymaster.setRevertPreRelayCall(true)

      const gsnConfig: Partial<GSNConfig> = {
        paymasterAddress: misbehavingPaymaster.address,
        loggerConfiguration: { logLevel: 'error' }
      }
      relayProvider = await RelayProvider.newWeb3Provider({ provider: underlyingProvider, config: gsnConfig })

      const innerTxFailedReceiptTruffle = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, '0x', {
        from: accounts[0],
        gas,
        gasPrice: '4494095'
      })
      expectEvent.inLogs(innerTxFailedReceiptTruffle.logs, 'TransactionRejectedByPaymaster', {
        reason: encodeRevertReason('You asked me to revert, remember?')
      })
      innerTxFailedReceipt = await underlyingProvider.getTransactionReceipt(innerTxFailedReceiptTruffle.tx)

      await misbehavingPaymaster.setRevertPreRelayCall(false)
      const innerTxSuccessReceiptTruffle = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, '0x', {
        from: accounts[0],
        gas,
        gasPrice: '4494095'
      })
      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'TransactionRelayed', {
        status: '0'
      })
      expectEvent.inLogs(innerTxSuccessReceiptTruffle.logs, 'SampleRecipientEmitted')
      innerTxSucceedReceipt = await underlyingProvider.getTransactionReceipt(innerTxSuccessReceiptTruffle.tx)

      const notRelayedTxReceiptTruffle = await testRecipient.emitMessage('hello world with gas')
      assert.equal(notRelayedTxReceiptTruffle.logs.length, 1)
      expectEvent.inLogs(notRelayedTxReceiptTruffle.logs, 'SampleRecipientEmitted')
      notRelayedTxReceipt = await underlyingProvider.getTransactionReceipt(notRelayedTxReceiptTruffle.tx)
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
      const relayProvider = await RelayProvider.newWeb3Provider({
        provider: underlyingProvider,
        config: {
          paymasterAddress: paymasterInstance.address,
          loggerConfiguration: { logLevel: 'error' }
        }
      })
      const web3 = new Web3(relayProvider)
      const accountsBefore = await web3.eth.getAccounts()
      const newAccount = relayProvider.newAccount()
      const address = toChecksumAddress('0x982a8cbe734cb8c29a6a7e02a3b0e4512148f6f9')
      relayProvider.addAccount('0xd353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c')
      const accountsAfter = await web3.eth.getAccounts()
      const newAccounts = accountsAfter.filter(value => !accountsBefore.includes(value))
      assert.equal(newAccounts.length, 2)
      assert.include(newAccounts, address)
      assert.include(newAccounts, newAccount.address)
    })
  })

  describe('new contract deployment', function () {
    let TestRecipient: TestRecipientContract
    before(async function () {
      TestRecipient = artifacts.require('TestRecipient')
      const gsnConfig: Partial<GSNConfig> = {
        loggerConfiguration: { logLevel: 'error' },
        paymasterAddress: paymasterInstance.address
      }
      relayProvider = await RelayProvider.newWeb3Provider({
        provider: underlyingProvider,
        config: gsnConfig
      })
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)
    })

    it('should throw on calling .new without useGSN: false', async function () {
      await expect(TestRecipient.new(forwarderAddress)).to.be.eventually.rejectedWith('GSN cannot relay contract deployment transactions. Add {from: accountWithEther, useGSN: false}.')
    })

    it('should deploy a contract without GSN on calling .new with useGSN: false', async function () {
      const testRecipient = await TestRecipient.new(forwarderAddress, {
        from: accounts[0],
        // @ts-ignore
        useGSN: false
      })
      const receipt = await web3.eth.getTransactionReceipt(testRecipient.transactionHash)
      assert.equal(receipt.from.toLowerCase(), accounts[0].toLowerCase())
    })
  })

  describe('signing with ephemeral key', function () {
    let testUtils: TestUtilInstance
    let account: Address
    let web3eph: Web3

    before(async function () {
      testUtils = await TestUtils.new()
      relayProvider = await RelayProvider.newWeb3Provider({
        provider: underlyingProvider,
        config: {
          paymasterAddress: paymasterInstance.address
        }
      });
      ({ address: account } = relayProvider.newAccount())
      web3eph = new Web3(relayProvider)
    })

    describe('eth_sign', function () {
      it('should sign using ephemeral key', async function () {
        const message = 'this message is signed with the ephemeral key'
        const signature = await web3eph.eth.sign(message, account)
        const recover = getEcRecoverMeta(message, signature)
        const onChainRecover = await testUtils._ecrecover(message, signature)
        assert.equal(onChainRecover.toLowerCase(), account.toLowerCase(), 'on-chain ecrecover failed')
        assert.equal(recover.toLowerCase(), account.toLowerCase(), 'off-chain ecrecover failed')
      })

      describe('eth_signTransaction', function () {
        it('should sign using ephemeral key', async function () {
          const transactionConfig: TransactionConfig = {
            from: account,
            to: account,
            nonce: 0,
            gasPrice: 1e9,
            gas: 1000000,
            value: 0,
            data: '0xdeadbeef'
          }
          const transactionConfig1559: TransactionConfig = {
            from: account,
            to: account,
            nonce: 1,
            maxFeePerGas: 1e9,
            gas: 1000000,
            maxPriorityFeePerGas: 1,
            value: 0,
            data: '0xdeadbeef'
          }
          const res = await web3eph.eth.signTransaction(transactionConfig)
          const res1559 = await web3eph.eth.signTransaction(transactionConfig1559)
          await web3.eth.sendTransaction({ from: accounts[0], to: account, value: 1e18 })
          const rec = await web3.eth.sendSignedTransaction(res.raw)
          const rec1559 = await web3.eth.sendSignedTransaction(res1559.raw)
          assert.equal(rec.from.toLowerCase(), account.toLowerCase())
          assert.equal(rec1559.from.toLowerCase(), account.toLowerCase())
          assert.equal(rec.gasUsed, 21064)
          assert.equal(rec.gasUsed, 21064)
        })

        describe('eth_signTypedData', function () {
          // TODO: once ERC-712 is added to Web3.js update this test
          interface Test712 extends MessageTypes {
            TestValueType: MessageTypeProperty[]
          }

          const dataToSign: TypedMessage<Test712> = {
            types: { EIP712Domain: EIP712DomainType, TestValueType: [{ name: 'testValue', type: 'string' }] },
            primaryType: 'TestValueType',
            domain: {
              name: 'domainName',
              version: 'domainVer',
              chainId: 1337,
              verifyingContract: account
            },
            message: {
              testValue: 'hello 712'
            }
          }
          it('should sign using ephemeral key', async function () {
            dataToSign.domain.verifyingContract = account
            const paramBlock = {
              method: 'eth_signTypedData',
              params: [account, dataToSign],
              jsonrpc: '2.0',
              id: Date.now()
            }
            const promisified = new Promise<any>((resolve, reject) => {
              (web3eph.currentProvider as HttpProvider).send(paramBlock, (error?: Error | null, result?: JsonRpcResponse): void => {
                if (error != null) {
                  reject(error)
                } else {
                  resolve(result)
                }
              })
            })
            const res = await promisified
            assert.equal(res.result.length, 132)
          })

          it('should sign using custom signature callback', async function () {
            dataToSign.domain.verifyingContract = account
            const paramBlock = {
              method: 'eth_signTypedData',
              params: [account, dataToSign],
              jsonrpc: '2.0',
              id: Date.now()
            }
            const relayProvider = await RelayProvider.newWeb3Provider({
              provider: underlyingProvider,
              config: { paymasterAddress: paymasterInstance.address },
              overrideDependencies: {
                asyncSignTypedData: async function (signedData: TypedMessage<any>, from: Address) {
                  return await Promise.resolve(`Valid signature for address ${from}`)
                }
              }
            })
            const web3custom = new Web3(relayProvider)
            const promisified = new Promise<any>((resolve, reject) => {
              (web3custom.currentProvider as HttpProvider).send(paramBlock, (error?: Error | null, result?: JsonRpcResponse): void => {
                if (error != null) {
                  reject(error)
                } else {
                  resolve(result)
                }
              })
            })
            const res = await promisified
            assert.equal(res.result, `Valid signature for address ${account}`)
          })
        })
      })
    })
  })
})
