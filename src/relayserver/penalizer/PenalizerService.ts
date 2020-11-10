// @ts-ignore
import abiDecoder from 'abi-decoder'
import { PrefixedHexString, Transaction as EthereumJsTransaction, TransactionOptions, TxData } from 'ethereumjs-tx'
import { bufferToHex, bufferToInt, isZeroAddress } from 'ethereumjs-util'
import { Transaction as Web3CoreTransaction } from 'web3-core'

import RelayHubABI from '../../common/interfaces/IRelayHub.json'
import PayMasterABI from '../../common/interfaces/IPaymaster.json'
import StakeManagerABI from '../../common/interfaces/IStakeManager.json'

import ContractInteractor from '../../relayclient/ContractInteractor'
import VersionsManager from '../../common/VersionsManager'
import { BlockExplorerInterface } from './BlockExplorerInterface'
import { getDataAndSignature } from '../../common/Utils'
import replaceErrors from '../../common/ErrorReplacerJSON'
import { TransactionManager } from '../TransactionManager'
import { ServerAction } from '../StoredTransaction'
import { LoggerInterface } from '../../common/LoggerInterface'
import { gsnRuntimeVersion } from '../../common/Version'

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

export enum Accusations {
  repeatedNonce = 'repeatedNonce',
  illegalTransaction = 'illegalTransaction'
}

export interface PenalizeRequest {
  signedTx: PrefixedHexString
}

export interface PenalizerParams {
  transactionManager: TransactionManager
  contractInteractor: ContractInteractor
  txByNonceService: BlockExplorerInterface
  devMode: boolean
}

// TODO: parseInt is dangerous here, convert directly to buffer
function createWeb3Transaction (transaction: Web3CoreTransaction, rawTxOptions: TransactionOptions): EthereumJsTransaction {
  const txData: TxData = {
    gasLimit: transaction.gas,
    gasPrice: parseInt(transaction.gasPrice),
    to: transaction.to ?? '',
    data: transaction.input,
    nonce: transaction.nonce,
    value: parseInt(transaction.value),
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
  devMode: boolean
  initialized: boolean = false

  managerAddress: string

  constructor (params: PenalizerParams, logger: LoggerInterface) {
    this.transactionManager = params.transactionManager
    this.contractInteractor = params.contractInteractor
    this.versionManager = new VersionsManager(gsnRuntimeVersion)
    this.devMode = params.devMode
    this.txByNonceService = params.txByNonceService

    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.logger = logger
  }

  async init (): Promise<void> {
    if (this.initialized) {
      return
    }
    if (this.devMode && (this.contractInteractor.getChainId() < 1000 || this.contractInteractor.getNetworkId() < 1000)) {
      this.logger.error('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(1)
    }

    this.logger.info('Penalizer service initialized')
    this.initialized = true
  }

  async penalizeRepeatedNonce (req: PenalizeRequest): Promise<PrefixedHexString | undefined> {
    if (!this.initialized) {
      throw new Error('PenalizerService is not initialized')
    }
    this.logger.info(`Validating tx ${req.signedTx}`)
    // deserialize the tx
    const rawTxOptions = this.contractInteractor.getRawTxOptions()
    const requestTx = new EthereumJsTransaction(req.signedTx, rawTxOptions)
    const isValidTx = await this.validateTransaction(requestTx)
    // af: so I guess there is no point in accepting the mined transaction as an input
    const isMinedTx = await this.isTransactionMined(requestTx)
    if (isMinedTx || !isValidTx) {
      return undefined
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
      //  this flow has nothing to do with this particular penalization, so just default to 'storeTxForLater' or something
      return undefined
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
    if (!isValidPenalization) {
      return undefined
    }
    return await this.executePenalization('penalizeRepeatedNonce', method)
  }

  async penalizeIllegalTransaction (req: PenalizeRequest): Promise<PrefixedHexString | undefined> {
    const rawTxOptions = this.contractInteractor.getRawTxOptions()
    const requestTx = new EthereumJsTransaction(req.signedTx, rawTxOptions)
    const isValidTx = await this.validateTransaction(requestTx)
    if (!isValidTx) {
      return undefined
    }

    const method = this.getPenalizeIllegalTransactionMethod(requestTx)
    const isValidPenalization = await this.validatePenalization(method)
    if (!isValidPenalization) {
      return undefined
    }

    return await this.executePenalization('penalizeIllegalTransaction', method)
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
    const chainId = this.contractInteractor.getChainId()
    const { data, signature } = getDataAndSignature(requestTx, chainId)
    return this.contractInteractor.penalizerInstance.contract.methods.penalizeIllegalTransaction(
      data, signature, this.contractInteractor.relayHubInstance.address
    )
  }

  getPenalizeRepeatedNonceMethod (minedTx: EthereumJsTransaction, requestTx: EthereumJsTransaction): any {
    const chainId = this.contractInteractor.getChainId()
    const { data: unsignedMinedTx, signature: minedTxSig } = getDataAndSignature(minedTx, chainId)
    const { data: unsignedRequestTx, signature: requestTxSig } = getDataAndSignature(requestTx, chainId)
    return this.contractInteractor.penalizerInstance.contract.methods.penalizeRepeatedNonce(
      unsignedRequestTx, requestTxSig, unsignedMinedTx,
      minedTxSig, this.contractInteractor.relayHubInstance.address)
  }

  async validateTransaction (requestTx: EthereumJsTransaction): Promise<boolean> {
    const txHash = requestTx.hash(true).toString('hex')
    if (!requestTx.verifySignature()) {
      this.logger.info('Transaction does not have a valid signature')
      return false
    }
    const relayWorker = bufferToHex(requestTx.getSenderAddress())
    const relayManager = await this.contractInteractor.relayHubInstance.workerToManager(relayWorker)
    if (isZeroAddress(relayManager)) {
      this.logger.info('Transaction is sent by an unknown worker')
      return false
    }
    const staked = await this.contractInteractor.relayHubInstance.isRelayManagerStaked(relayManager)
    if (!staked) {
      this.logger.info('Transaction is sent by an unstaked relay')
      return false
    }
    this.logger.info(`Transaction ${txHash} is valid`)
    return true
  }

  async isTransactionMined (requestTx: EthereumJsTransaction): Promise<boolean> {
    const txFromNode = await this.contractInteractor.getTransaction(bufferToHex(requestTx.hash(true)))
    return txFromNode != null
  }

  async validatePenalization (method: any): Promise<boolean> {
    try {
      const res = await method.call({
        from: this.managerAddress
      })
      this.logger.debug(`res is ${JSON.stringify(res)}`)
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : JSON.stringify(e, replaceErrors)
      this.logger.debug(`view call to penalizeRepeatedNonce reverted with error message ${message}.\nTx not penalizable.`)
      return false
    }
  }
}
