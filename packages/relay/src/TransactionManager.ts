// @ts-ignore
import EthVal from 'ethval'
import chalk from 'chalk'
import { Mutex } from 'async-mutex'
import { FeeMarketEIP1559Transaction, Transaction, TxOptions, TypedTransaction } from '@ethereumjs/tx'
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
import { toBN } from 'web3-utils'
import { TransactionType } from '@opengsn/common/dist/types/TransactionType'

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
  gasLimit?: number
  maxFeePerGas?: IntString
  maxPriorityFeePerGas?: IntString
  creationBlockNumber: number
  creationBlockTimestamp: number
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
  transactionType!: TransactionType
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

  async _init (transactionType: TransactionType): Promise<void> {
    this.transactionType = transactionType
    this.rawTxOptions = this.contractInteractor.getRawTxOptions()
    if (this.rawTxOptions == null) {
      throw new Error('_init failed for TransactionManager, was ContractInteractor properly initialized?')
    }
  }

  printBoostedTransactionLog (txHash: string, creationBlockNumber: number, maxFeePerGas: number, maxPriorityFeePerGas: number, isMaxGasPriceReached: boolean): void {
    const maxFeePerGasHumanReadableOld: string = new EthVal(maxFeePerGas).toGwei().toFixed(4)
    const maxPriorityFeePerGasHumanReadableOld: string = new EthVal(maxPriorityFeePerGas).toGwei().toFixed(4)
    this.logger.info(`Boosting stale transaction:
hash                     | ${txHash}
maxFeePerGas             | ${maxFeePerGas} (${maxFeePerGasHumanReadableOld} gwei) ${isMaxGasPriceReached ? chalk.red('(MAX GAS PRICE REACHED)') : ''}
maxPriorityFeePerGas     | ${maxPriorityFeePerGas} (${maxPriorityFeePerGasHumanReadableOld} gwei) ${isMaxGasPriceReached ? chalk.red('(MAX GAS PRICE REACHED)') : ''}
created at               | block #${creationBlockNumber}
`)
  }

  printSendTransactionLog (transaction: StoredTransaction, from: Address): void {
    if (transaction.to == null) {
      throw new Error('transaction.to must be defined')
    }
    const valueString = transaction.value.toString()
    const nonceString = transaction.nonce.toString()
    const maxFeePerGas = transaction.maxFeePerGas
    const maxPriorityFeePerGas = transaction.maxPriorityFeePerGas

    const valueHumanReadable: string = new EthVal(valueString).toEth().toFixed(4)
    const maxFeePerGasHumanReadable: string = new EthVal(maxFeePerGas).toGwei().toFixed(4)
    const maxPriorityFeePerGasHumanReadable: string = new EthVal(maxPriorityFeePerGas).toGwei().toFixed(4)
    this.logger.info(`Broadcasting transaction:
hash                     | 0x${transaction.txId}
from                     | ${from}
to                       | ${transaction.to.toString()}
value                    | ${valueString} (${valueHumanReadable} eth)
nonce                    | ${nonceString}
maxFeePerGas             | ${maxFeePerGas} (${maxFeePerGasHumanReadable} gwei)
maxPriorityFeePerGas     | ${maxPriorityFeePerGas} (${maxPriorityFeePerGasHumanReadable} gwei)
gasLimit                 | ${parseInt('0x' + transaction.gas.toString(16))}
data                     | ${transaction.data}
`)
  }

  async validateBalance (signer: string, maxFeePerGas: number, gasLimit: number): Promise<void> {
    const txCost = toBN(maxFeePerGas).mul(toBN(gasLimit))
    const signerBalance = await this.contractInteractor.getBalance(signer)
    if (txCost.gt(toBN(signerBalance))) {
      throw new Error(`signer ${signer} balance ${signerBalance} too low: tx cost is ${txCost.toString()}`)
    }
  }

  async broadcastTransaction (signedTx: string, verifiedTxId: string): Promise<SignedTransactionDetails> {
    try {
      const transactionHash = await this.contractInteractor.broadcastTransaction(signedTx)
      if (transactionHash.toLowerCase() !== verifiedTxId.toLowerCase()) {
        throw new Error(`txhash mismatch: from receipt: ${transactionHash} from txstore:${verifiedTxId}`)
      }
      return {
        transactionHash,
        signedTx
      }
    } catch (e: any) {
      throw new Error(`Tx broadcast failed: ${(e as Error).message}`)
    }
  }

  async sendTransaction (txDetails: SendTransactionDetails): Promise<SignedTransactionDetails> {
    const encodedCall = txDetails.method?.encodeABI() ?? '0x'
    const maxFeePerGas = parseInt(txDetails.maxFeePerGas ?? await this.gasPriceFetcher.getGasPrice())
    const maxPriorityFeePerGas = parseInt(txDetails.maxPriorityFeePerGas ?? maxFeePerGas.toString())

    let gasLimit = txDetails.gasLimit
    if (gasLimit == null) {
      gasLimit = await this.contractInteractor.estimateGas({
        from: txDetails.signer,
        to: txDetails.destination,
        data: encodedCall,
        value: txDetails.value
      })
      this.logger.debug(`sendTransaction: gasLimit from estimate: ${gasLimit}`)
    }
    await this.validateBalance(txDetails.signer, maxFeePerGas, gasLimit)
    if (isSameAddress(txDetails.destination, constants.ZERO_ADDRESS)) {
      const msg = `Preventing to send transaction with action id ${txDetails.serverAction} to address(0)! Validate your configuration!`
      this.logger.error(msg)
      throw new Error(msg)
    }
    const releaseMutex = await this.nonceMutex.acquire()
    let signedTransaction: SignedTransaction
    let storedTx: StoredTransaction
    try {
      const nonce = await this.pollNonce(txDetails.signer)

      let txToSign: TypedTransaction
      if (this.transactionType === TransactionType.TYPE_TWO) {
        txToSign = new FeeMarketEIP1559Transaction({
          to: txDetails.destination,
          value: txDetails.value,
          gasLimit: gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas: maxPriorityFeePerGas,
          data: Buffer.from(encodedCall.slice(2), 'hex'),
          nonce
        }, this.rawTxOptions)
      } else {
        txToSign = new Transaction({
          to: txDetails.destination,
          value: txDetails.value,
          gasLimit: gasLimit,
          gasPrice: maxFeePerGas,
          data: Buffer.from(encodedCall.slice(2), 'hex'),
          nonce
        }, this.rawTxOptions)
      }
      // TODO omg! do not do this!
      const keyManager = this.managerKeyManager.isSigner(txDetails.signer) ? this.managerKeyManager : this.workersKeyManager
      signedTransaction = keyManager.signTransaction(txDetails.signer, txToSign)
      const metadata: StoredTransactionMetadata = {
        from: txDetails.signer,
        attempts: 1,
        serverAction: txDetails.serverAction,
        creationBlockNumber: txDetails.creationBlockNumber,
        creationBlockTimestamp: txDetails.creationBlockTimestamp
      }
      storedTx = createStoredTransaction(signedTransaction.signedEthJsTx, metadata)
      this.nonces[txDetails.signer]++
      await this.txStoreManager.putTx(storedTx, false)
      this.printSendTransactionLog(storedTx, txDetails.signer)
    } finally {
      releaseMutex()
    }
    return await this.broadcastTransaction(signedTransaction.rawTx, storedTx.txId)
  }

  async updateTransactionWithMinedBlock (tx: StoredTransaction, minedBlockNumber: number): Promise<void> {
    const storedTx: StoredTransaction = Object.assign({}, tx, { minedBlockNumber })
    await this.txStoreManager.putTx(storedTx, true)
  }

  async updateTransactionWithAttempt (
    txToUpdate: TypedTransaction,
    tx: StoredTransaction,
    currentBlockNumber: number,
    currentBlockTimestamp: number
  ): Promise<StoredTransaction> {
    const metadata: StoredTransactionMetadata = {
      attempts: tx.attempts + 1,
      boostBlockNumber: currentBlockNumber,
      boostBlockTimestamp: currentBlockTimestamp,
      from: tx.from,
      serverAction: tx.serverAction,
      creationBlockNumber: tx.creationBlockNumber,
      creationBlockTimestamp: tx.creationBlockTimestamp,
      minedBlockNumber: tx.minedBlockNumber
    }
    const storedTx = createStoredTransaction(txToUpdate, metadata)
    await this.txStoreManager.putTx(storedTx, true)
    return storedTx
  }

  async resendTransaction (
    tx: StoredTransaction,
    currentBlockNumber: number,
    currentBlockTimestamp: number,
    newMaxFee: number,
    newMaxPriorityFee: number,
    isMaxGasPriceReached: boolean): Promise<SignedTransactionDetails> {
    await this.validateBalance(tx.from, newMaxFee, tx.gas)
    let txToSign: TypedTransaction
    if (this.transactionType === TransactionType.TYPE_TWO) {
      txToSign = new FeeMarketEIP1559Transaction(
        {
          to: tx.to,
          gasLimit: tx.gas,
          maxFeePerGas: newMaxFee,
          maxPriorityFeePerGas: newMaxPriorityFee,
          data: tx.data,
          nonce: tx.nonce,
          value: tx.value
        },
        this.rawTxOptions)
    } else {
      txToSign = new Transaction(
        {
          to: tx.to,
          gasLimit: tx.gas,
          gasPrice: newMaxFee,
          data: tx.data,
          nonce: tx.nonce,
          value: tx.value
        },
        this.rawTxOptions)
    }
    const keyManager = this.managerKeyManager.isSigner(tx.from) ? this.managerKeyManager : this.workersKeyManager
    const signedTransaction = keyManager.signTransaction(tx.from, txToSign)
    const storedTx =
      await this.updateTransactionWithAttempt(signedTransaction.signedEthJsTx, tx, currentBlockNumber, currentBlockTimestamp)
    // Print boosted-log only if transaction is boosted (might be resent without boosting)
    if (tx.maxFeePerGas < storedTx.maxFeePerGas || tx.maxPriorityFeePerGas < storedTx.maxPriorityFeePerGas) {
      this.printBoostedTransactionLog(tx.txId, tx.creationBlockNumber, tx.maxFeePerGas, tx.maxPriorityFeePerGas, isMaxGasPriceReached)
    }
    this.printSendTransactionLog(storedTx, tx.from)
    const currentNonce = await this.contractInteractor.getTransactionCount(tx.from)
    this.logger.debug(`Current account nonce for ${tx.from} is ${currentNonce}`)

    return await this.broadcastTransaction(signedTransaction.rawTx, storedTx.txId)
  }

  _resolveNewGasPrice (oldMaxFee: number, oldMaxPriorityFee: number, minMaxPriorityFee: number, minMaxFee: number): { newMaxFee: number, newMaxPriorityFee: number, isMaxGasPriceReached: boolean } {
    let isMaxGasPriceReached = false
    let newMaxFee = Math.round(oldMaxFee * this.config.retryGasPriceFactor)
    let newMaxPriorityFee = Math.round(oldMaxPriorityFee * this.config.retryGasPriceFactor)
    if (newMaxPriorityFee < minMaxPriorityFee) {
      this.logger.warn(`Adjusting newMaxPriorityFee ${newMaxPriorityFee} to current minimum of ${minMaxPriorityFee}`)
      newMaxPriorityFee = minMaxPriorityFee
    }
    if (newMaxFee < minMaxFee) {
      this.logger.warn(`Adjusting minMaxFee ${newMaxFee} to current minimum of ${minMaxFee}`)
      newMaxFee = minMaxFee
    }
    // TODO: use BN for ETH values
    // Sanity check to ensure we are not burning all our balance in gas fees
    if (newMaxFee > parseInt(this.config.maxGasPrice)) {
      isMaxGasPriceReached = true
      this.logger.warn(`Adjusting newMaxFee ${newMaxFee} to maxGasPrice ${this.config.maxGasPrice}`)
      newMaxFee = parseInt(this.config.maxGasPrice)
    }
    if (newMaxPriorityFee > newMaxFee) {
      this.logger.warn(`Adjusting newMaxPriorityFee ${newMaxPriorityFee} to newMaxFee ${newMaxFee}`)
      newMaxPriorityFee = newMaxFee
    }
    return { newMaxFee, newMaxPriorityFee, isMaxGasPriceReached }
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
   * This method uses the oldest pending transaction for reference. If it was not mined in a reasonable time,
   * it is boosted. All consequent transactions with gas price lower than that are boosted as well.
   */
  async boostUnderpricedPendingTransactionsForSigner (
    signer: string,
    currentBlockNumber: number,
    currentBlockTimestamp: number,
    minMaxPriorityFee: number
  ): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
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

    // Sanity-check: the oldest tx.nonce immediately follows 'latest' nonce
    if (nonce !== oldestPendingTx.nonce) {
      throw new Error(`Boosting: missing nonce ${nonce}. Lowest stored tx nonce: ${oldestPendingTx.nonce}`)
    }

    const lastSentAtBlockTimestamp = oldestPendingTx.boostBlockTimestamp ?? oldestPendingTx.creationBlockTimestamp
    // If the tx is still pending, check how long ago we sent it, and resend it if needed
    if (currentBlockTimestamp - lastSentAtBlockTimestamp < this.config.pendingTransactionTimeoutSeconds) {
      this.logger.debug(`${signer} : awaiting transaction with ID: ${oldestPendingTx.txId} to be mined. creationBlockNumber: ${oldestPendingTx.creationBlockNumber} nonce: ${nonce}`)
      return boostedTransactions
    }

    // Calculate new gas price as a % increase over the previous one, with a minimum value
    const gasFees = await this.contractInteractor.getGasFees()
    const {
      newMaxFee,
      newMaxPriorityFee,
      isMaxGasPriceReached
    } = this._resolveNewGasPrice(oldestPendingTx.maxFeePerGas, oldestPendingTx.maxPriorityFeePerGas, minMaxPriorityFee, parseInt(gasFees.baseFeePerGas))
    for (const transaction of sortedTxs) {
      // The tx is underpriced, boost it
      if (transaction.maxFeePerGas < newMaxFee || transaction.maxPriorityFeePerGas < newMaxPriorityFee) {
        const boostedTransactionDetails =
          await this.resendTransaction(transaction, currentBlockNumber, currentBlockTimestamp, newMaxFee, newMaxPriorityFee, isMaxGasPriceReached)
        boostedTransactions.set(transaction.txId, boostedTransactionDetails)
        this.logger.debug(`Replaced transaction: nonce: ${transaction.nonce} sender: ${signer} | ${transaction.txId} => ${boostedTransactionDetails.transactionHash}`)
      } else { // The tx is ok, just rebroadcast it
        try {
          await this.resendTransaction(transaction, currentBlockNumber, currentBlockTimestamp, transaction.maxFeePerGas, transaction.maxPriorityFeePerGas, transaction.maxFeePerGas > parseInt(this.config.maxGasPrice))
        } catch (e: any) {
          this.logger.error(`Rebroadcasting existing transaction: ${(e as Error).message}`)
        }
      }
      if (transaction.attempts > 2) {
        this.logger.debug(`resend ${signer}: Sent tx ${transaction.attempts} times already`)
      }
    }
    return boostedTransactions
  }
}
