/* eslint-disable @typescript-eslint/restrict-plus-operands */
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
    const validUntil = currentBlockNumber + this.config.batchValidUntilBlocks
    const targetSubmissionTimestamp = Date.now() + this.config.batchDurationMS
    this.currentBatch = {
      id,
      targetSubmissionTimestamp,
      validUntil,
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
  }

  private closeCurrentBatch (): void {
    this.currentBatch.isOpen = false
  }

  async addTransactionToCurrentBatch (req: RelayTransactionRequest): Promise<void> {
    if (!this.currentBatch.isOpen) {
      // in case there is a race condition between 'add' and 'broadcast', should not happen
      throw new Error(`Current batch ${this.currentBatch.id} has been closed and does not accept new transactions`)
    }
    if (!this.matchesCurrentBatchParameters(req)) {
      throw new Error('RelayRequest does not match the current batch parameters and cannot be included')
    }

    const { relayRequestElement } = await this.cacheDecoderInteractor.compressRelayRequestAndCalldata(req.relayRequest)
    const authorizationElement = req.metadata.authorizationElement
    const blsSignature: PrefixedHexString[] = JSON.parse(req.metadata.signature)

    // 1. validate BLS signatures are ok
    const authorizedBLSKey = await this.getAuthorizedBLSPublicKey(req)
    if (!this.validateSignature(req.relayRequest, authorizedBLSKey, req.metadata.signature)) {
      throw new Error('BLS signature validation failed for RelayRequest')
    }

    // 2. Add transaction to the current batch
    this.currentBatch.transactions.push({
      relayRequestElement,
      authorizationElement,
      blsSignature
    })

    // TODO: have a scheduled task to do this; trigger handler, do not create a hanging promise!
    // 3. Check if current batch is ready
    if (this.isCurrentBatchReady()) {
      this.closeCurrentBatch()
      this.currentBatch.aggregatedSignature = await this.aggregateSignatures()
      // eslint-disable-next-line no-void
      void this.broadcastCurrentBatch()
    }
  }

  async getAuthorizedBLSPublicKey (req: RelayTransactionRequest): Promise<PrefixedHexString> {
    let authorizedBLSKey: PrefixedHexString | undefined
    if (req.metadata.authorizationElement == null) {
      authorizedBLSKey = await this.getAuthorizedBLSKey(req.relayRequest.request.from)
      if (authorizedBLSKey == null) {
        throw new Error(`Sender address ${req.relayRequest.request.from} does not have an authorized BLS keypair and must pass an authorization with the batch RelayRequest`)
      }
    } else {
      if (!this.validateAuthorizationElement(req.metadata.authorizationElement)) {
        throw new Error('Authorization element validation failed!')
      }
      authorizedBLSKey = req.metadata.authorizationElement.blsPublicKey.toString()// TODO: types don't match
    }
    return authorizedBLSKey
  }

  private matchesCurrentBatchParameters (req: RelayTransactionRequest): boolean {
    const requestGasPrice = parseInt(req.relayRequest.relayData.gasPrice)
    if (!this.currentBatch.gasPrice.eqn(requestGasPrice)) {
      throw new Error(
        `gasPrice given ${requestGasPrice} not equal current batch gasPrice ${this.currentBatch.gasPrice}`)
    }

    const validUntil = parseInt(req.relayRequest.request.validUntil)
    if (validUntil !== this.currentBatch.validUntil) {
      throw new Error(
        `Request expired (or too close): request valid until ${validUntil} blocks, we expect it to be valid until ${this.currentBatch.validUntil}`)
    }

    if (req.relayRequest.relayData.relayWorker.toLowerCase() !== this.workerAddress.toLowerCase()) {
      throw new Error(
        `Wrong worker address: ${req.relayRequest.relayData.relayWorker}\n`)
    }

    return true
  }

  private validateSignature (relayRequest: RelayRequest, blsPublicKey: PrefixedHexString, signature: PrefixedHexString): boolean {
    return true
  }

  private async getAuthorizedBLSKey (from: Address): Promise<PrefixedHexString | undefined> {
    return this.authorizationsRegistrarInteractor.getAuthorizedBLSKey(from)
  }

  private isAuthorizationValid (from: Address, authorizationElement: AuthorizationElement | undefined): boolean {
    return true
  }

  private validateAuthorizationElement (authorizationElement: AuthorizationElement): boolean {
    return true
  }

  private isCurrentBatchReady (): boolean {
    // 1   checkInterval: number - should be at least two intervals before targetSubmissionTimestamp
    return false
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

  private async aggregateSignatures (): Promise<BN[]> {
    const signatures = this.currentBatch.transactions.map(it => it.blsSignature)
    return this.blsTypedDataSigner.aggregateSignatures(signatures)
  }
}
