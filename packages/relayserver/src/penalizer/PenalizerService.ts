// @ts-ignore
import abiDecoder from 'abi-decoder'
import { PrefixedHexString, Transaction as EthereumJsTransaction, TransactionOptions, TxData } from 'ethereumjs-tx'
import { Transaction as Web3CoreTransaction } from 'web3-core'
import { bufferToHex, bufferToInt, isZeroAddress } from 'ethereumjs-util'

import PayMasterABI from '@opengsn/common/dist/interfaces/IPaymaster.json'
import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'
import StakeManagerABI from '@opengsn/common/dist/interfaces/IStakeManager.json'

import ContractInteractor from '@opengsn/common/dist/ContractInteractor'
import VersionsManager from '@opengsn/common/dist/VersionsManager'
import replaceErrors from '@opengsn/common/dist/ErrorReplacerJSON'
import { BlockExplorerInterface } from './BlockExplorerInterface'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { AuditRequest, AuditResponse } from '@opengsn/common/dist/types/AuditRequest'
import { ServerAction } from '../StoredTransaction'
import { TransactionManager } from '../TransactionManager'
import { getDataAndSignature } from '@opengsn/common/dist/Utils'
import { gsnRequiredVersion, gsnRuntimeVersion } from '@opengsn/common/dist/Version'
import { ServerConfigParams } from '../ServerConfigParams'

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
  txByNonceService: BlockExplorerInterface
}

function createWeb3Transaction (transaction: Web3CoreTransaction, rawTxOptions: TransactionOptions): EthereumJsTransaction {
  const gasPrice = '0x' + BigInt(transaction.gasPrice).toString(16)
  const value = '0x' + BigInt(transaction.value).toString(16)
  const txData: TxData = {
    gasLimit: transaction.gas,
    gasPrice,
    to: transaction.to ?? '',
    data: transaction.input,
    nonce: transaction.nonce,
    value,
    // @ts-ignore
    v: transaction.v,
    // @ts-ignore
    r: transaction.r,
    // @ts-ignore
    s: transaction.s
  }
  return new EthereumJsTransaction(txData, rawTxOptions)
}

export class PenalizerService {
  transactionManager: TransactionManager
  contractInteractor: ContractInteractor
  txByNonceService: BlockExplorerInterface
  versionManager: VersionsManager
  logger: LoggerInterface
  config: ServerConfigParams
  initialized: boolean = false

  managerAddress: string

  constructor (params: PenalizerDependencies, logger: LoggerInterface, config: ServerConfigParams) {
    this.transactionManager = params.transactionManager
    this.contractInteractor = params.contractInteractor
    this.versionManager = new VersionsManager(gsnRuntimeVersion, config.requiredVersionRange ?? gsnRequiredVersion)
    this.config = config
    this.txByNonceService = params.txByNonceService

    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.logger = logger
  }

  async init (): Promise<void> {
    if (this.initialized) {
      return
    }

    this.logger.info('Penalizer service initialized')
    this.initialized = true
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
    const requestTx = new EthereumJsTransaction(req.signedTx, rawTxOptions)
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

    const relayWorker = bufferToHex(requestTx.getSenderAddress())
    // read the relay worker's nonce from blockchain
    const currentNonce = await this.contractInteractor.getTransactionCount(relayWorker, 'pending')
    // if tx nonce > current nonce, publish tx and await
    // otherwise, get mined tx with same nonce. if equals (up to different gasPrice) to received tx, return.
    // Otherwise, penalize.
    const transactionNonce = bufferToInt(requestTx.nonce)
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
    const method = this.getPenalizeRepeatedNonceMethod(minedTxBuffers, requestTx)
    const isValidPenalization = await this.validatePenalization(method)
    if (!isValidPenalization.valid) {
      return {
        message: isValidPenalization.error
      }
    }
    const penalizeTxHash = await this.executePenalization('penalizeRepeatedNonce', method)
    return { penalizeTxHash }
  }

  async penalizeIllegalTransaction (req: AuditRequest): Promise<AuditResponse> {
    const rawTxOptions = this.contractInteractor.getRawTxOptions()
    const requestTx = new EthereumJsTransaction(req.signedTx, rawTxOptions)
    const validationResult = await this.validateTransaction(requestTx)
    if (!validationResult.valid) {
      return {
        message: validationResult.error
      }
    }

    const method = this.getPenalizeIllegalTransactionMethod(requestTx)
    const isValidPenalization = await this.validatePenalization(method)
    if (!isValidPenalization.valid) {
      return {
        message: isValidPenalization.error
      }
    }

    const penalizeTxHash = await this.executePenalization('penalizeIllegalTransaction', method)
    return { penalizeTxHash }
  }

  async executePenalization (methodName: string, method: any): Promise<PrefixedHexString> {
    const gasLimit = await this.transactionManager.attemptEstimateGas(methodName, method, this.managerAddress)
    const creationBlockNumber = await this.contractInteractor.getBlockNumber()
    const serverAction = ServerAction.PENALIZATION
    const { signedTx, transactionHash } = await this.transactionManager.sendTransaction(
      {
        signer: this.managerAddress,
        method,
        destination: this.contractInteractor.penalizerInstance.address,
        gasLimit,
        creationBlockNumber,
        serverAction
      })
    this.logger.debug(`penalization raw tx: ${signedTx} txHash: ${transactionHash}`)
    return transactionHash
  }

  getPenalizeIllegalTransactionMethod (requestTx: EthereumJsTransaction): any {
    const chainId = this.contractInteractor.chainId
    const { data, signature } = getDataAndSignature(requestTx, chainId)
    return this.contractInteractor.penalizerInstance.contract.methods.penalizeIllegalTransaction(
      data, signature, this.contractInteractor.relayHubInstance.address
    )
  }

  getPenalizeRepeatedNonceMethod (minedTx: EthereumJsTransaction, requestTx: EthereumJsTransaction): any {
    const chainId = this.contractInteractor.chainId
    const { data: unsignedMinedTx, signature: minedTxSig } = getDataAndSignature(minedTx, chainId)
    const { data: unsignedRequestTx, signature: requestTxSig } = getDataAndSignature(requestTx, chainId)
    return this.contractInteractor.penalizerInstance.contract.methods.penalizeRepeatedNonce(
      unsignedRequestTx, requestTxSig, unsignedMinedTx,
      minedTxSig, this.contractInteractor.relayHubInstance.address)
  }

  async validateTransaction (requestTx: EthereumJsTransaction): Promise<{ valid: boolean, error?: string }> {
    const txHash = requestTx.hash(true).toString('hex')
    if (!requestTx.verifySignature()) {
      return {
        valid: false,
        error: INVALID_SIGNATURE
      }
    }
    const relayWorker = bufferToHex(requestTx.getSenderAddress())
    const relayManager = await this.contractInteractor.relayHubInstance.workerToManager(relayWorker)
    if (isZeroAddress(relayManager)) {
      return {
        valid: false,
        error: UNKNOWN_WORKER
      }
    }
    const staked = await this.contractInteractor.relayHubInstance.isRelayManagerStaked(relayManager)
    if (!staked) {
      return {
        valid: false,
        error: UNSTAKED_RELAY
      }
    }
    this.logger.info(`Transaction ${txHash} is valid`)
    return { valid: true }
  }

  async isTransactionMined (requestTx: EthereumJsTransaction): Promise<boolean> {
    const txFromNode = await this.contractInteractor.getTransaction(bufferToHex(requestTx.hash(true)))
    return txFromNode != null
  }

  async validatePenalization (method: any): Promise<{ valid: boolean, error?: string }> {
    try {
      const res = await method.call({
        from: this.managerAddress
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
}
