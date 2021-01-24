import { HttpProvider } from 'web3-core'
import { Transaction } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'
import { toBN } from 'web3-utils'

import { PenalizerDependencies, PenalizerService } from '@opengsn/relay/dist/penalizer/PenalizerService'
import { AuditRequest } from '@opengsn/common/dist/types/AuditRequest'
import { createServerLogger } from '@opengsn/relay/dist/ServerWinstonLogger'

import { constants } from '@opengsn/common/dist/Constants'
import { Address } from '@opengsn/common/dist/types/Aliases'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { MockTxByNonceService } from './MockTxByNonceService'
import { revert, snapshot } from '../TestUtils'
import { resolveServerConfig, ServerConfigParams } from '@opengsn/relay/dist/ServerConfigParams'

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
    await penalizerService.init()

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

    it('should penalize for a repeated nonce transaction', async function () {
      const ret = await penalizerService.penalizeRepeatedNonce(auditRequest)
      assert.notEqual(ret, undefined, 'penalization failed')
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

    it('should penalize for an illegal transaction', async function () {
      const ret = await penalizerService.penalizeIllegalTransaction(auditRequest)
      assert.notEqual(ret, undefined, 'penalization failed')
    })
  })
})
