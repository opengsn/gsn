import sinon, { SinonStubbedInstance } from 'sinon'
import { toBN } from 'web3-utils'

import { BatchManager } from '@opengsn/relay/dist/BatchManager'
import { configureServer } from '@opengsn/relay/dist/ServerConfigParams'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'
import { ContractInteractor, GSNBatchingContractsDeployment } from '@opengsn/common'
import { BatchRelayRequestInfo, CacheDecoderInteractor } from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { stubBatchInput } from '../ServerTestEnvironment'

contract.only('BatchManager', function () {
  let batchManager: BatchManager
  let stubContractInteractor: SinonStubbedInstance<ContractInteractor>
  let stubTransactionManager: SinonStubbedInstance<TransactionManager>
  let stubCacheDecoderInteractor: SinonStubbedInstance<CacheDecoderInteractor>
  let stubBLSTypedDataSigner: SinonStubbedInstance<BLSTypedDataSigner>

  before(async function () {
    stubTransactionManager = sinon.createStubInstance(TransactionManager)
    stubCacheDecoderInteractor = sinon.createStubInstance(CacheDecoderInteractor)
    stubContractInteractor = sinon.createStubInstance(ContractInteractor)
    stubContractInteractor = sinon.createStubInstance(ContractInteractor)
    stubBLSTypedDataSigner = sinon.createStubInstance(BLSTypedDataSigner)

    stubTransactionManager.sendTransaction
      .onFirstCall().returns(Promise.resolve({ transactionHash: '0xdeadbeef', signedTx: '' }))
    stubCacheDecoderInteractor.compressBatch
      .onFirstCall().returns(Promise.resolve({ batchCompressedInput: stubBatchInput, writeSlotsCount: 0 }))
    stubContractInteractor.getBlockNumberRightNow
      .onFirstCall().returns(Promise.resolve(777))
    stubBLSTypedDataSigner.aggregateSignatures
      .onFirstCall().returns([])

    batchManager = new BatchManager({
      config: configureServer({}),
      newMinGasPrice: 0,
      workerAddress: '',
      contractInteractor: stubContractInteractor as any as ContractInteractor,
      transactionManager: stubTransactionManager as any as TransactionManager,
      cacheDecoderInteractor: stubCacheDecoderInteractor as any as CacheDecoderInteractor,
      blsTypedDataSigner: stubBLSTypedDataSigner as any as BLSTypedDataSigner,
      batchingContractsDeployment: { batchGateway: '' } as GSNBatchingContractsDeployment
    })
  })

  context('#nextBatch()', function () {
    it('should initialize a new batch', async function () {
      const nextBatchId = 7

      assert.isUndefined(batchManager.currentBatch)
      await batchManager.nextBatch(nextBatchId)

      assert.equal(batchManager.currentBatch.id, nextBatchId)
      assert.equal(batchManager.currentBatch.transactions.length, 0)
      // TODO: check the rest of the fields
    })
  })

  context('#addTransactionToCurrentBatch()', function () {
    it('should accept a valid transaction to the batch')
    it('should close a batch if the added transaction makes it meet the submition requirements')
    it('should reject a transaction if the current batch is closed (TBD: start collecting the next batch before confirming the current one)')
    it('should reject a transaction with invalid [gasPrice, accBudget, worker, validUntil, etc.] to the batch')
    it('should reject a transaction without authorized BLS public key to the batch')
  })

  context('#broadcastCurrentBatch()', function () {
    before(async function () {
      // create a batch with like 7 transactions (that do not have to have valid data)
      const zero = toBN(0)
      const relayRequestElement = {
        nonce: zero,
        paymaster: zero,
        sender: zero,
        target: zero,
        gasLimit: zero,
        calldataGas: zero,
        methodData: Buffer.from([]),
        cacheDecoder: zero
      }
      const info: BatchRelayRequestInfo = {
        relayRequestElement,
        blsSignature: []
      }
      batchManager.currentBatch.transactions.push(info)
    })

    it('should broadcast the batch containing all submitted transactions', async function () {
      const currentBatch = batchManager.currentBatch.id
      assert.equal(batchManager.currentBatch.transactions.length, 1)
      await batchManager.broadcastCurrentBatch()
      assert.equal(batchManager.currentBatch.transactions.length, 0)
      assert.equal(batchManager.batchHistory.get(currentBatch)?.transactions.length, 1)
    })
  })
})
