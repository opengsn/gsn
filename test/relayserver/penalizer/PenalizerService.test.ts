import { HttpProvider } from 'web3-core'
import { Transaction } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'
import { toBN } from 'web3-utils'

import { PenalizerDependencies, PenalizerService } from '../../../src/relayserver/penalizer/PenalizerService'
import { AuditRequest } from '../../../src/common/types/AuditRequest'
import { createServerLogger } from '../../../src/relayserver/ServerWinstonLogger'

import { constants } from '../../../src/common/Constants'
import { Address } from '../../../src/common/types/Aliases'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { MockTxByNonceService } from './MockTxByNonceService'
import { evmMineMany, revert, snapshot } from '../../TestUtils'
import { resolveServerConfig, ServerConfigParams } from '../../../src/relayserver/ServerConfigParams'

contract('PenalizerService', function (accounts) {
  let id: string
  let env: ServerTestEnvironment
  let txByNonceService: MockTxByNonceService
  let penalizerService: PenalizerService
  let relayWorker: Address

  beforeEach(async function () {
    id = (await snapshot()).result
  })

  afterEach(async function () {
    await revert(id)
    await penalizerService.transactionManager.txStoreManager.clearAll()
    penalizerService.transactionManager._initNonces()
  })

  before(async function () {
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init()
    await env.newServerInstance()
    const logger = createServerLogger('error', '', '')
    txByNonceService = new MockTxByNonceService(env.relayServer.contractInteractor, logger)
    const penalizerParams: PenalizerDependencies = {
      transactionManager: env.relayServer.transactionManager,
      contractInteractor: env.relayServer.contractInteractor,
      txByNonceService
    }

    const serverConfigParams = await resolveServerConfig({
      url: '',
      workdir: '',
      etherscanApiUrl: 'etherscanApiUrl',
      relayHubAddress: env.relayHub.address
    }, web3.currentProvider) as ServerConfigParams
    penalizerService = new PenalizerService(penalizerParams, logger, serverConfigParams)
    await penalizerService.init(false)

    relayWorker = env.relayServer.transactionManager.workersKeyManager.getAddress(0)
    // @ts-ignore
    await env.web3.eth.personal.importRawKey(bufferToHex(env.relayServer.transactionManager.workersKeyManager._privateKeys[relayWorker]), '')
    await env.web3.eth.personal.unlockAccount(relayWorker, '', 1e6)
  })

  describe('penalizeRepeatedNonce', function () {
    let auditRequest: AuditRequest

    before(async function () {
      const rawTxOptions = env.relayServer.contractInteractor.getRawTxOptions()
      const nonce = await web3.eth.getTransactionCount(relayWorker)
      const txToMine = new Transaction({
        nonce: toBN(nonce),
        gasPrice: toBN(1e9),
        gasLimit: toBN(1e5),
        to: constants.ZERO_ADDRESS,
        value: toBN(1e17),
        data: '0x1234'
      }, rawTxOptions)
      const penalizableTx = new Transaction({
        nonce: toBN(nonce),
        gasPrice: toBN(1e9),
        gasLimit: toBN(1e5),
        to: constants.ZERO_ADDRESS,
        value: toBN(1e16),
        data: '0x1234'
      }, rawTxOptions)

      const signedTxToMine = env.relayServer.transactionManager.workersKeyManager.signTransaction(relayWorker, txToMine)
      const signedTxToPenalize = env.relayServer.transactionManager.workersKeyManager.signTransaction(relayWorker, penalizableTx)
      await env.relayServer.transactionManager.contractInteractor.sendSignedTransaction(signedTxToMine)
      await txByNonceService.setTransactionByNonce(txToMine, relayWorker)
      auditRequest = { signedTx: signedTxToPenalize }
    })

    it('should commit and penalize for a repeated nonce transaction', async function () {
      assert.equal(penalizerService.scheduledPenalizations.length, 0, 'should start with empty penalization schedule')
      const ret = await penalizerService.penalizeRepeatedNonce(auditRequest)
      assert.equal(ret.message, undefined, `penalization failed whit message: ${ret.message}`)
      assert.notEqual(ret.commitTxHash, undefined, 'notice that penalization failed but error message is not given')
      assert.equal(penalizerService.scheduledPenalizations.length, 1, 'should save the penalization for after commitment is ready')

      const currentBlock = await web3.eth.getBlockNumber()
      assert.equal(penalizerService.scheduledPenalizations[0].readyBlockNumber, undefined, 'should not know when is commitment mined before intervalHandler')

      let penalizedTransactions = await penalizerService.intervalHandler()
      assert.equal(penalizerService.scheduledPenalizations[0].readyBlockNumber, currentBlock + 5, 'should set the ready block once mined')
      assert.equal(penalizedTransactions.length, 0, 'penalized something before commitment delay')
      await evmMineMany(5)

      penalizedTransactions = await penalizerService.intervalHandler()
      assert.equal(penalizedTransactions.length, 1, 'should only penalize one ready transaction')
      assert.equal(penalizerService.scheduledPenalizations.length, 0, 'should remove penalization from schedule')

      penalizedTransactions = await penalizerService.intervalHandler()
      assert.equal(penalizedTransactions.length, 0, 'penalized something again? How?')
    })
  })

  describe('penalizeIllegalTransaction', function () {
    let auditRequest: AuditRequest

    before(async function () {
      const rawTxOptions = env.relayServer.contractInteractor.getRawTxOptions()
      const penalizableTx = new Transaction({
        nonce: toBN(0),
        gasPrice: toBN(1e9),
        gasLimit: toBN(1e5),
        to: constants.ZERO_ADDRESS,
        value: toBN(1e16),
        data: '0x1234'
      }, rawTxOptions)
      const signedTxToPenalize = env.relayServer.transactionManager.workersKeyManager.signTransaction(relayWorker, penalizableTx)
      auditRequest = { signedTx: signedTxToPenalize }
    })

    // TODO: duplicated test for different type of penalization - run in a loop if more types are added!
    it('should penalize for an illegal transaction', async function () {
      const ret = await penalizerService.penalizeIllegalTransaction(auditRequest)
      assert.equal(ret.message, undefined, `penalization failed with message: ${ret.message}`)
      assert.notEqual(ret.commitTxHash, undefined, 'notice that penalization failed but error message is not given')

      let penalizedTransactions = await penalizerService.intervalHandler()
      assert.equal(penalizedTransactions.length, 0, 'penalized something before commitment delay')
      await evmMineMany(5)

      penalizedTransactions = await penalizerService.intervalHandler()
      assert.equal(penalizedTransactions.length, 1, 'should only penalize one ready transaction')
      assert.equal(penalizerService.scheduledPenalizations.length, 0, 'should remove penalization from schedule')
    })
  })
})
