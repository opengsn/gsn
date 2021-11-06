// @ts-ignore
import abiDecoder from 'abi-decoder'
import { HttpProvider } from 'web3-core'
import { toHex } from 'web3-utils'

import { BatchRelayClient } from '@opengsn/provider/dist/bls/BatchRelayClient'
import { BatchRelayProvider } from '@opengsn/provider/dist/bls/BatchRelayProvider'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { CacheDecoderInteractor } from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import {
  _sanitizeAbiDecoderEvent,
  constants,
  defaultEnvironment,
  getRelayRequestID,
  GSNBatchingContractsDeployment
} from '@opengsn/common'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { cloneRelayRequest, RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'

import {
  TestPaymasterConfigurableMisbehaviorInstance,
  BLSTestBatchGatewayInstance,
  TestRecipientInstance, RelayHubInstance
} from '@opengsn/contracts'

import { deployHub } from '../TestUtils'

const Penalizer = artifacts.require('Penalizer')
const StakeManager = artifacts.require('StakeManager')
const TestRecipient = artifacts.require('TestRecipient')
const GatewayForwarder = artifacts.require('GatewayForwarder')
const BLSTestBatchGateway = artifacts.require('BLSTestBatchGateway')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

const underlyingProvider = web3.currentProvider as HttpProvider
const config: Partial<GSNConfig> = { loggerConfiguration: { logLevel: 'error' } }

// we want to test the abi decoder that is not necessary aware of the events
function clearAbiDecoder (): void {
  abiDecoder.removeABI(abiDecoder.getABIs())
}

contract.only('BatchRelayProvider', function ([from, relayWorker]: string[]) {
  let relayHub: RelayHubInstance
  let paymaster: TestPaymasterConfigurableMisbehaviorInstance
  let testRecipient: TestRecipientInstance
  let testBatchGateway: BLSTestBatchGatewayInstance

  let cacheDecoderInteractor: CacheDecoderInteractor
  let batchClient: BatchRelayClient
  let batchProvider: BatchRelayProvider
  let batchingContractsDeployment: GSNBatchingContractsDeployment
  let sharedRelayRequestData: RelayRequest

  before(async function () {
    clearAbiDecoder()

    // TODO: de-duplicate GSN deployment code
    testBatchGateway = await BLSTestBatchGateway.new()
    const stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    const penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    relayHub = await deployHub(stakeManager.address, penalizer.address, testBatchGateway.address)
    const forwarderInstance = await GatewayForwarder.new(relayHub.address)
    await registerForwarderForGsn(forwarderInstance)

    paymaster = await TestPaymasterConfigurableMisbehavior.new()
    await relayHub.depositFor(paymaster.address, { value: (2e18).toString() })
    await paymaster.setTrustedForwarder(forwarderInstance.address)
    await paymaster.setRelayHub(relayHub.address)
    // TODO: de-duplicate GSN deployment code
    testRecipient = await TestRecipient.new(forwarderInstance.address)

    // @ts-ignore
    batchingContractsDeployment = {}
    cacheDecoderInteractor = new CacheDecoderInteractor({ provider: underlyingProvider, batchingContractsDeployment })
    batchClient = new BatchRelayClient({
      config: {
        paymasterAddress: paymaster.address,
        ...config
      },
      provider: underlyingProvider
    }, cacheDecoderInteractor)
    await batchClient.init()
    batchProvider = new BatchRelayProvider(batchClient)

    const baseRelayFee = '10000'
    const pctRelayFee = '10'
    const gasPrice = 1e9.toString()
    const gasLimit = '1000000'
    const senderNonce = '0'
    const paymasterData = '0x'
    const clientId = '1'

    sharedRelayRequestData = {
      request: {
        to: testRecipient.address,
        data: '',
        from,
        nonce: senderNonce,
        value: '0',
        gas: gasLimit,
        validUntil: '0'
      },
      relayData: {
        pctRelayFee,
        baseRelayFee,
        transactionCalldataGasUsed: 7e6.toString(),
        gasPrice,
        relayWorker,
        forwarder: forwarderInstance.address,
        paymaster: paymaster.address,
        paymasterData,
        clientId
      }
    }
  })

  context('#_createTransactionReceiptForBatchId()', function () {
    it('should return null if the request can still be mined', async function () {
      const relayRequestID = toHex(constants.MAX_UINT256)
      // make provider think it submitted transaction with this ID to the Batch Relay Server and it is still valid
      const submissionDetails = { submissionBlock: 1, validUntil: '1000000' }
      batchClient.submittedRelayRequests.set(relayRequestID, submissionDetails)

      const result = await batchProvider._createTransactionReceiptForBatchId(relayRequestID, submissionDetails)
      assert.isNull(result, 'must return null')
    })

    it('should return a reverted transaction receipt if the request is expired', async function () {
      const relayRequestID = toHex(constants.MAX_UINT256)
      // make provider think it submitted transaction with this ID to the Batch Relay Server and it is still valid
      const submissionDetails = { submissionBlock: 1, validUntil: '1' }
      batchClient.submittedRelayRequests.set(relayRequestID, submissionDetails)

      const result = await batchProvider._createTransactionReceiptForBatchId(relayRequestID, submissionDetails)
      assert.equal(result?.status, false)
      assert.equal(result?.logs.length, 0)
      // TODO later: gas price, gas limit should be preserved; don't think these fields matter for Web clients, though
    })

    it.skip('should return a reverted transaction receipt if the request is rejected by paymaster', async function () {
      // create a batch transaction that is rejected by paymaster
      await paymaster.setRevertPreRelayCall(true)
      // TODO
    })

    it.skip('should return a reverted transaction receipt if the request has reverted in recipient', async function () { })
    it.only('should return a valid transaction receipt only with the events emitted for this batch item', async function () {
      // create a batch of two transactions with different emitted strings
      const m1p1 = 'This is first part of first message'
      const m1p2 = 'This is second part of first message'
      const m2p1 = 'This is first part of second message'
      const m2p2 = 'This is second part of second message'
      const data1 = testRecipient.contract.methods.emitTwoMessages(m1p1, m1p2).encodeABI()
      const data2 = testRecipient.contract.methods.emitTwoMessages(m2p1, m2p2).encodeABI()
      const relayRequest1 = cloneRelayRequest(sharedRelayRequestData, { request: { data: data1, nonce: '0' } })
      const relayRequest2 = cloneRelayRequest(sharedRelayRequestData, { request: { data: data2, nonce: '1' } })
      const testBatch = [
        relayRequest1,
        relayRequest2
      ]

      const batchReceipt = await testBatchGateway.sendBatch(relayHub.address, testBatch, constants.MAX_UINT256)
      assert.equal(batchReceipt.logs.length, 6, 'wrong number of events')

      const relayRequestID1 = getRelayRequestID(relayRequest1)
      const relayRequestID2 = getRelayRequestID(relayRequest2)

      const submissionDetails = { submissionBlock: 1, validUntil: '1' }
      const result1 = await batchProvider._createTransactionReceiptForBatchId(relayRequestID1, submissionDetails)
      const result2 = await batchProvider._createTransactionReceiptForBatchId(relayRequestID2, submissionDetails)
      clearAbiDecoder()

      // make provider think it submitted transaction with this ID to the Batch Relay Server and it is still valid
      async function checkEvent (result: TransactionReceipt | null, p1: string, p2: string): Promise<void> {
        // extract local function
        assert.equal(result?.status, true)
        assert.equal(result?.logs.length, 2, 'wrong number of events')
        // @ts-ignore
        abiDecoder.addABI(TestRecipient.abi)
        const decodedLogs = abiDecoder.decodeLogs(result?.logs).map(_sanitizeAbiDecoderEvent)
        assert.equal(decodedLogs[0].name, 'SampleRecipientEmitted') // abi.decode
        assert.equal(decodedLogs[0].args.message, p1) // abi.decode
        assert.equal(decodedLogs[1].name, 'SampleRecipientEmittedSomethingElse') // abi.decode
        assert.equal(decodedLogs[1].args.message, p2)
      }

      await checkEvent(result1, m1p1, m1p2)
      await checkEvent(result2, m2p1, m2p2)
    })

    // TODO
    it.skip('should return a reverted transaction receipt if the RelayHub:relayCall() reverts')
  })
})
