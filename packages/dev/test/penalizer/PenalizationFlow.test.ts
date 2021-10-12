import sinon from 'sinon'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { HttpProvider } from 'web3-core'
import { Transaction } from '@ethereumjs/tx'
import { ether } from '@openzeppelin/test-helpers'
import { toBN } from 'web3-utils'

import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { HttpWrapper } from '@opengsn/common/dist/HttpWrapper'
import { Address } from '@opengsn/common/dist/types/Aliases'
import { LocalhostOne, ServerTestEnvironment } from '../ServerTestEnvironment'
import { RelayClient } from '@opengsn/provider/dist/RelayClient'
import { GSNConfig, GSNDependencies } from '@opengsn/provider/dist/GSNConfigurator'
import { constants } from '@opengsn/common/dist/Constants'
import { createClientLogger } from '@opengsn/provider/dist/ClientWinstonLogger'
import { gsnRuntimeVersion } from '@opengsn/common/dist/Version'
import { evmMineMany, startRelay, stopRelay } from '../TestUtils'
import { sleep } from '@opengsn/common/dist/Utils'

contract('PenalizationFlow', function (accounts) {
  const preferredRelays = ['http://www.my-preffered-relay.com']

  let penalizingRelayProcess: ChildProcessWithoutNullStreams
  let gsnTransactionDetails: GsnTransactionDetails
  let relayManagerAddress: Address
  let env: ServerTestEnvironment
  let relayClient: RelayClient

  before(async function () {
    const currentProvider = web3.currentProvider as HttpProvider
    env = new ServerTestEnvironment(currentProvider, accounts)
    await env.init()
    await env.newServerInstance()

    await env.relayHub.depositFor(env.paymaster.address, {
      value: ether('1')
    })

    penalizingRelayProcess = await startRelay(env.relayHub.address, env.stakeManager, {
      stake: 1e18,
      // TODO: adding 'intervalHandler' to the PenalizationService made tests crash/hang with 10ms interval...
      checkInterval: 100,
      delay: 3600 * 24 * 7,
      pctRelayFee: 12,
      url: LocalhostOne,
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
        minGasPrice: '0',
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
      .returns(Promise.resolve(signedTxToPenalize.rawTx))

    const overrideDependencies: Partial<GSNDependencies> = {
      httpClient
    }

    gsnTransactionDetails = {
      from: accounts[0],
      to: env.recipient.address,
      data: env.recipient.contract.methods.emitMessage('hello world').encodeABI(),
      paymasterData: '0x',
      clientId: '1'
    }

    relayClient = new RelayClient({ provider: currentProvider, config, overrideDependencies })
    await relayClient.init()
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

      penalizationEvents = await env.stakeManager.contract.getPastEvents('StakePenalized', { fromBlock: 1 })
      assert.equal(penalizationEvents.length, 1)
      assert.equal(penalizationEvents[0].penalized_relay, relayManagerAddress)
    })
  })
})
