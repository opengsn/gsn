import { HttpProvider } from 'web3-core'
import { Transaction } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'
import { toBN } from 'web3-utils'

import { PenalizeRequest, PenalizerParams, PenalizerService } from '../../../src/relayserver/penalizer/PenalizerService'
import { createServerLogger } from '../../../src/relayserver/ServerWinstonLogger'

import { constants } from '../../../src/common/Constants'
import { Address } from '../../../src/relayclient/types/Aliases'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { MockTxByNonceService } from './MockTxByNonceService'

contract.only('PenalizerService', function (accounts) {
  let env: ServerTestEnvironment
  let txByNonceService: MockTxByNonceService
  let penalizerService: PenalizerService
  let relayWorker: Address

  before(async function () {
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init()
    await env.newServerInstance()
    const logger = createServerLogger('debug', '', '')
    txByNonceService = new MockTxByNonceService(web3.currentProvider, env.relayServer.contractInteractor, logger)
    const penalizerParams: PenalizerParams = {
      transactionManager: env.relayServer.transactionManager,
      contractInteractor: env.relayServer.contractInteractor,
      txByNonceService,
      devMode: true
    }
    penalizerService = new PenalizerService(penalizerParams, logger)
    await penalizerService.init()

    relayWorker = env.relayServer.transactionManager.workersKeyManager.getAddress(0)
    // @ts-ignore
    await env.web3.eth.personal.importRawKey(bufferToHex(env.relayServer.transactionManager.workersKeyManager._privateKeys[relayWorker]), '')
    await env.web3.eth.personal.unlockAccount(relayWorker, '', 1e6)
  })

  describe('penalizeRepeatedNonce', function () {
    let penalizeRequest: PenalizeRequest

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
      penalizeRequest = { signedTx: signedTxToPenalize }
    })

    it('should penalize for a repeated nonce transaction', async function () {
      const ret = await penalizerService.penalizeRepeatedNonce(penalizeRequest)
      assert.isTrue(ret, 'penalization failed')
    })
  })
})
