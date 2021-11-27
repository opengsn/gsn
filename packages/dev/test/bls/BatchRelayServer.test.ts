/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
// @ts-ignore
import abiDecoder from 'abi-decoder'
import { HttpProvider } from 'web3-core'

import { GSNConfig } from '@opengsn/provider'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { revert, snapshot } from '../TestUtils'
import {
  CacheDecoderInteractor,
  CachingGasConstants
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { createRelayRequestAndAuthorization } from './BLSBatchGateway.test'
import { ContractInteractor } from '@opengsn/common'

const BLSAddressAuthorizationsRegistrar = artifacts.require('BLSAddressAuthorizationsRegistrar')
const BLSBatchGateway = artifacts.require('BLSBatchGateway')
const TestToken = artifacts.require('TestToken')
const RelayHub = artifacts.require('RelayHub')

// @ts-ignore
abiDecoder.addABI(BLSAddressAuthorizationsRegistrar.abi)
// @ts-ignore
abiDecoder.addABI(BLSBatchGateway.abi)
// @ts-ignore
abiDecoder.addABI(TestToken.abi)
// @ts-ignore
abiDecoder.addABI(RelayHub.abi)

contract.only('BatchRelayServer integration test', function (accounts: Truffle.Accounts) {
  let globalId: string
  let env: ServerTestEnvironment

  before(async function () {
    globalId = (await snapshot()).result
    const relayClientConfig: Partial<GSNConfig> = {}

    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init(relayClientConfig, undefined, undefined, true)
    await env.initBatching()
    await env.newServerInstance({
      runBatching: true,
      batchTargetGasLimit: '10000000',
      batchDurationMS: 120000,
      batchDurationBlocks: 1000,
      batchDefaultCalldataCacheDecoder: env.erc20CacheDecoder.address
    })
    await env.clearServerStorage()
  })

  after(async function () {
    await revert(globalId)
    await env.clearServerStorage()
  })

  context('#createBatchedRelayTransaction()', function () {
    // TODO: use BatchRelayClient and some kind of Batch Test Environment to create this object
    let req: RelayTransactionRequest

    before(async function () {
      env.relayServer.batchManager?.nextBatch(0)

      const relayRequest: RelayRequest = {
        request: {
          to: env.testToken.address,
          data: '0xa9059cbb000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000000',
          from: accounts[0],
          value: '0x0',
          nonce: '0',
          gas: '10000',
          validUntil: env.relayServer.batchManager!.currentBatch.targetBlock.toString()
        },
        relayData: {
          gasPrice: env.relayServer.batchManager!.currentBatch.gasPrice.toString(),
          relayWorker: env.relayServer.workerAddress,
          clientId: '0',
          pctRelayFee: env.relayServer.batchManager!.currentBatch.pctRelayFee.toString(),
          baseRelayFee: env.relayServer.batchManager!.currentBatch.pctRelayFee.toString(),
          paymaster: env.paymaster.address,
          forwarder: env.forwarder.address,
          transactionCalldataGasUsed: '5000',
          paymasterData: '0x'
        }
      }

      const cachingGasConstants: CachingGasConstants = {
        authorizationCalldataBytesLength: 1,
        authorizationStorageSlots: 1,
        gasPerSlotL2: 1
      }
      const cacheDecoderInteractor = await new CacheDecoderInteractor({
        provider: web3.currentProvider as HttpProvider,
        batchingContractsDeployment: env.batchingContractsDeployment,
        contractInteractor: {} as ContractInteractor,
        calldataCacheDecoderInteractors: env.calldataCacheDecoderInteractors,
        cachingGasConstants
      }).init()

      const {
        authorizationElement, blsSignature
      } = await createRelayRequestAndAuthorization(relayRequest, accounts[0], cacheDecoderInteractor, env.batchingContractsInstances.authorizationsRegistrar)

      req = {
        relayRequest,
        metadata: {
          maxAcceptanceBudget: '0xffffff',
          relayHubAddress: env.relayHub.address,
          signature: JSON.stringify(blsSignature),
          approvalData: '0x',
          relayMaxNonce: 9007199254740991,
          calldataCacheDecoder: env.erc20CacheDecoder.address.toLowerCase(),
          authorizationElement
        }
      }
    })

    it('should accept valid BatchRelayRequests and pass it to the BatchManager', async function () {
      assert.equal(env.relayServer.batchManager?.currentBatch.transactions.length, 0)
      const relayRequestID = await env.relayServer.createBatchedRelayTransaction(req)
      assert.equal(env.relayServer.batchManager?.currentBatch.transactions.length, 1)
      assert.equal(relayRequestID.length, 66)

      // forcing the single-transaction batch to be mined immediately
      const batchTxHash = await env.relayServer.batchManager?.broadcastCurrentBatch()
      const batchReceipt = await web3.eth.getTransactionReceipt(batchTxHash!)
      const decodedLogs = abiDecoder.decodeLogs(batchReceipt.logs)
      assert.equal(batchReceipt.logs.length, 7)
      console.log(JSON.stringify(decodedLogs))
    })

    it('should trigger the broadcast of the batch from the worker handler', async function () {

    })
  })
})
