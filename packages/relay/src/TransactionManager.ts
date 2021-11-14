// @ts-ignore
import EthVal from 'ethval'
import chalk from 'chalk'
import { Mutex } from 'async-mutex'
import { Transaction, TxOptions } from '@ethereumjs/tx'
import { PrefixedHexString } from 'ethereumjs-util'

import { Address, IntString } from '@opengsn/common/dist/types/Aliases'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'

import { TxStoreManager } from './TxStoreManager'
import { KeyManager, SignedTransaction } from './KeyManager'
import { ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import {
  createStoredTransaction,
  ServerAction,
  StoredTransaction,
  StoredTransactionMetadata
} from './StoredTransaction'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { isSameAddress } from '@opengsn/common/dist/Utils'
import { constants } from '@opengsn/common/dist/Constants'
import { GasPriceFetcher } from './GasPriceFetcher'

export interface SignedTransactionDetails {
  transactionHash: PrefixedHexString
  signedTx: PrefixedHexString
}

export interface SendTransactionDetails {
  signer: Address
  serverAction: ServerAction
  method?: any
  destination: Address
  value?: IntString
  gasLimit: number
  gasPrice?: IntString
  creationBlockNumber: number
}

export class TransactionManager {
  nonceMutex = new Mutex()
  managerKeyManager: KeyManager
  workersKeyManager: KeyManager
  contractInteractor: ContractInteractor
  nonces: Record<Address, number> = {}
  txStoreManager: TxStoreManager
  config: ServerConfigParams
  logger: LoggerInterface
  gasPriceFetcher: GasPriceFetcher

  rawTxOptions!: TxOptions

  constructor (dependencies: ServerDependencies, config: ServerConfigParams) {
    this.contractInteractor = dependencies.contractInteractor
    this.txStoreManager = dependencies.txStoreManager
    this.workersKeyManager = dependencies.workersKeyManager
    this.managerKeyManager = dependencies.managerKeyManager
    this.gasPriceFetcher = dependencies.gasPriceFetcher
    this.logger = dependencies.logger
    this.config = config
    this._initNonces()
  }

  _initNonces (): void {
    // todo: initialize nonces for all signers (currently one manager, one worker)
    this.nonces[this.managerKeyManager.getAddress(0)] = 0
    this.nonces[this.workersKeyManager.getAddress(0)] = 0
  }

  async _init (): Promise<void> {
    this.rawTxOptions = this.contractInteractor.getRawTxOptions()
    if (this.rawTxOptions == null) {
      throw new Error('_init failed for TransactionManager, was ContractInteractor properly initialized?')
    }
  }

  printBoostedTransactionLog (txHash: string, creationBlockNumber: number, gasPrice: number, isMaxGasPriceReached: boolean): void {
    const gasPriceHumanReadableOld: string = new EthVal(gasPrice).toGwei().toFixed(4)
    this.logger.info(`Boosting stale transaction:
hash         | ${txHash}
gasPrice     | ${gasPrice} (${gasPriceHumanReadableOld} gwei) ${isMaxGasPriceReached ? chalk.red('(MAX GAS PRICE REACHED)') : ''}
created at   | block #${creationBlockNumber}
`)
  }

  printSendTransactionLog (transaction: Transaction, from: Address): void {
    if (transaction.to == null) {
      throw new Error('transaction.to must be defined')
    }
    const valueString = transaction.value.toString()
    const nonceString = transaction.nonce.toString()
    const gasPriceString = parseInt('0x' + transaction.gasPrice.toString('hex'))

    const valueHumanReadable: string = new EthVal(valueString).toEth().toFixed(4)
    const gasPriceHumanReadable: string = new EthVal(gasPriceString).toGwei().toFixed(4)
    this.logger.info(`Broadcasting transaction:
hash         | 0x${transaction.hash().toString('hex')}
from         | ${from}
to           | ${transaction.to.toString()}
value        | ${valueString} (${valueHumanReadable} eth)
nonce        | ${nonceString}
gasPrice     | ${gasPriceString} (${gasPriceHumanReadable} gwei)
gasLimit     | ${parseInt('0x' + transaction.gasLimit.toString('hex'))}
data         | 0x${transaction.data.toString('hex')}
`)
  }

  async attemptEstimateGas (methodName: string, method: any, from: Address): Promise<number> {
    try {
      const estimateGas = await method.estimateGas({ from })
      return parseInt(estimateGas)
    } catch (e) {
      const error = e as Error
      this.logger.error(`Failed to estimate gas for method ${methodName}\n. Using default ${this.config.defaultGasLimit}. Error: ${error.message} ${error.stack}`)
    }
    return this.config.defaultGasLimit
  }

  async sendTransaction ({ signer, method, destination, value = '0x', gasLimit, gasPrice, creationBlockNumber, serverAction }: SendTransactionDetails): Promise<SignedTransactionDetails> {
    const encodedCall = method?.encodeABI() ?? '0x'
    const _gasPrice = parseInt(gasPrice ?? await this.gasPriceFetcher.getGasPrice())
    const releaseMutex = await this.nonceMutex.acquire()
    if (isSameAddress(destination, constants.ZERO_ADDRESS)) {
      const msg = `Preventing to send transaction with action id ${serverAction} to address(0)! Validate your configuration!`
      this.logger.error(msg)
      throw new Error(msg)
    }
    let signedTransaction: SignedTransaction
    let storedTx: StoredTransaction
    try {
      const nonce = await this.pollNonce(signer)
      const txToSign = new Transaction({
        to: destination,
        value: value,
        gasLimit,
        gasPrice: _gasPrice,
        data: Buffer.from(encodedCall.slice(2), 'hex'),
        nonce
      }, this.rawTxOptions)
      // TODO omg! do not do this!
      const keyManager = this.managerKeyManager.isSigner(signer) ? this.managerKeyManager : this.workersKeyManager
      signedTransaction = keyManager.signTransaction(signer, txToSign)
      const metadata: StoredTransactionMetadata = {
        from: signer,
        attempts: 1,
        serverAction,
        creationBlockNumber
      }
      storedTx = createStoredTransaction(signedTransaction.signedEthJsTx, metadata)
      this.nonces[signer]++
      await this.txStoreManager.putTx(storedTx, false)
      this.printSendTransactionLog(signedTransaction.signedEthJsTx, signer)
    } finally {
      releaseMutex()
    }
    const transactionHash = await this.contractInteractor.broadcastTransaction(signedTransaction.rawTx)
    if (transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      transactionHash,
      signedTx: signedTransaction.rawTx
    }
  }

  async updateTransactionWithMinedBlock (tx: StoredTransaction, minedBlockNumber: number): Promise<void> {
    const storedTx: StoredTransaction = Object.assign({}, tx, { minedBlockNumber })
    await this.txStoreManager.putTx(storedTx, true)
  }

  async updateTransactionWithAttempt (txToUpdate: Transaction, tx: StoredTransaction, currentBlock: number): Promise<StoredTransaction> {
    const metadata: StoredTransactionMetadata = {
      attempts: tx.attempts + 1,
      boostBlockNumber: currentBlock,
      from: tx.from,
      serverAction: tx.serverAction,
      creationBlockNumber: tx.creationBlockNumber,
      minedBlockNumber: tx.minedBlockNumber
    }
    const storedTx = createStoredTransaction(txToUpdate, metadata)
    await this.txStoreManager.putTx(storedTx, true)
    return storedTx
  }

  async resendTransaction (tx: StoredTransaction, currentBlock: number, newGasPrice: number, isMaxGasPriceReached: boolean): Promise<SignedTransactionDetails> {
    // Resend transaction with exactly the same values except for gas price
    const txToSign = new Transaction(
      {
        to: tx.to,
        gasLimit: tx.gas,
        gasPrice: newGasPrice,
        data: tx.data,
        nonce: tx.nonce,
        value: tx.value
      },
      this.rawTxOptions)

    const keyManager = this.managerKeyManager.isSigner(tx.from) ? this.managerKeyManager : this.workersKeyManager
    const signedTransaction = keyManager.signTransaction(tx.from, txToSign)
    const storedTx = await this.updateTransactionWithAttempt(signedTransaction.signedEthJsTx, tx, currentBlock)
    this.printBoostedTransactionLog(tx.txId, tx.creationBlockNumber, tx.gasPrice, isMaxGasPriceReached)
    this.printSendTransactionLog(signedTransaction.signedEthJsTx, tx.from)
    const currentNonce = await this.contractInteractor.getTransactionCount(tx.from)
    this.logger.debug(`Current account nonce for ${tx.from} is ${currentNonce}`)
    const transactionHash = await this.contractInteractor.broadcastTransaction(signedTransaction.rawTx)
    if (transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      transactionHash,
      signedTx: signedTransaction.rawTx
    }
  }

  _resolveNewGasPrice (oldGasPrice: number, minGasPrice: number): { newGasPrice: number, isMaxGasPriceReached: boolean } {
    let isMaxGasPriceReached = false
    let newGasPrice = oldGasPrice * this.config.retryGasPriceFactor
    if (newGasPrice < minGasPrice) {
      this.logger.warn(`Adjusting newGasPrice ${newGasPrice} to current minimum of ${minGasPrice}`)
      newGasPrice = minGasPrice
    }
    // TODO: use BN for ETH values
    // Sanity check to ensure we are not burning all our balance in gas fees
    if (newGasPrice > parseInt(this.config.maxGasPrice)) {
      isMaxGasPriceReached = true
      this.logger.warn(`Adjusting newGasPrice ${newGasPrice} to maxGasPrice ${this.config.maxGasPrice}`)
      newGasPrice = parseInt(this.config.maxGasPrice)
    }
    return { newGasPrice, isMaxGasPriceReached }
  }

  async pollNonce (signer: Address): Promise<number> {
    const nonce = await this.contractInteractor.getTransactionCount(signer, 'pending')
    if (nonce > this.nonces[signer]) {
      this.logger.warn(`NONCE FIX for signer: ${signer} | new nonce: ${nonce} | wrong nonce: ${this.nonces[signer]}`)
      this.nonces[signer] = nonce
    }
    return this.nonces[signer]
  }

  async removeConfirmedTransactions (blockNumber: number): Promise<void> {
    // Load unconfirmed transactions from store, and bail if there are none
    const sortedTxs = await this.txStoreManager.getAll()
    if (sortedTxs.length === 0) {
      return
    }
    this.logger.debug(`Total of ${sortedTxs.length} transactions are not confirmed yet, checking...`)
    // Get nonce at confirmationsNeeded blocks ago
    const nonces = new Map<string, number>()
    for (const transaction of sortedTxs) {
      const nonce = nonces.get(transaction.from) ?? await this.contractInteractor.getTransactionCount(transaction.from, blockNumber - this.config.confirmationsNeeded)
      nonces.set(transaction.from, nonce)
      if (transaction.nonce < nonce) {
        this.logger.debug(`removing all transaction up to nonce ${nonce} sent by ${transaction.from}`)
        await this.txStoreManager.removeTxsUntilNonce(
          transaction.from,
          nonce
        )
        continue
      }
      const shouldRecheck = transaction.minedBlockNumber == null || blockNumber - transaction.minedBlockNumber >= this.config.confirmationsNeeded
      if (shouldRecheck) {
        const receipt = await this.contractInteractor.getTransaction(transaction.txId)
        if (receipt == null) {
          this.logger.warn(`warning: failed to fetch receipt for tx ${transaction.txId}`)
          continue
        }
        if (receipt.blockNumber == null) {
          this.logger.warn(`warning: null block number in receipt for ${transaction.txId}`)
          continue
        }
        const confirmations = blockNumber - receipt.blockNumber
        if (receipt.blockNumber !== transaction.minedBlockNumber) {
          if (transaction.minedBlockNumber != null) {
            this.logger.warn(`transaction ${transaction.txId} was moved between blocks`)
          }
          if (confirmations < this.config.confirmationsNeeded) {
            this.logger.debug(`Tx ${transaction.txId} was mined but only has ${confirmations} confirmations`)
            await this.updateTransactionWithMinedBlock(transaction, receipt.blockNumber)
            continue
          }
        }
        // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
        this.logger.debug(`removing tx number ${receipt.nonce} sent by ${receipt.from} with ${confirmations} confirmations`)
        await this.txStoreManager.removeTxsUntilNonce(
          receipt.from,
          receipt.nonce
        )
      }
    }
  }

  /**
   * This methods uses the oldest pending transaction for reference. If it was not mined in a reasonable time,
   * it is boosted. All consequent transactions with gas price lower then that are boosted as well.
   */
  async boostUnderpricedPendingTransactionsForSigner (signer: string, currentBlockHeight: number, minGasPrice: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
    const boostedTransactions = new Map<PrefixedHexString, SignedTransactionDetails>()

    // Load unconfirmed transactions from store again
    const sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return boostedTransactions
    }
    // Check if the tx was mined by comparing its nonce against the latest one
    const nonce = await this.contractInteractor.getTransactionCount(signer)
    const oldestPendingTx = sortedTxs[0]
    if (oldestPendingTx.nonce < nonce) {
      this.logger.debug(`${signer} : transaction is mined, awaiting confirmations. Account nonce: ${nonce}, oldest transaction: nonce: ${oldestPendingTx.nonce} txId: ${oldestPendingTx.txId}`)
      return boostedTransactions
    }

    const lastSentAtBlockHeight = oldestPendingTx.boostBlockNumber ?? oldestPendingTx.creationBlockNumber
    // If the tx is still pending, check how long ago we sent it, and resend it if needed
    if (currentBlockHeight - lastSentAtBlockHeight < this.config.pendingTransactionTimeoutBlocks) {
      this.logger.debug(`${signer} : awaiting transaction with ID: ${oldestPendingTx.txId} to be mined. creationBlockNumber: ${oldestPendingTx.creationBlockNumber} nonce: ${nonce}`)
      return boostedTransactions
    }

    // Calculate new gas price as a % increase over the previous one, with a minimum value
    const { newGasPrice, isMaxGasPriceReached } = this._resolveNewGasPrice(oldestPendingTx.gasPrice, minGasPrice)
    const underpricedTransactions = sortedTxs.filter(it => it.gasPrice <= newGasPrice)
    for (const transaction of underpricedTransactions) {
      const boostedTransactionDetails = await this.resendTransaction(transaction, currentBlockHeight, newGasPrice, isMaxGasPriceReached)
      boostedTransactions.set(transaction.txId, boostedTransactionDetails)
      this.logger.debug(`Replaced transaction: nonce: ${transaction.nonce} sender: ${signer} | ${transaction.txId} => ${boostedTransactionDetails.transactionHash}`)
      if (transaction.attempts > 2) {
        this.logger.debug(`resend ${signer}: Sent tx ${transaction.attempts} times already`)
      }
    }
    return boostedTransactions
  }
}
