import { PrefixedHexString, Transaction, TransactionOptions } from 'ethereumjs-tx'

import { Address, IntString } from '../relayclient/types/Aliases'
import { TxStoreManager } from './TxStoreManager'
import ContractInteractor from '../relayclient/ContractInteractor'
import { Mutex } from 'async-mutex'
import { KeyManager } from './KeyManager'
import { ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import log from 'loglevel'
import { createStoredTransaction, StoredTransaction, StoredTransactionMetadata } from './StoredTransaction'

export interface SignedTransactionDetails {
  transactionHash: PrefixedHexString
  signedTx: PrefixedHexString
}

export interface SendTransactionDetails {
  signer: Address
  method?: any
  destination: Address
  value?: IntString
  gasLimit?: IntString
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

  rawTxOptions!: TransactionOptions

  constructor (dependencies: ServerDependencies, config: ServerConfigParams) {
    this.contractInteractor = dependencies.contractInteractor
    this.txStoreManager = dependencies.txStoreManager
    this.workersKeyManager = dependencies.workersKeyManager
    this.managerKeyManager = dependencies.managerKeyManager
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

  async sendTransaction ({ signer, method, destination, value = '0x', gasLimit, gasPrice, creationBlockNumber }: SendTransactionDetails): Promise<SignedTransactionDetails> {
    const encodedCall = method?.encodeABI() ?? '0x'
    const _gasPrice = parseInt(gasPrice ?? await this.contractInteractor.getGasPrice())
    log.debug('gasPrice', _gasPrice)
    log.debug('encodedCall', encodedCall)
    const gas = parseInt(gasLimit ?? await method?.estimateGas({ from: signer }))
    log.debug('gasLimit', gas)
    log.debug('nonceMutex locked?', this.nonceMutex.isLocked())
    const releaseMutex = await this.nonceMutex.acquire()
    let signedTx
    let storedTx: StoredTransaction
    try {
      const nonce = await this.pollNonce(signer)
      log.debug('nonce', nonce)
      const txToSign = new Transaction({
        to: destination,
        value: value,
        gasLimit: gas,
        gasPrice: _gasPrice,
        data: Buffer.from(encodedCall.slice(2), 'hex'),
        nonce
      }, this.rawTxOptions)
      log.trace('txToSign', txToSign)
      // TODO omg! do not do this!
      const keyManager = this.managerKeyManager.isSigner(signer) ? this.managerKeyManager : this.workersKeyManager
      signedTx = keyManager.signTransaction(signer, txToSign)
      const metadata: StoredTransactionMetadata = {
        from: signer,
        attempts: 1,
        creationBlockNumber
      }
      storedTx = createStoredTransaction(txToSign, metadata)
      this.nonces[signer]++
      await this.txStoreManager.putTx(storedTx, false)
    } finally {
      releaseMutex()
    }
    const transactionHash = await this.contractInteractor.broadcastTransaction(signedTx)
    log.info('\ntxhash is', transactionHash)
    if (transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      transactionHash,
      signedTx
    }
  }

  async updateTransactionWithMinedBlock (tx: StoredTransaction, minedBlockNumber: number): Promise<void> {
    const storedTx: StoredTransaction = Object.assign({}, tx, { minedBlockNumber })
    await this.txStoreManager.putTx(storedTx, true)
  }

  async updateTransactionWithAttempt (txToSign: Transaction, tx: StoredTransaction): Promise<StoredTransaction> {
    const metadata: StoredTransactionMetadata = {
      attempts: tx.attempts + 1,
      from: tx.from,
      creationBlockNumber: tx.creationBlockNumber,
      minedBlockNumber: tx.minedBlockNumber
    }
    const storedTx = createStoredTransaction(txToSign, metadata)
    await this.txStoreManager.putTx(storedTx, true)
    return storedTx
  }

  async resendTransaction (tx: StoredTransaction): Promise<SignedTransactionDetails> {
    // Calculate new gas price as a % increase over the previous one
    let newGasPrice = tx.gasPrice * this.config.retryGasPriceFactor
    // TODO: use BN for ETH values
    // Sanity check to ensure we are not burning all our balance in gas fees
    if (newGasPrice > parseInt(this.config.maxGasPrice)) {
      log.debug('Capping gas price to max value of', this.config.maxGasPrice)
      newGasPrice = parseInt(this.config.maxGasPrice)
    }
    // Resend transaction with exactly the same values except for gas price
    const txToSign = new Transaction(
      {
        to: tx.to,
        gasLimit: tx.gas,
        gasPrice: newGasPrice,
        data: tx.data,
        nonce: tx.nonce
      },
      this.rawTxOptions)

    log.debug('txToSign', txToSign)
    const keyManager = this.managerKeyManager.isSigner(tx.from) ? this.managerKeyManager : this.workersKeyManager
    const signedTx = keyManager.signTransaction(tx.from, txToSign)
    const storedTx = await this.updateTransactionWithAttempt(txToSign, tx)

    log.debug('resending tx with nonce', txToSign.nonce, 'from', tx.from)
    log.debug('account nonce', await this.contractInteractor.getTransactionCount(tx.from))
    const transactionHash = await this.contractInteractor.broadcastTransaction(signedTx)
    log.info('\ntxhash is', transactionHash)
    if (transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      transactionHash,
      signedTx
    }
  }

  async pollNonce (signer: Address): Promise<number> {
    const nonce = await this.contractInteractor.getTransactionCount(signer, 'pending')
    if (nonce > this.nonces[signer]) {
      log.warn('NONCE FIX for signer=', signer, ': nonce=', nonce, this.nonces[signer])
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
    log.debug('resending unconfirmed transactions')
    // Get nonce at confirmationsNeeded blocks ago
    for (const transaction of sortedTxs) {
      const shouldBeConfirmed = transaction.minedBlockNumber != null && blockNumber - transaction.minedBlockNumber >= this.config.confirmationsNeeded
      const mightBeConfirmed = transaction.minedBlockNumber == null && blockNumber - transaction.creationBlockNumber >= this.config.confirmationsNeeded
      const shouldRecheck = shouldBeConfirmed || mightBeConfirmed
      if (shouldRecheck) {
        const receipt = await this.contractInteractor.getTransaction(transaction.txId)
        if (receipt == null) {
          log.warn(`failed to fetch receipt for tx ${transaction.txId}`)
          continue
        }
        if (receipt.blockNumber == null) {
          throw new Error(`invalid block number in receipt ${JSON.stringify(receipt)}`)
        }
        if (receipt.blockNumber !== transaction.minedBlockNumber) {
          if (transaction.minedBlockNumber != null) {
            log.warn(`transaction ${transaction.txId} was moved between blocks`)
          }
          if (blockNumber - receipt.blockNumber < this.config.confirmationsNeeded) {
            await this.updateTransactionWithMinedBlock(transaction, receipt.blockNumber)
            continue
          }
        }
        // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
        log.debug(`removing tx number ${receipt.nonce} sent by ${receipt.from} with ${blockNumber - receipt.blockNumber} confirmations`)
        await this.txStoreManager.removeTxsUntilNonce(
          receipt.from,
          receipt.nonce
        )
      }
    }
  }

  async boostOldestPendingTransactionForSigner (signer: string, currentBlockHeight: number): Promise<PrefixedHexString | null> {
    // Load unconfirmed transactions from store again
    const sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return null
    }
    // Check if the tx was mined by comparing its nonce against the latest one
    const nonce = await this.contractInteractor.getTransactionCount(signer)
    if (sortedTxs[0].nonce < nonce) {
      log.debug('resend', signer, ': awaiting confirmations for next mined transaction', nonce, sortedTxs[0].nonce,
        sortedTxs[0].txId)
      return null
    }

    // If the tx is still pending, check how long ago we sent it, and resend it if needed
    if (currentBlockHeight - sortedTxs[0].creationBlockNumber < this.config.pendingTransactionTimeoutBlocks) {
      log.trace(Date.now(), (new Date()), (new Date()).getTime())
      log.debug(`${signer} : awaiting transaction with ID: ${sortedTxs[0].txId} to be mined. creationBlockNumber: ${sortedTxs[0].creationBlockNumber} nonce: ${nonce}`)
      return null
    }
    const { transactionHash, signedTx } = await this.resendTransaction(sortedTxs[0])
    log.debug('resent transaction', sortedTxs[0].nonce, sortedTxs[0].txId, 'as',
      transactionHash)
    if (sortedTxs[0].attempts > 2) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      log.debug(`resend ${signer}: Sent tx ${sortedTxs[0].attempts} times already`)
    }
    return signedTx
  }
}
