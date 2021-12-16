/* eslint-disable @typescript-eslint/restrict-plus-operands */
import chalk from 'chalk'
import { PrefixedHexString } from 'ethereumjs-util'
import { toBN, toHex } from 'web3-utils'

import {
  AuthorizationElement,
  BatchInfo,
  CacheDecoderInteractor,
  encodeBatch
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'

import { Address, IntString } from '@opengsn/common/dist/types/Aliases'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { SendTransactionDetails, TransactionManager } from './TransactionManager'
import { ServerAction } from './StoredTransaction'
import { ContractInteractor, GSNBatchingContractsDeployment, isSameAddress } from '@opengsn/common'
import { ServerConfigParams } from './ServerConfigParams'
import {
  BLSAddressAuthorizationsRegistrarInteractor
} from '@opengsn/common/dist/bls/BLSAddressAuthorizationsRegistrarInteractor'
import { BLSVerifierInteractor } from '@opengsn/common/dist/bls/BLSVerifierInteractor'
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
  readonly authorizationsRegistrarInteractor: BLSAddressAuthorizationsRegistrarInteractor
  readonly blsVerifierInteractor: BLSVerifierInteractor

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
    blsVerifierInteractor: BLSVerifierInteractor
    cacheDecoderInteractor: CacheDecoderInteractor
    batchingContractsDeployment: GSNBatchingContractsDeployment
    authorizationsRegistrarInteractor: BLSAddressAuthorizationsRegistrarInteractor
  }) {
    this.config = _.config
    this.newMinGasPrice = _.newMinGasPrice
    this.workerAddress = _.workerAddress
    this.contractInteractor = _.contractInteractor
    this.transactionManager = _.transactionManager
    this.blsTypedDataSigner = _.blsTypedDataSigner
    this.blsVerifierInteractor = _.blsVerifierInteractor
    this.cacheDecoderInteractor = _.cacheDecoderInteractor
    this.batchingContractsDeployment = _.batchingContractsDeployment
    this.authorizationsRegistrarInteractor = _.authorizationsRegistrarInteractor
  }

  async init (): Promise<this> {
    await this.cacheDecoderInteractor.init()
    await this.blsTypedDataSigner.init()
    await this.blsVerifierInteractor.init()
    await this.authorizationsRegistrarInteractor.init()
    return this
  }

  nextBatch (currentBlockNumber: number, nextBatchId?: number): void {
    const id = nextBatchId ?? this.currentBatch.id + 1
    const targetBlock = currentBlockNumber + this.config.batchDurationBlocks
    const targetSubmissionTimestamp = Date.now() + this.config.batchDurationMS
    this.currentBatch = {
      id,
      targetSubmissionTimestamp,
      targetBlock,
      defaultCalldataCacheDecoderAddress: this.config.batchDefaultCalldataCacheDecoderAddress,
      targetSize: this.config.batchTargetSize,
      transactions: [],
      aggregatedSignature: [],
      isOpen: true,
      targetGasLimit: toBN(this.config.batchTargetGasLimit ?? 0),
      gasPrice: toBN(this.newMinGasPrice),
      workerAddress: this.workerAddress,
      pctRelayFee: this.config.pctRelayFee,
      baseRelayFee: this.config.baseRelayFee,
      maxAcceptanceBudget: this.config.maxAcceptanceBudget
    }
    this.printBatchStatus(currentBlockNumber)
    this.validateCurrentBatchParameters2()
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

  closeCurrentBatch (): void {
    this.currentBatch.isOpen = false
  }

  async addTransactionToCurrentBatch (req: RelayTransactionRequest): Promise<void> {
    this.validateCurrentBatchParameters(req)

    const { relayRequestElement } = await this.cacheDecoderInteractor.compressRelayRequestAndCalldata(req.relayRequest)
    const authorizationElement = req.metadata.authorizationElement
    const blsSignature: PrefixedHexString[] = JSON.parse(req.metadata.signature)

    // validate BLS signatures are ok
    const authorizedBLSKey = await this.getAuthorizedBLSPublicKey({
      address: req.relayRequest.request.from,
      authorizationElement: req.metadata.authorizationElement
    })
    await this.validateSignature(req.relayRequest, authorizedBLSKey, req.metadata.signature)

    // Add transaction to the current batch
    this.currentBatch.transactions.push({
      relayRequestElement,
      authorizationElement,
      blsSignature
    })

    // Trigger the interval worker to send the batch faster if possible
    const blockNumber = await this.contractInteractor.getBlockNumberRightNow()

    this.printBatchStatus(blockNumber)
    // eslint-disable-next-line no-void
    void this.intervalWorker(blockNumber, true)
  }

  async getAuthorizedBLSPublicKey (_: { address: Address, authorizationElement?: AuthorizationElement }): Promise<BN[]> {
    let authorizedBLSKey: BN[] | null
    if (_.authorizationElement == null) {
      authorizedBLSKey = await this.authorizationsRegistrarInteractor.getAuthorizedBLSPublicKey(_.address)
      if (authorizedBLSKey == null) {
        throw new Error(`Sender address (${_.address}) does not have an authorized BLS keypair and must pass an authorization with the batch RelayRequest`)
      }
    } else {
      if (!isSameAddress(_.authorizationElement.authorizer, _.address)) {
        throw new Error(`Requested a transaction from (${_.authorizationElement.authorizer}) but the included authorization is for (${_.address})`)
      }
      await this.validateAuthorizationSignature(_.authorizationElement)
      authorizedBLSKey = _.authorizationElement.blsPublicKey.map(toBN) // TODO: types don't match
    }
    return authorizedBLSKey
  }

  async validateAuthorizationSignature (authorizationElement: AuthorizationElement): Promise<void> {
    const ecdsaSignature = authorizationElement.ecdsaSignature
    // TODO: verify ECDSA signature as well
    const isEcdsaSignatureValid = true
    if (!isEcdsaSignatureValid) {
      throw new Error('ECDSA signature verification failed for the Authorization Element')
    }
    console.log('validateAuthorizationSignature: ECDSA: ', ecdsaSignature)
    const blsPublicKey = authorizationElement.blsPublicKey
    const blsSignature = [authorizationElement.blsSignature[0], authorizationElement.blsSignature[1]]
    const blsMessageZ = await this.blsTypedDataSigner.authorizationElementToG1Point(authorizationElement)
    const blsMessage = [toHex(blsMessageZ[0]), toHex(blsMessageZ[1])]
    const isBLSSignatureValid = await this.blsVerifierInteractor.verifySingle(blsSignature, blsPublicKey, blsMessage)
    if (!isBLSSignatureValid) {
      throw new Error('BLS signature verification failed for the Authorization Element')
    }
  }

  private validateCurrentBatchParameters (req: RelayTransactionRequest): void {
    if (!this.currentBatch.isOpen) {
      // in case there is a race condition between 'add' and 'broadcast', should not happen
      throw new Error(`Current batch ${this.currentBatch.id} has been closed and does not accept new transactions`)
    }
    const requestGasPrice = parseInt(req.relayRequest.relayData.gasPrice)
    if (!this.currentBatch.gasPrice.eq(toBN(requestGasPrice))) {
      throw new Error(
        `gasPrice given ${requestGasPrice} not equal current batch gasPrice ${this.currentBatch.gasPrice.toString()}`)
    }

    const requestGasLimit = parseInt(req.relayRequest.request.gas)
    const currentBatchGasLimit = this.getCurrentBatchGasLimit()
    const combinedGasLimit = currentBatchGasLimit.add(toBN(requestGasLimit))
    if (combinedGasLimit.gt(this.currentBatch.targetGasLimit)) {
      // TODO: test; TODO: implement adding transactions to the future batches
      throw new Error(`
This transaction required too much gas and does not fit the current batch.
Current batch gas     | ${currentBatchGasLimit.toString()}
Request gas limit     | ${requestGasLimit.toString()}
Total                 | ${combinedGasLimit.toString()}
Batch maximum         | ${this.currentBatch.targetGasLimit.toString()}
`)
    }

    const validUntil = parseInt(req.relayRequest.request.validUntil)
    if (validUntil !== this.currentBatch.targetBlock) {
      throw new Error(
        `Incorrect value for  "validUntil": set to block $${validUntil}, we expect it to be valid until #${this.currentBatch.targetBlock}`)
    }

    if (!isSameAddress(req.relayRequest.relayData.relayWorker, this.workerAddress)) {
      throw new Error(`
Wrong worker address: (${req.relayRequest.relayData.relayWorker})
Right worker address: (${this.workerAddress})
`)
    }
  }

  async validateSignature (relayRequest: RelayRequest, blsPublicKey: BN[], signature: PrefixedHexString): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    if (false) {
      throw new Error('BLS signature validation failed for RelayRequest')
    }
  }

  private isAuthorizationValid (from: Address, authorizationElement: AuthorizationElement | undefined): boolean {
    return true
  }

  isCurrentBatchReady (blockNumber: number, printInfoAnyway: boolean = false): boolean {
    if (this.currentBatch == null) {
      return false
    }
    const now = Date.now()
    const isTimeNearTarget = this.currentBatch.targetSubmissionTimestamp - now < this.config.batchTimeThreshold
    const currentBatchGasLimit = this.getCurrentBatchGasLimit()
    const isGasLimitNearTarget = this.currentBatch.targetGasLimit.sub(currentBatchGasLimit).lte(toBN(this.config.batchGasThreshold))
    const isBlockNumberNearTarget = this.currentBatch.targetBlock - blockNumber <= this.config.batchBlocksThreshold
    const isSizeMaxedOut = this.currentBatch.targetSize === this.currentBatch.transactions.length
    const isCurrentBatchReady = isTimeNearTarget || isGasLimitNearTarget || isBlockNumberNearTarget || isSizeMaxedOut

    // TODO: bonus points - if batch only ready because of time, we can drag this out a bit and maybe save gas
    const gasLimitAboveMinimum = currentBatchGasLimit.gte(toBN(this.config.batchMinimalGasLimit))
    const currentBatchCanBeExtended = isTimeNearTarget && !(gasLimitAboveMinimum || isGasLimitNearTarget || isBlockNumberNearTarget || isSizeMaxedOut)

    if (isCurrentBatchReady || printInfoAnyway) {
      this.printBatchStatus(blockNumber, isTimeNearTarget, isGasLimitNearTarget, isBlockNumberNearTarget, isSizeMaxedOut)
    }
    if (currentBatchCanBeExtended) {
      // TODO: implement batch duration extension
      console.log('batch can be extended')
    }
    return isCurrentBatchReady
  }

  private printBatchStatus (
    blockNumber: number,
    isTimeNearTarget: boolean = false,
    isGasLimitNearTarget: boolean = false,
    isBlockNumberNearTarget: boolean = false,
    isSizeMaxedOut: boolean = false
  ) {
    const now = Date.now()
    const currentBatchGasLimit = this.getCurrentBatchGasLimit()

    function pickColor (flag: boolean, message: string): string {
      if (flag) {
        return chalk.green(message)
      } else {
        return chalk.red(message)
      }
    }

    const timeMessage = `
Batch number        | ${this.currentBatch.id}
target time         | ${this.currentBatch.targetSubmissionTimestamp} (${new Date(this.currentBatch.targetSubmissionTimestamp).toISOString()})
current time        | ${now} (${new Date(now).toISOString()})`
    const gasLimitMessage = `
target gas limit    | ${this.currentBatch.targetGasLimit.toString()}
current gas limit   | ${currentBatchGasLimit}`
    const blockMessage = `
target block        | ${this.currentBatch.targetBlock}
current block       | ${blockNumber}`
    const sizeMessage = `
target size         : ${this.currentBatch.targetSize}
current size        : ${this.currentBatch.transactions.length}`
    console.log(`
${pickColor(isTimeNearTarget, timeMessage)}${pickColor(isGasLimitNearTarget, gasLimitMessage)}${pickColor(isBlockNumberNearTarget, blockMessage)}${pickColor(isSizeMaxedOut, sizeMessage)}
`)
  }

  getCurrentBatchGasLimit (): BN {
    const sum = (previousValue: BN, currentValue: BN): BN => {
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
    this.currentBatch.aggregatedSignature = this.aggregateSignatures()
    const { batchCompressedInput, writeSlotsCount } = await this.cacheDecoderInteractor.compressBatch(this.currentBatch)
    this.validateWriteSlotsCount(writeSlotsCount)
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
        gasLimit: this.currentBatch.targetGasLimit.add(toBN(this.config.batchGasOverhead)).toNumber(),
        creationBlockNumber: currentBlock,
        gasPrice: this.currentBatch.gasPrice.toString()
      }
    const { transactionHash } = await this.transactionManager.sendTransaction(details)

    // sends a transaction here
    this.onCurrentBatchBroadcast(transactionHash, 0, Date.now())
    this.nextBatch(currentBlock)
    return transactionHash
  }

  // TODO TBD: sanity check; possibly not needed
  private validateWriteSlotsCount (writeSlotsCount: number): void {
    const expectedWriteSlots = 1000
    if (writeSlotsCount > expectedWriteSlots) {
      throw new Error('batch is corrupt - requires more slots written than originally estimated')
    }
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
    console.log('setNewMinGasPrice', newGasPrice)
    this.newMinGasPrice = newGasPrice
  }

  /**
   * TODO: if block gas limit changes to be below target batch gas limit we should adjust somehow
   */
  setNewBlockGasLimit (blockGasLimit: IntString): void {
    throw new Error('not implemented')
  }

  private aggregateSignatures (): BN[] {
    const signatures = this.currentBatch.transactions.map(it => it.blsSignature)
    return this.blsTypedDataSigner.aggregateSignatures(signatures)
  }

  intervalWorker (blockNumber: number, printInfoAnyway: boolean = false): void {
    if (this._workerSemaphoreOn) {
      console.warn('BatchManager: different worker is not finished yet, skipping this block')
      return
    }
    if (this.isCurrentBatchReady(blockNumber, printInfoAnyway)) {
      this._workerSemaphoreOn = true
      this.closeCurrentBatch()
      this.broadcastCurrentBatch()
        .catch(error => {
          console.error(error)
        })
        .finally(() => {
          this._workerSemaphoreOn = false
        })
    }
  }

  /**
   * Smoke self-test as there are a few ways for the batch to get misconfigured
   */
  validateCurrentBatchParameters2 (): void {
    // 1. timeThreshold > > check interval
    // 2. batchDurationMS > > timeThreshold
    // 3. gas target < < block gas limit
    // 4. gas overhead < < gas target
  }
}
