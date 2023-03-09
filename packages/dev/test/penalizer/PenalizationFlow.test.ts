import sinon from 'sinon'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { Transaction } from '@ethereumjs/tx'
import { ether } from '@openzeppelin/test-helpers'
import { toBN } from 'web3-utils'

import { GsnTransactionDetails, HttpClient, HttpWrapper, Address, gsnRuntimeVersion, sleep, constants } from '@opengsn/common'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { RelayClient } from '@opengsn/provider/dist/RelayClient'
import { GSNConfig, GSNDependencies } from '@opengsn/provider/dist/GSNConfigurator'

import { createClientLogger } from '@opengsn/logger/dist/ClientWinstonLogger'

import { evmMineMany, startRelay, stopRelay } from '../TestUtils'

contract('PenalizationFlow', function (accounts) {
  const preferredRelays = ['http://www.my-preffered-relay.com']

  let penalizingRelayProcess: ChildProcessWithoutNullStreams
  let gsnTransactionDetails: GsnTransactionDetails
  let relayManagerAddress: Address
  let env: ServerTestEnvironment
  let relayClient: RelayClient

  before(async function () {
    // @ts-ignore
    const currentProviderHost = web3.currentProvider.host
    const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)
    const currentProvider = web3.currentProvider as HttpProvider
    env = new ServerTestEnvironment(currentProvider, accounts)
    await env.init()
    await env.newServerInstance()

    await env.relayHub.depositFor(env.paymaster.address, {
      value: ether('1')
    })

    // note that ServerTestEnvironment uses account[4] as Relay Manager, and 'startRelay' uses account[0]
    await env.testToken.mint(ether('1'), { from: accounts[0] })
    await env.testToken.approve(env.stakeManager.address, ether('1'), { from: accounts[0] })
    penalizingRelayProcess = await startRelay(env.relayHub.address, env.testToken, env.stakeManager, {
      stake: ether('1'),
      // TODO: adding 'intervalHandler' to the PenalizationService made tests crash/hang with 10ms interval...
      checkInterval: 100,
      delay: 3600 * 24 * 7,
      // using IP instead of localhost to avoid being excluded from list
      url: 'http://127.0.0.1:8090/',
      relayOwner: accounts[0],
      ethereumNodeUrl: currentProvider.host,
      refreshStateTimeoutBlocks: 1,
      gasPriceFactor: 1.2,
      relaylog: process.env.relaylog
    })

    const logger = createClientLogger({ logLevel: 'error' })
    const config: Partial<GSNConfig> = {
      paymasterAddress: env.paymaster.address,
      preferredRelays,
      auditorsCount: 2
    }
    const httpClient = new HttpClient(new HttpWrapper(), logger)
    const relayWorkerAddress = env.relayServer.transactionManager.workersKeyManager.getAddress(0)
    const relayManagerAddress = env.relayServer.transactionManager.managerKeyManager.getAddress(0)

    sinon
      .stub(httpClient, 'getPingResponse')
      .returns(Promise.resolve({
        ownerAddress: accounts[0],
        relayWorkerAddress,
        relayManagerAddress,
        relayHubAddress: env.relayHub.address,
        minMaxPriorityFeePerGas: '0',
        minMaxFeePerGas: '0',
        maxMaxFeePerGas: Number.MAX_SAFE_INTEGER.toString(),
        maxAcceptanceBudget: '999999999',
        ready: true,
        version: gsnRuntimeVersion
      }))

    const rawTxOptions = env.relayServer.contractInteractor.getRawTxOptions()
    const penalizableTx = new Transaction({
      nonce: toBN(0),
      gasPrice: toBN(1e9),
      gasLimit: toBN(1e5),
      to: constants.ZERO_ADDRESS,
      value: toBN(1e16),
      data: '0x1234'
    }, rawTxOptions)
    const signedTxToPenalize = env.relayServer.transactionManager.workersKeyManager.signTransaction(relayWorkerAddress, penalizableTx)

    sinon
      .stub(httpClient, 'relayTransaction')
      .returns(Promise.resolve({ signedTx: signedTxToPenalize.rawTx, nonceGapFilled: {} }))

    const overrideDependencies: Partial<GSNDependencies> = {
      httpClient
    }

    relayClient = new RelayClient({ provider: ethersProvider, config, overrideDependencies })
    await relayClient.init()
    const { maxFeePerGas, maxPriorityFeePerGas } = await relayClient.calculateGasFees()
    gsnTransactionDetails = {
      from: accounts[0],
      to: env.recipient.address,
      data: env.recipient.contract.methods.emitMessage('hello world').encodeABI(),
      paymasterData: '0x',
      clientId: '1',
      maxFeePerGas,
      maxPriorityFeePerGas
    }
  })

  after(async function () {
    await stopRelay(penalizingRelayProcess)
  })

  describe('with a cheating relay', function () {
    // TODO: as an integration test, only tests the 'illegal tx' as mock Etherscan API is not set on server
    it('should penalize illegal transaction', async function () {
      let penalizationEvents = await env.stakeManager.contract.getPastEvents('StakePenalized', { fromBlock: 1 })
      assert.equal(penalizationEvents.length, 0)

      const relayingResult = await relayClient.relayTransaction(gsnTransactionDetails)
      assert.equal(relayingResult.transaction, undefined)

      const auditResult = await relayingResult.auditPromises![0]
      assert.equal(auditResult?.commitTxHash?.length, 66)

      // let the relay run its 'intervalHandler'
      await evmMineMany(5)
      await sleep(1000)
      await evmMineMany(5)
      await sleep(1000)

      penalizationEvents = await env.stakeManager.contract.getPastEvents('StakePenalized', { fromBlock: 1 })
      assert.equal(penalizationEvents.length, 1)
      assert.equal(penalizationEvents[0].penalized_relay, relayManagerAddress)
    })
  })
})
