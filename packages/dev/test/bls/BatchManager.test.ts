import sinon, { SinonFakeTimers, SinonStubbedInstance } from 'sinon'
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
  let stubBLSTypedDataSigner: SinonStubbedInstance<BLSTypedDataSigner>
  let stubCacheDecoderInteractor: SinonStubbedInstance<CacheDecoderInteractor>

  let batchRelayRequestInfo: BatchRelayRequestInfo

  const relayRequestGasLimit = toBN(777)
  const batchTargetGasLimit = relayRequestGasLimit.muln(3).addn(5).toString()
  const batchTargetSize = 15
  const batchGasThreshold = 6
  const batchTimeThreshold = 3
  const batchBlocksThreshold = 3

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
      config: configureServer({
        batchTargetSize,
        batchTargetGasLimit,
        batchDurationMS: 10000,
        batchDurationBlocks: 100,
        batchGasOverhead: '0',
        batchGasThreshold,
        batchTimeThreshold,
        batchBlocksThreshold
      }),
      newMinGasPrice: 0,
      workerAddress: '',
      contractInteractor: stubContractInteractor as any as ContractInteractor,
      transactionManager: stubTransactionManager as any as TransactionManager,
      cacheDecoderInteractor: stubCacheDecoderInteractor as any as CacheDecoderInteractor,
      blsTypedDataSigner: stubBLSTypedDataSigner as any as BLSTypedDataSigner,
      batchingContractsDeployment: { batchGateway: '' } as GSNBatchingContractsDeployment
    })

    const zero = toBN(0)
    const relayRequestElement = {
      nonce: zero,
      paymaster: zero,
      sender: zero,
      target: zero,
      gasLimit: relayRequestGasLimit,
      calldataGas: zero,
      methodData: Buffer.from([]),
      cacheDecoder: zero
    }
    batchRelayRequestInfo = {
      relayRequestElement,
      blsSignature: []
    }
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
      batchManager.currentBatch.transactions.push(batchRelayRequestInfo)
    })

    it('should broadcast the batch containing all submitted transactions', async function () {
      const currentBatch = batchManager.currentBatch.id
      assert.equal(batchManager.currentBatch.transactions.length, 1)
      await batchManager.broadcastCurrentBatch()
      assert.equal(batchManager.currentBatch.transactions.length, 0)
      assert.equal(batchManager.batchHistory.get(currentBatch)?.transactions.length, 1)
    })
  })

  context('#isCurrentBatchReady()', function () {
    let clock: SinonFakeTimers

    afterEach(function () {
      batchManager.currentBatch.transactions = []
      clock?.restore()
    })

    it('should return false if current batch is not nearing current gas or time targets', function () {
      assert.equal(batchManager.currentBatch.targetGasLimit.toString(), batchTargetGasLimit)
      assert.equal(batchManager.getCurrentBatchGasUse().toString(), '0')
      assert.isFalse(batchManager.isCurrentBatchReady(0))
      batchManager.currentBatch.transactions.push(batchRelayRequestInfo)
      assert.equal(batchManager.getCurrentBatchGasUse().toString(), relayRequestGasLimit.toString())
      assert.isFalse(batchManager.isCurrentBatchReady(0))
    })

    it('should return true when current batch is nearing the gas target', function () {
      const batchSize = 3
      for (let i = 0; i < batchSize; i++) {
        batchManager.currentBatch.transactions.push(batchRelayRequestInfo)
      }
      const batchGasUse = batchManager.getCurrentBatchGasUse()
      assert.isTrue(batchGasUse.lt(toBN(batchTargetGasLimit)), 'batch size exceeded target gas limit')
      assert.isTrue(batchGasUse.sub(toBN(batchTargetGasLimit)).lt(toBN(batchGasThreshold)), 'batch size difference is smaller then ')
      assert.equal(batchGasUse.toString(), relayRequestGasLimit.muln(batchSize).toString())
      assert.isTrue(batchManager.isCurrentBatchReady(0))
    })

    it('should return true when current batch is nearing the time target', function () {
      clock = sinon.useFakeTimers()
      clock.setSystemTime(batchManager.currentBatch.targetSubmissionTimestamp - batchTimeThreshold + 1)
      assert.isTrue(batchManager.isCurrentBatchReady(0))
    })

    it('should return true when current batch is nearing the target block', function () {
      assert.isFalse(batchManager.isCurrentBatchReady(96))
      assert.isTrue(batchManager.isCurrentBatchReady(97))
    })

    it('should return true when current batch is nearing the target transactions count', function () {
      // silence the gas limit readiness
      batchManager.currentBatch.targetGasLimit = toBN(1000000)
      for (let i = 0; i < batchTargetSize; i++) {
        batchManager.currentBatch.transactions.push(batchRelayRequestInfo)
      }
      assert.isTrue(batchManager.isCurrentBatchReady(0))
    })
  })

  context('#getAuthorizedBLSPublicKey()', function () {
    it('should throw if sender does not have an authorized signature and did not include new authorization')
    it('should throw if new authorization element is included but its verification failed')
    it('should return a public key stored by the registrar')
    it('should return a public key included in authorization')
  })

  context('#verifyCurrentBatchParameters()', function () {
    it('isOpen')
    it('gasPrice')
    it('validUntil')
    it('relayWorker')
  })

  context('#getCurrentBatchGasLimit()', function () {
    it('')
  })
})
