// @ts-ignore
import abiDecoder from 'abi-decoder'
import crypto from 'crypto'
import { Transaction as EthereumJsTransaction, TxOptions, TxData } from '@ethereumjs/tx'
import { TransactionResponse } from '@ethersproject/providers'
import { bufferToHex, isZeroAddress, PrefixedHexString, toBuffer } from 'ethereumjs-util'
import * as ethUtils from 'ethereumjs-util'

import PayMasterABI from '@opengsn/common/dist/interfaces/IPaymaster.json'
import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'
import StakeManagerABI from '@opengsn/common/dist/interfaces/IStakeManager.json'

import {
  AuditRequest,
  AuditResponse,
  CommitAdded,
  ContractInteractor,
  LoggerInterface,
  VersionsManager,
  address2topic,
  constants,
  gsnRequiredVersion,
  gsnRuntimeVersion,
  removeHexPrefix,
  toHex,
  toNumber
} from '@opengsn/common'

import { replaceErrors } from '@opengsn/common/dist/ErrorReplacerJSON'
import { BlockExplorerInterface } from './BlockExplorerInterface'
import { getDataAndSignature } from './PenalizerUtils'

import { ServerAction } from '../StoredTransaction'
import { TransactionManager } from '../TransactionManager'

import { ServerConfigParams } from '../ServerConfigParams'
import { Web3MethodsBuilder } from '../Web3MethodsBuilder'

import Timeout = NodeJS.Timeout

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const INVALID_SIGNATURE = 'Transaction does not have a valid signature'
const UNKNOWN_WORKER = 'Transaction is sent by an unknown worker'
const UNSTAKED_RELAY = 'Transaction is sent by an unstaked relay'
const MINED_TRANSACTION = 'Transaction is the one mined on the current chain and no conflicting transaction is known to this server'
const NONCE_FORWARD = 'Transaction nonce is higher then current account nonce and no conflicting transaction is known to this server'

export interface PenalizerDependencies {
  transactionManager: TransactionManager
  contractInteractor: ContractInteractor
  web3MethodsBuilder: Web3MethodsBuilder
  txByNonceService: BlockExplorerInterface
}

function createWeb3Transaction (transaction: TransactionResponse, rawTxOptions: TxOptions): EthereumJsTransaction {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const gasPrice = '0x' + BigInt(transaction.gasPrice!.toString()).toString(16)
  const value = '0x' + BigInt(transaction.value.toString()).toString(16)
  const txData: TxData = {
    gasLimit: toHex(transaction.gasLimit.toString()),
    gasPrice,
    to: transaction.to ?? '',
    data: transaction.data,
    nonce: transaction.nonce,
    value,
    v: transaction.v,
    r: transaction.r,
    s: transaction.s
  }
  return new EthereumJsTransaction(txData, rawTxOptions)
}

/**
 * types of penalization supported by a penalizer
 * string values are for logging purposes only
 */
enum PenalizationTypes {
  ILLEGAL_TRANSACTION = 'penalizeIllegalTransaction',
  REPEATED_NONCE = 'penalizeRepeatedNonce'
}

interface DelayedPenalization {
  readyBlockNumber?: number
  type: PenalizationTypes
  commitHash: PrefixedHexString
  methodArgs: PrefixedHexString[]
}

export class PenalizerService {
  private workerTask?: Timeout

  // TODO: TransactionManager is not integrated with Penalizer Service, so there is a duplication here
  /** Maps block where commitment becomes valid to penalization details */
  scheduledPenalizations: DelayedPenalization[] = []
  transactionManager: TransactionManager
  contractInteractor: ContractInteractor
  web3MethodsBuilder: Web3MethodsBuilder
  txByNonceService: BlockExplorerInterface
  versionManager: VersionsManager
  logger: LoggerInterface
  config: ServerConfigParams
  initialized: boolean = false

  managerAddress: string

  constructor (params: PenalizerDependencies, logger: LoggerInterface, config: ServerConfigParams) {
    this.transactionManager = params.transactionManager
    this.contractInteractor = params.contractInteractor
    this.web3MethodsBuilder = params.web3MethodsBuilder
    this.versionManager = new VersionsManager(gsnRuntimeVersion, config.requiredVersionRange ?? gsnRequiredVersion)
    this.config = config
    this.txByNonceService = params.txByNonceService

    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.logger = logger
  }

  async init (startWorker: boolean = true): Promise<void> {
    if (this.initialized) {
      return
    }

    this.logger.info('Penalizer service initialized')
    if (startWorker) {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      this.workerTask = setInterval(this.intervalHandler.bind(this), this.config.checkInterval)
      this.logger.debug(`Started checking for ready penalization commitments every ${this.config.checkInterval}ms`)
    }
    this.initialized = true
  }

  stop (): void {
    if (this.workerTask != null) {
      clearInterval(this.workerTask)
    }
  }

  async penalizeRepeatedNonce (req: AuditRequest): Promise<AuditResponse> {
    if (!this.initialized) {
      throw new Error('PenalizerService is not initialized')
    }
    if (this.config.etherscanApiUrl.length === 0) {
      return {
        message: 'Etherscan API URL is not set on this server!'
      }
    }
    this.logger.info(`Validating tx ${req.signedTx}`)
    // deserialize the tx
    const rawTxOptions = this.contractInteractor.getRawTxOptions()
    const requestTx = EthereumJsTransaction.fromSerializedTx(toBuffer(req.signedTx), rawTxOptions)
    const validationResult = await this.validateTransaction(requestTx)
    if (!validationResult.valid) {
      return {
        message: validationResult.error
      }
    }

    const isMinedTx = await this.isTransactionMined(requestTx)
    if (isMinedTx) {
      return {
        message: MINED_TRANSACTION
      }
    }

    const relayWorker = bufferToHex(requestTx.getSenderAddress().toBuffer())
    // read the relay worker's nonce from blockchain
    const currentNonce = await this.contractInteractor.getTransactionCount(relayWorker, 'pending')
    // if tx nonce > current nonce, publish tx and await
    // otherwise, get mined tx with same nonce. if equals (up to different gasPrice) to received tx, return.
    // Otherwise, penalize.
    const transactionNonce = requestTx.nonce.toNumber()
    if (transactionNonce > currentNonce) {
      // TODO: store it, and see how sender behaves later...
      //  also, if we have already stored some transaction for this sender, check if these two are in nonce conflict.
      //  this flow has nothing to do with this particular penalization, so just default to 'storeTxForLater' or something
      return {
        message: NONCE_FORWARD
      }
    }

    // run penalize in view mode to see if penalizable
    const minedTransactionData = await this.txByNonceService.getTransactionByNonce(relayWorker, transactionNonce)
    if (minedTransactionData == null) {
      throw Error(`TxByNonce service failed to fetch tx with nonce ${transactionNonce} of relayer ${relayWorker}`)
    }
    const minedTx = await this.contractInteractor.getTransaction(minedTransactionData.hash)
    if (minedTx == null) {
      throw Error(`Failed to get transaction ${minedTransactionData.hash} from node`)
    }
    const minedTxBuffers = createWeb3Transaction(minedTx, rawTxOptions)
    const randomValue = bufferToHex(crypto.randomBytes(32))
    const penalizationArguments = this.getPenalizeRepeatedNonceArguments(minedTxBuffers, requestTx, randomValue)
    const method = this.getMethod(PenalizationTypes.REPEATED_NONCE, penalizationArguments)
    const isValidPenalization = await this.validatePenalization(method)
    if (!validationResult.valid) {
      return {
        message: isValidPenalization.error
      }
    }
    const commitHash = this.calculateCommitHash(method)
    const delayedPenalization: DelayedPenalization = {
      commitHash,
      type: PenalizationTypes.REPEATED_NONCE,
      methodArgs: penalizationArguments
    }
    const commitTxHash = await this.commitAndScheduleReveal(delayedPenalization)
    return { commitTxHash }
  }

  calculateCommitHash (method: any): PrefixedHexString {
    const msgData: string = method.encodeABI()
    const msgDataHash = `0x${ethUtils.keccak256(Buffer.from(removeHexPrefix(msgData), 'hex')).toString('hex')}`
    return `0x${ethUtils.keccak256(Buffer.from(removeHexPrefix(msgDataHash + this.managerAddress.slice(2).toLowerCase()), 'hex')).toString('hex')}`
  }

  async intervalHandler (): Promise<PrefixedHexString[]> {
    if (this.scheduledPenalizations.length === 0) {
      return []
    }
    console.log('interval handler called')
    // step 1. see if sent some commitments and these are now mined
    await this.queryReadyBlocksForMinedCommitments()
    // step 2. now all commitments have a due date, let's see if any are up for penalization
    return await this.executeReadyPenalizations()
  }

  async executeReadyPenalizations (): Promise<PrefixedHexString[]> {
    const currentBlockNumber = await this.contractInteractor.getBlockNumber()
    const readyPenalizations = this.scheduledPenalizations.filter(it => {
      return it.readyBlockNumber != null && it.readyBlockNumber <= currentBlockNumber
    })
    const executedPenalizations: PrefixedHexString[] = []

    for (const penalization of readyPenalizations) {
      // Remove ready penalizations from memory
      const index = this.scheduledPenalizations.indexOf(penalization)
      this.scheduledPenalizations.splice(index, 1)

      // now broadcast the penalization transaction
      const penalizationTxHash = await this.executeDelayedPenalization(penalization)
      executedPenalizations.push(penalizationTxHash)
    }
    return executedPenalizations
  }

  /**
   * Note: this method modifies elements of {@link scheduledPenalizations} in-place
   */
  async queryReadyBlocksForMinedCommitments (): Promise<void> {
    const unconfirmedPenalizations = this.scheduledPenalizations.filter(it => it.readyBlockNumber === undefined)
    const nonMinedCommitHashes = unconfirmedPenalizations.map(up => up.commitHash)
    if (unconfirmedPenalizations.length > 0) {
      // TODO: sanitize functional stuff
      const topics = [address2topic(this.managerAddress)]
      const commitments = await this.contractInteractor.getPastEventsForPenalizer([CommitAdded], topics, { fromBlock: 1 })
      const newlyMinedCommitments = commitments
        .filter(it => {
          return nonMinedCommitHashes.includes(it.args.commitHash)
        })
      unconfirmedPenalizations.forEach(it => {
        const commitment = newlyMinedCommitments.find(nmc => nmc.args.commitHash === it.commitHash)
        if (commitment != null) {
          it.readyBlockNumber = commitment.args.readyBlockNumber
        }
      })
    }
  }

  async penalizeIllegalTransaction (req: AuditRequest): Promise<AuditResponse> {
    const rawTxOptions = this.contractInteractor.getRawTxOptions()
    const requestTx = EthereumJsTransaction.fromSerializedTx(toBuffer(req.signedTx), rawTxOptions)
    const validationResult = await this.validateTransaction(requestTx)
    if (!validationResult.valid) {
      return {
        message: validationResult.error
      }
    }

    // TODO: remove duplication
    const randomValue = bufferToHex(crypto.randomBytes(32))
    const penalizationArguments = this.getPenalizeIllegalTransactionArguments(requestTx, randomValue)
    const method = this.getMethod(PenalizationTypes.ILLEGAL_TRANSACTION, penalizationArguments)
    const isValidPenalization = await this.validatePenalization(method)
    if (!isValidPenalization.valid) {
      return {
        message: isValidPenalization.error
      }
    }

    const commitHash = this.calculateCommitHash(method)
    const delayedPenalization: DelayedPenalization = {
      commitHash,
      type: PenalizationTypes.ILLEGAL_TRANSACTION,
      methodArgs: penalizationArguments
    }
    const commitTxHash = await this.commitAndScheduleReveal(delayedPenalization)
    return { commitTxHash }
  }

  async commitAndScheduleReveal (delayedPenalization: DelayedPenalization): Promise<any> {
    this.scheduledPenalizations.push(delayedPenalization)
    const method = this.web3MethodsBuilder.getPenalizerCommitMethod(delayedPenalization.commitHash)
    return await this.broadcastTransaction('commit', method)
  }

  async executeDelayedPenalization (delayedPenalization: DelayedPenalization): Promise<PrefixedHexString> {
    const method = this.getMethod(delayedPenalization.type, delayedPenalization.methodArgs)
    return await this.broadcastTransaction(delayedPenalization.type.valueOf(), method)
  }

  async broadcastTransaction (methodName: string, method: any): Promise<PrefixedHexString> {
    const creationBlockNumber = await this.contractInteractor.getBlockNumber()
    const block = await this.contractInteractor.getBlock(creationBlockNumber)
    const creationBlockTimestamp = toNumber(block.timestamp)
    const serverAction = ServerAction.PENALIZATION
    const { signedTx, transactionHash } = await this.transactionManager.sendTransaction(
      {
        signer: this.managerAddress,
        method,
        destination: this.contractInteractor.penalizerInstance.address,
        creationBlockNumber,
        creationBlockHash: block.hash,
        creationBlockTimestamp,
        serverAction
      })
    this.logger.debug(`penalization raw tx: ${signedTx} txHash: ${transactionHash}`)
    return transactionHash
  }

  getPenalizeIllegalTransactionArguments (requestTx: EthereumJsTransaction, randomValue: string): PrefixedHexString[] {
    const chainId = this.contractInteractor.chainId
    const { data, signature } = getDataAndSignature(requestTx, chainId)
    return [
      data, signature, this.contractInteractor.relayHubInstance.address,
      randomValue
    ]
  }

  getPenalizeRepeatedNonceArguments (minedTx: EthereumJsTransaction, requestTx: EthereumJsTransaction, randomValue: string): PrefixedHexString[] {
    const chainId = this.contractInteractor.chainId
    const { data: unsignedMinedTx, signature: minedTxSig } = getDataAndSignature(minedTx, chainId)
    const { data: unsignedRequestTx, signature: requestTxSig } = getDataAndSignature(requestTx, chainId)
    return [
      unsignedRequestTx, requestTxSig, unsignedMinedTx,
      minedTxSig, this.contractInteractor.relayHubInstance.address,
      randomValue
    ]
  }

  async validateTransaction (requestTx: EthereumJsTransaction): Promise<{ valid: boolean, error?: string }> {
    const txHash = requestTx.hash().toString('hex')
    if (!requestTx.verifySignature()) {
      return {
        valid: false,
        error: INVALID_SIGNATURE
      }
    }
    const relayWorker = bufferToHex(requestTx.getSenderAddress().toBuffer())
    const relayManager = await this.contractInteractor.relayHubInstance.getWorkerManager(relayWorker)
    if (isZeroAddress(relayManager)) {
      return {
        valid: false,
        error: UNKNOWN_WORKER
      }
    }
    try {
      await this.contractInteractor.relayHubInstance.verifyRelayManagerStaked(relayManager)
    } catch (e: any) {
      this.logger.info(e.message)
      return {
        valid: false,
        error: UNSTAKED_RELAY
      }
    }
    this.logger.info(`Transaction ${txHash} is valid`)
    return { valid: true }
  }

  async isTransactionMined (requestTx: EthereumJsTransaction): Promise<boolean> {
    const txFromNode = await this.contractInteractor.getTransaction(bufferToHex(requestTx.hash()))
    return txFromNode != null
  }

  async validatePenalization (method: any): Promise<{ valid: boolean, error?: string }> {
    try {
      const res = await method.call({
        from: constants.BURN_ADDRESS
      })
      this.logger.debug(`res is ${JSON.stringify(res)}`)
      return {
        valid: true
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      this.logger.debug(`view call to penalizeRepeatedNonce reverted with error message ${error}.\nTx not penalizable.`)
      return {
        valid: false,
        error
      }
    }
  }

  getMethod (penalizationTypes: PenalizationTypes, methodArgs: PrefixedHexString[]): any {
    switch (penalizationTypes) {
      case PenalizationTypes.REPEATED_NONCE:
        return this.web3MethodsBuilder.getPenalizeRepeatedNonceMethod(...methodArgs)
      case PenalizationTypes.ILLEGAL_TRANSACTION:
        return this.web3MethodsBuilder.getPenalizeIllegalTransactionMethod(...methodArgs)
    }
  }
}
