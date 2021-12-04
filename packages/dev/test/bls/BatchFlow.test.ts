// @ts-ignore
import abiDecoder from 'abi-decoder'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'

import { GSNConfig } from '@opengsn/provider'
import { TestTokenInstance } from '@opengsn/contracts'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { initializeAbiDecoderForBLS, startRelay, stopRelay } from '../TestUtils'
import { BatchRelayProvider } from '@opengsn/provider/dist/bls/BatchRelayProvider'
import { ether, sleep } from '@opengsn/common'

const TestToken = artifacts.require('TestToken')

const innerTransactionGas = 1000000

contract.only('Batch Relaying Flow', function (accounts: string[]) {
  let testToken: TestTokenInstance
  let env: ServerTestEnvironment
  let relayProcess: ChildProcessWithoutNullStreams

  after(function () {
    stopRelay(relayProcess)
  })

  before(async function () {
    initializeAbiDecoderForBLS()
    const relayClientConfig: Partial<GSNConfig> = {}
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init(relayClientConfig, undefined, undefined, true)
    await env.initBatching()

    // 2. start batch server
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    relayProcess = await startRelay(env.relayHub.address, env.stakeManager, {
      relaylog: true,
      runBatching: true,
      stake: 1e18,
      relayOwner: accounts[1],
      // @ts-ignore
      ethereumNodeUrl: web3.currentProvider.host,
      delay: 3600 * 24 * 7,
      pctRelayFee: 12,
      url: 'asd',
      workerTargetBalance: ether('5'),
      value: ether('10'),
      batchGasOverhead: '2000000',
      batchDurationBlocks: 10,
      batchTargetGasLimit: '4000000',
      batchGatewayAddress: env.batchingContractsDeployment.batchGateway,
      batchGatewayCacheDecoderAddress: env.batchingContractsDeployment.batchGatewayCacheDecoder,
      authorizationsRegistrarAddress: env.batchingContractsDeployment.authorizationsRegistrar,
      blsVerifierContractAddress: env.blsVerifierContract.address,
      batchTargetAddress: env.testToken.address,
      batchDefaultCalldataCacheDecoderAddress: env.erc20CacheDecoder.address
    })

    await sleep(1000)
    const config: Partial<GSNConfig> =
      {
        clientId: '0',
        loggerConfiguration: { logLevel: 'debug' },
        paymasterAddress: env.paymaster.address
      }

    const bathingRelayProvider = BatchRelayProvider.newBatchingProvider(
      {
        provider: env.provider,
        config
      },
      env.batchingContractsDeployment,
      env.cacheDecoderInteractor)
    await bathingRelayProvider.init()
    await bathingRelayProvider.newBLSKeypair()

    // @ts-ignore
    TestToken.web3.setProvider(bathingRelayProvider, undefined)
    testToken = await TestToken.at(env.testToken.address)
    await env.testToken.mint(200000, {
      from: accounts[0]
    })
  })

  it('should relay batch', async function () {
    const transactionResponse = await testToken.transfer(accounts[3], 200000, {
      from: accounts[0],
      gas: innerTransactionGas
    })

    const nativeTxReceipt = await web3.eth.getTransactionReceipt(transactionResponse.tx)
    const allLogs = abiDecoder.decodeLogs(nativeTxReceipt.logs)
    assert.equal(transactionResponse.logs.length, 1)
    assert.equal(allLogs.length, 7)
    // 3. add request to batch from1

    // 4. add request to batch from2
    // 5. [non-core API] ask server for status and see 'batching' state
    // 6. [non-core API] wait; see state become 'tx broadcast'
    // 7. await batch transaction result by RelayRequest ID
    // 8. observe only necessary target contract events from the stubbed receipt
  })
})
