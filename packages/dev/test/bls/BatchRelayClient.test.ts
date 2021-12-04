import { HttpProvider } from 'web3-core'
import sinon, { SinonStub } from 'sinon'

import { BatchRelayClient } from '@opengsn/provider/dist/bls/BatchRelayClient'
import {
  CacheDecoderInteractor,
  CachingGasConstants
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { GSNConfig } from '@opengsn/provider'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { ERC20CacheDecoderInstance, TestPaymasterEverythingAcceptedInstance } from '@opengsn/contracts'
import { constants, ContractInteractor, defaultEnvironment, PingResponse } from '@opengsn/common'

import { deployBatchingContractsForHub } from './BatchTestUtils'
import { deployHub } from '../TestUtils'
import { createClientLogger } from '@opengsn/provider/dist/ClientWinstonLogger'
import { ObjectMap } from '@opengsn/common/dist/types/Aliases'
import { ICalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ICalldataCacheDecoderInteractor'
import { ERC20CalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ERC20CalldataCacheDecoderInteractor'

const TestToken = artifacts.require('TestToken')
const StakeManager = artifacts.require('StakeManager')
const GatewayForwarder = artifacts.require('GatewayForwarder')
const ERC20CacheDecoder = artifacts.require('ERC20CacheDecoder')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

const underlyingProvider = web3.currentProvider as HttpProvider
const config: Partial<GSNConfig> = { loggerConfiguration: { logLevel: 'error' } }

contract.only('BatchRelayClient', function ([from]: string[]) {
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let erc20CacheDecoder: ERC20CacheDecoderInstance

  let spyOnRelayTransactionInBatch: SinonStub
  let batchClient: BatchRelayClient
  let gsnTransactionDetails: GsnTransactionDetails
  let pingResponse: PingResponse

  before(async function () {
    const forwarderInstance = await GatewayForwarder.new(constants.ZERO_ADDRESS)
    const stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    const relayHub = await deployHub(stakeManager.address, constants.ZERO_ADDRESS)
    paymaster = await TestPaymasterEverythingAccepted.new()
    await paymaster.setRelayHub(relayHub.address)
    await paymaster.setTrustedForwarder(forwarderInstance.address)
    const testToken = await TestToken.new()
    erc20CacheDecoder = await ERC20CacheDecoder.new()

    const batchingContractsInstances = await deployBatchingContractsForHub(relayHub.address, forwarderInstance.address)
    const batchingContractsDeployment = {
      batchGateway: batchingContractsInstances.batchGateway.address,
      batchGatewayCacheDecoder: batchingContractsInstances.batchGatewayCacheDecoder.address,
      authorizationsRegistrar: batchingContractsInstances.authorizationsRegistrar.address
    }
    const cachingGasConstants: CachingGasConstants = {
      authorizationCalldataBytesLength: 1,
      authorizationStorageSlots: 1,
      gasPerSlotL2: 1
    }

    const contractInteractor = await new ContractInteractor({
      environment: defaultEnvironment,
      provider: web3.currentProvider as HttpProvider,
      logger: createClientLogger(),
      maxPageSize: Number.MAX_SAFE_INTEGER,
      deployment: { paymasterAddress: paymaster.address }
    }).init()

    const calldataCacheDecoderInteractors: ObjectMap<ICalldataCacheDecoderInteractor> = {}
    calldataCacheDecoderInteractors[testToken.address.toLowerCase()] = new ERC20CalldataCacheDecoderInteractor({
      provider: underlyingProvider,
      erc20CacheDecoderAddress: erc20CacheDecoder.address.toLowerCase()
    })
    const cacheDecoderInteractor = new CacheDecoderInteractor({
      calldataCacheDecoderInteractors,
      provider: underlyingProvider,
      contractInteractor,
      batchingContractsDeployment,
      cachingGasConstants
    })
    await cacheDecoderInteractor.init()
    batchClient = new BatchRelayClient({
      config: {
        paymasterAddress: paymaster.address,
        ...config
      },
      provider: underlyingProvider
    }, batchingContractsDeployment, cacheDecoderInteractor)

    await batchClient.init()

    pingResponse = {
      relayWorkerAddress: constants.ZERO_ADDRESS,
      relayManagerAddress: constants.ZERO_ADDRESS,
      relayHubAddress: relayHub.address,
      ownerAddress: constants.ZERO_ADDRESS,
      minGasPrice: '0x0',
      maxAcceptanceBudget: '0xffffff',
      // networkId? : 'IntString',
      // chainId? : 'IntString',
      validUntil: '1000000000',
      ready: true,
      version: '2.3.0'
    }
    const relayInfo: RelayInfo = {
      pingResponse,
      relayInfo: {
        relayUrl: 'http://relay.url.string',
        relayManager: constants.ZERO_ADDRESS,
        baseRelayFee: '0x0',
        pctRelayFee: '0x0'
      }
    }

    sinon.stub(batchClient.relaySelectionManager, 'selectNextRelay').onFirstCall().returns(Promise.resolve(relayInfo))
    sinon.stub(batchClient.relaySelectionManager, 'relaysLeft').onFirstCall().returns([relayInfo.relayInfo])
    sinon.stub(batchClient, '_validateRequestBeforeSending').onFirstCall().returns(Promise.resolve({}))
    // TODO: should return some kind of JSON API response
    spyOnRelayTransactionInBatch =
      sinon.stub(batchClient.dependencies.httpClient, 'relayTransactionInBatch')
        .onFirstCall().returns(Promise.resolve('0xdeadbeef'))

    await batchClient.dependencies.accountManager.newBLSKeypair()

    const data = testToken.contract.methods.transfer(from, 0).encodeABI()
    gsnTransactionDetails = {
      from,
      data,
      gas: '0xf4240',
      to: testToken.address
    }
  })

  context('#relayTransaction()', function () {
    it('should construct a valid HTTP request and send it to the batch API on the RelayServer', async function () {
      // TODO: this is stubbing method of the class under test, refactor
      sinon.stub(batchClient, '_validateRelayRequestID')
        .onFirstCall()
        .returns()
      const relayingResult = await batchClient.relayTransaction(gsnTransactionDetails)
      assert.equal(relayingResult.relayRequestID?.length, 66)
      const sinonSpyCall = spyOnRelayTransactionInBatch.getCall(0)
      const relayTransactionRequest = sinonSpyCall.args[1] as RelayTransactionRequest

      const expectedValidUntil = pingResponse.validUntil
      const expectedGasPrice = pingResponse.minGasPrice
      const expectedRelayMaxNonce = Number.MAX_SAFE_INTEGER
      const expectedMaxAcceptanceBudget = pingResponse.maxAcceptanceBudget
      const expectedCalldataCacheDecoder = erc20CacheDecoder.address

      // const expectedPctRelayFee = pingResponse.pctRelayFee
      // const expectedBaseRelayFee = pingResponse.baseRelayFee

      // static values fields
      assert.equal(relayTransactionRequest.relayRequest.request.validUntil, expectedValidUntil)
      assert.equal(relayTransactionRequest.relayRequest.relayData.gasPrice, expectedGasPrice)
      // assert.equal(relayTransactionRequest.relayRequest.relayData.pctRelayFee, expectedPctRelayFee)
      // assert.equal(relayTransactionRequest.relayRequest.relayData.baseRelayFee, expectedBaseRelayFee)
      assert.equal(relayTransactionRequest.metadata.relayMaxNonce, expectedRelayMaxNonce)
      assert.equal(relayTransactionRequest.metadata.maxAcceptanceBudget, expectedMaxAcceptanceBudget)
      assert.equal(relayTransactionRequest.metadata.calldataCacheDecoder?.toLowerCase(), expectedCalldataCacheDecoder.toLowerCase())
      assert.equal(relayTransactionRequest.metadata.authorizationElement?.authorizer, from)
      // note: transactionCalldataGasUsed is to be checked in a CacheDecoderInteractor tests
    })
  })
})
