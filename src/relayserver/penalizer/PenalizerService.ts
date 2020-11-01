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

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const VERSION = '2.0.0-beta.1'

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
    this.versionManager = new VersionsManager(VERSION)
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
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(1)
    }

    console.log('Penalizer service initialized')
    this.initialized = true
  }

  // Only handles illegal nonce penalization flow)
  async penalizeRepeatedNonce (req: PenalizeRequest): Promise<boolean> {
    if (!this.initialized) {
      return false
    }
    // deserialize the tx
    const rawTxOptions = this.contractInteractor.getRawTxOptions()
    const requestTx = new EthereumJsTransaction(req.signedTx, rawTxOptions)
    const isValidTx = await this.validateTransaction(requestTx)
    // af: so I guess there is no point in accepting the mined transaction as an input
    const isMinedTx = await this.isTransactionMined(requestTx)
    if (isMinedTx || !isValidTx) {
      return false
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
      return false
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
    const method = this.getPenalizeMethod(minedTxBuffers, requestTx)
    const isValidPenalization = await this.validatePenalization(method)
    if (!isValidPenalization) {
      return false
    }
    console.log('wtf 6')
    await this.executeRepeatedNoncePenalization(method)
    return true
  }

  async executeRepeatedNoncePenalization (method: any): Promise<void> {
    const gasLimit = await this.transactionManager.attemptEstimateGas('penalizeRepeatedNonce', method, this.managerAddress)
    const creationBlockNumber = await this.contractInteractor.getBlockNumber()
    const serverAction = ServerAction.PENALIZATION
    const { signedTx } = await this.transactionManager.sendTransaction(
      {
        signer: this.managerAddress,
        method,
        destination: this.contractInteractor.penalizerInstance.address,
        gasLimit,
        creationBlockNumber,
        serverAction
      })
    this.logger.debug(`penalization raw tx: ${signedTx}`)
  }

  getPenalizeMethod (minedTx: EthereumJsTransaction, requestTx: EthereumJsTransaction): any {
    const chainId = this.contractInteractor.getChainId()
    const { data: unsignedMinedTx, signature: minedTxSig } = getDataAndSignature(minedTx, chainId)
    const { data: unsignedRequestTx, signature: requestTxSig } = getDataAndSignature(requestTx, chainId)
    return this.contractInteractor.penalizerInstance.contract.methods.penalizeRepeatedNonce(
      unsignedRequestTx, requestTxSig, unsignedMinedTx,
      minedTxSig, this.contractInteractor.relayHubInstance.address)
  }

  async validateTransaction (requestTx: EthereumJsTransaction): Promise<boolean> {
    console.log('wtf 1')
    // check signature
    if (!requestTx.verifySignature()) {
      // signature is invalid, cannot penalize
      return false
    }
    console.log('wtf 2')
    // check that it's a registered relay
    const relayWorker = bufferToHex(requestTx.getSenderAddress())
    const relayManager = await this.contractInteractor.relayHubInstance.workerToManager(relayWorker)
    if (isZeroAddress(relayManager)) {
      // unknown worker address to Hub
      return false
    }
    console.log('wtf 3')
    const staked = await this.contractInteractor.relayHubInstance.isRelayManagerStaked(relayManager)
    if (!staked) {
      // relayManager is not staked so not penalizable
      return false
    }
    console.log('wtf 4')
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
