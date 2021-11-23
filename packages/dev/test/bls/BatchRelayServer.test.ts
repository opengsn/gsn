// @ts-ignore
import abiDecoder from 'abi-decoder'
import { HttpProvider } from 'web3-core'

import { GSNConfig } from '@opengsn/provider'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { revert, snapshot } from '../TestUtils'
import { g2ToBN } from '@opengsn/common/dist/bls/evmbls/mcl'
import { BigNumberToBN, BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { AuthorizationElement } from '@opengsn/common/dist/bls/CacheDecoderInteractor'

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
      batchTargetGasLimit: '1000000',
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

      // cannot use hard-coded authorization string due to registrar address being part of the signature
      const keypair = await BLSTypedDataSigner.newKeypair()
      env.relayClient.dependencies.accountManager.setBLSKeypair(keypair)
      const blsPublicKey = g2ToBN(keypair.pubkey)
        .map(BigNumberToBN)
        .map((it: BN) => { return `0x${it.toString('hex')}` })
      const authorizationSignature = await env.relayClient.dependencies.accountManager.createAccountAuthorization(accounts[0], env.batchingContractsDeployment.authorizationsRegistrar.toLowerCase())
      const authorizationElement: AuthorizationElement = {
        authorizer: accounts[0],
        blsPublicKey,
        signature: authorizationSignature
      }

      req = {
        relayRequest: {
          request: {
            to: env.testToken.address,
            data: '0xa9059cbb000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000000',
            from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
            value: '0x0',
            nonce: '0',
            gas: '10000',
            validUntil: env.relayServer.batchManager!.currentBatch.targetBlock.toString()
          },
          relayData: {
            gasPrice: env.relayServer.batchManager!.currentBatch.gasPrice.toString(),
            relayWorker: env.relayServer.workerAddress,
            clientId: '1',
            pctRelayFee: env.relayServer.batchManager!.currentBatch.pctRelayFee.toString(),
            baseRelayFee: env.relayServer.batchManager!.currentBatch.pctRelayFee.toString(),
            paymaster: env.paymaster.address,
            forwarder: env.forwarder.address,
            transactionCalldataGasUsed: '5000',
            paymasterData: '0x'
          }
        },
        metadata: {
          maxAcceptanceBudget: '0xffffff',
          relayHubAddress: env.relayHub.address,
          signature: '["18c1fc456621fce987e6be181d2482a85b249a644dc4580741b21d5855dbd887","263a96fd96dea2c222f7de8ddd000f40839487b3929e5422affe553d65241430","1"]',
          approvalData: '0x',
          relayMaxNonce: 9007199254740991,
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
