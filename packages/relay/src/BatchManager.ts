/* eslint-disable @typescript-eslint/restrict-plus-operands */
import chalk from 'chalk'
import { PrefixedHexString } from 'ethereumjs-util'
import { toBN } from 'web3-utils'

import {
  AuthorizationElement,
  BatchInfo,
  CacheDecoderInteractor,
  encodeBatch
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { SendTransactionDetails, TransactionManager } from './TransactionManager'
import { ServerAction } from './StoredTransaction'
import { ContractInteractor, GSNBatchingContractsDeployment } from '@opengsn/common'
import { ServerConfigParams } from './ServerConfigParams'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'

export interface SentBatchInfo extends BatchInfo {
  originalTransactionHash: PrefixedHexString
  submissionBlock: number
  submissionTimestamp: number
  boostTransactionsHashes: PrefixedHexString[]
}

export class BatchManager {
  readonly contractInteractor: ContractInteractor
  readonly cacheDecoderInteractor: CacheDecoderInteractor
  private authorizationsRegistrarInteractor: any

  readonly config: ServerConfigParams
  readonly batchHistory = new Map<number, SentBatchInfo>()
  readonly batchingContractsDeployment: GSNBatchingContractsDeployment
  readonly transactionManager: TransactionManager
  readonly workerAddress: Address
  readonly blsTypedDataSigner: BLSTypedDataSigner

  _workerSemaphoreOn = false
  currentBatch!: BatchInfo
  newMinGasPrice: number

  constructor (_: {
    config: ServerConfigParams
    newMinGasPrice: number
    workerAddress: Address
    contractInteractor: ContractInteractor
    transactionManager: TransactionManager
    blsTypedDataSigner: BLSTypedDataSigner
    cacheDecoderInteractor: CacheDecoderInteractor
    batchingContractsDeployment: GSNBatchingContractsDeployment
  }) {
    this.config = _.config
    this.newMinGasPrice = _.newMinGasPrice
    this.workerAddress = _.workerAddress
    this.contractInteractor = _.contractInteractor
    this.transactionManager = _.transactionManager
    this.blsTypedDataSigner = _.blsTypedDataSigner
    this.cacheDecoderInteractor = _.cacheDecoderInteractor
    this.batchingContractsDeployment = _.batchingContractsDeployment
  }

  nextBatch (nextBatchId?: number): void {
    const currentBlockNumber = 0
    const id = nextBatchId ?? this.currentBatch.id + 1
    const targetBlock = currentBlockNumber + this.config.batchDurationBlocks
    const targetSubmissionTimestamp = Date.now() + this.config.batchDurationMS
    this.currentBatch = {
      id,
      targetSubmissionTimestamp,
      targetBlock,
      targetSize: this.config.batchTargetSize,
      transactions: [],
      aggregatedSignature: [],
      isOpen: true,
      targetGasLimit: toBN(this.config.batchTargetGasLimit ?? 0),
      gasPrice: toBN(this.newMinGasPrice),
      workerAddress: this.workerAddress,
      pctRelayFee: 0,
      baseRelayFee: 0,
      maxAcceptanceBudget: 0
    }
    this.validateCurrentBatchParameters()
  }

  /**
   * In case the batch does not meet a minimum threshold of transactions and transactions in it are not at
   * risk of getting stalled, or there are no transactions yet at all, it is legitimate for the relay to
   * delay sending this batch.
   */
  extendBatch (): void {
    const newBatchTarget = this.currentBatch.targetSubmissionTimestamp + (this.config.batchDurationMS / 2)
    console.log(`
batch duration extended:
old target: ${this.currentBatch.targetSubmissionTimestamp}
new target :${newBatchTarget}
`)
    this.currentBatch.targetSubmissionTimestamp = newBatchTarget
  }

  private closeCurrentBatch (): void {
    this.currentBatch.isOpen = false
  }

  async addTransactionToCurrentBatch (req: RelayTransactionRequest): Promise<void> {
    this.verifyCurrentBatchParameters(req)

    const { relayRequestElement } = await this.cacheDecoderInteractor.compressRelayRequestAndCalldata(req.relayRequest)
    const authorizationElement = req.metadata.authorizationElement
    const blsSignature: PrefixedHexString[] = JSON.parse(req.metadata.signature)

    // validate BLS signatures are ok
    const authorizedBLSKey = await this.getAuthorizedBLSPublicKey(req)
    this.validateSignature(req.relayRequest, authorizedBLSKey, req.metadata.signature)

    // Add transaction to the current batch
    this.currentBatch.transactions.push({
      relayRequestElement,
      authorizationElement,
      blsSignature
    })

    // Trigger the interval worker to send the batch faster if possible
    const blockNumber = await this.contractInteractor.getBlockNumberRightNow()
    void this.intervalWorker(blockNumber)
  }

  async getAuthorizedBLSPublicKey (req: RelayTransactionRequest): Promise<PrefixedHexString> {
    let authorizedBLSKey: PrefixedHexString | undefined
    if (req.metadata.authorizationElement == null) {
      authorizedBLSKey = await this.authorizationsRegistrarInteractor.getAuthorizedBLSKey(req.relayRequest.request.from)
      if (authorizedBLSKey == null) {
        throw new Error(`Sender address ${req.relayRequest.request.from} does not have an authorized BLS keypair and must pass an authorization with the batch RelayRequest`)
      }
    } else {
      this.validateAuthorizationElement(req.metadata.authorizationElement)
      authorizedBLSKey = req.metadata.authorizationElement.blsPublicKey.toString()// TODO: types don't match
    }
    return authorizedBLSKey
  }

  private verifyCurrentBatchParameters (req: RelayTransactionRequest): void {
    if (!this.currentBatch.isOpen) {
      // in case there is a race condition between 'add' and 'broadcast', should not happen
      throw new Error(`Current batch ${this.currentBatch.id} has been closed and does not accept new transactions`)
    }
    const requestGasPrice = parseInt(req.relayRequest.relayData.gasPrice)
    if (!this.currentBatch.gasPrice.eqn(requestGasPrice)) {
      throw new Error(
        `gasPrice given ${requestGasPrice} not equal current batch gasPrice ${this.currentBatch.gasPrice}`)
    }

    const validUntil = parseInt(req.relayRequest.request.validUntil)
    if (validUntil !== this.currentBatch.targetBlock) {
      throw new Error(
        `Incorrect value for  "validUntil": set to block $${validUntil}, we expect it to be valid until #${this.currentBatch.targetBlock}`)
    }

    if (req.relayRequest.relayData.relayWorker.toLowerCase() !== this.workerAddress.toLowerCase()) {
      throw new Error(
        `Wrong worker address: ${req.relayRequest.relayData.relayWorker}\n`)
    }
  }

  private validateSignature (relayRequest: RelayRequest, blsPublicKey: PrefixedHexString, signature: PrefixedHexString): void {
    if (false) {
      throw new Error('BLS signature validation failed for RelayRequest')
    }
    return
  }

  private isAuthorizationValid (from: Address, authorizationElement: AuthorizationElement | undefined): boolean {
    return true
  }

  private validateAuthorizationElement (authorizationElement: AuthorizationElement): boolean {
    if (false) {
      throw new Error('Authorization element validation failed!')
    }
    return true
  }

  isCurrentBatchReady (blockNumber: number): boolean {
    const now = Date.now()
    const isTimeNearTarget = this.currentBatch.targetSubmissionTimestamp - now < this.config.batchTimeThreshold
    const currentBatchGasLimit = this.getCurrentBatchGasUse()
    const isGasLimitNearTarget = this.currentBatch.targetGasLimit.sub(currentBatchGasLimit).lte(toBN(this.config.batchGasThreshold))
    const isBlockNumberNearTarget = this.currentBatch.targetBlock - blockNumber <= this.config.batchBlocksThreshold
    const isSizeMaxedOut = this.currentBatch.targetSize === this.currentBatch.transactions.length
    const isCurrentBatchReady = isTimeNearTarget || isGasLimitNearTarget || isBlockNumberNearTarget || isSizeMaxedOut

    // TODO: bonus points - if batch only ready because of time, we can drag this out a bit and maybe save gas
    const gasLimitAboveMinimum = currentBatchGasLimit.gte(toBN(this.config.batchMinimalGasLimit))
    const currentBatchCanBeExtended = isTimeNearTarget && !(gasLimitAboveMinimum || isGasLimitNearTarget || isBlockNumberNearTarget || isSizeMaxedOut)

    function pickColor (flag: boolean, message: string): string {
      if (flag) {
        return chalk.green(message)
      } else {
        return chalk.red(message)
      }
    }

    if (isCurrentBatchReady) {
      const timeMessage = `
target time         : ${this.currentBatch.targetSubmissionTimestamp} (${new Date(this.currentBatch.targetSubmissionTimestamp).toISOString()})
current time        : ${now} (${new Date(now).toISOString()})`
      const gasLimitMessage = `
target gas limit    : ${this.currentBatch.targetGasLimit.toString()}
current gas limit   : ${currentBatchGasLimit}`
      const blockMessage = `
target block        : ${this.currentBatch.targetBlock}
current block       : ${blockNumber}`
      const sizeMessage = `
target size         : ${this.currentBatch.targetSize}
current size        : ${this.currentBatch.transactions.length}`
      console.log(`
batch is ready${pickColor(isTimeNearTarget, timeMessage)}${pickColor(isGasLimitNearTarget, gasLimitMessage)}${pickColor(isBlockNumberNearTarget, blockMessage)}${pickColor(isSizeMaxedOut, sizeMessage)}
`)
    }
    if (currentBatchCanBeExtended) {
      // TODO: implement batch duration extension
      console.log('batch can be extended')
    }
    return isCurrentBatchReady
  }

  getCurrentBatchGasUse (): BN {
    const sum = (previousValue: BN, currentValue: BN) => {
      return previousValue.add(currentValue)
    }
    const sumOfTransactionsGasLimits =
      this.currentBatch.transactions
        .map(it => it.relayRequestElement.gasLimit)
        .reduce(sum, toBN(0))
    const sumOfTransactionsCalldataCosts =
      this.currentBatch.transactions
        .map(it => it.relayRequestElement.calldataGas)
        .reduce(sum, toBN(0))
    return sumOfTransactionsGasLimits.add(sumOfTransactionsCalldataCosts).add(toBN(this.config.batchGasOverhead))
  }

  async broadcastCurrentBatch (): Promise<PrefixedHexString> {
    const { batchCompressedInput, writeSlotsCount } = await this.cacheDecoderInteractor.compressBatch(this.currentBatch)
    const batchEncodedCallData = encodeBatch(batchCompressedInput)
    const method = {
      encodeABI: function () {
        return batchEncodedCallData
      }
    }
    const currentBlock = await this.contractInteractor.getBlockNumberRightNow()
    const details: SendTransactionDetails =
      {
        signer: this.workerAddress,
        serverAction: ServerAction.EXECUTE_BATCH_RELAY_CALL,
        method,
        destination: this.batchingContractsDeployment.batchGateway,
        gasLimit: this.currentBatch.targetGasLimit.toNumber(),
        creationBlockNumber: currentBlock,
        gasPrice: this.currentBatch.gasPrice.toString()
      }
    const { transactionHash } = await this.transactionManager.sendTransaction(details)

    // sends a transaction here
    this.onCurrentBatchBroadcast(transactionHash, 0, Date.now())
    this.nextBatch()
    return transactionHash
  }

  private onCurrentBatchBroadcast (originalTransactionHash: PrefixedHexString, submissionBlock: number, submissionTimestamp: number): void {
    const sentBatchInfo: SentBatchInfo = {
      ...this.currentBatch,
      boostTransactionsHashes: [],
      originalTransactionHash,
      submissionTimestamp,
      submissionBlock
    }
    this.batchHistory.set(this.currentBatch.id, sentBatchInfo)
  }

  onBatchBoosted (id: number, newTransactionHash: PrefixedHexString): void {
    const sentBatchInfo = this.batchHistory.get(id)
    if (sentBatchInfo == null) {
      console.error(`Did not find batch with id ${id} with boosted transaction hash ${newTransactionHash}`)
      return
    }
    sentBatchInfo.boostTransactionsHashes.push(newTransactionHash)
  }

  setNewMinGasPrice (newGasPrice: number): void {
    this.newMinGasPrice = newGasPrice
  }

  private aggregateSignatures (): BN[] {
    const signatures = this.currentBatch.transactions.map(it => it.blsSignature)
    return this.blsTypedDataSigner.aggregateSignatures(signatures)
  }

  intervalWorker (blockNumber: number): void {
    if (this._workerSemaphoreOn) {
      console.warn('BatchManager: different worker is not finished yet, skipping this block')
      return
    }
    if (this.isCurrentBatchReady(blockNumber)) {
      this._workerSemaphoreOn = true
      this.closeCurrentBatch()
      this.currentBatch.aggregatedSignature = this.aggregateSignatures()
      this.broadcastCurrentBatch().finally(() => {
        this._workerSemaphoreOn = false
      })
    }
  }

  /**
   * Smoke self-test as there are a few ways for the batch to get misconfigured
   */
  async validateCurrentBatchParameters () {
    // 1. timeThreshold > > check interval
    // 2. batchDurationMS > > timeThreshold
    // 3. gas target < < block gas limit
    // 4. gas overhead < < gas target
  }
}
