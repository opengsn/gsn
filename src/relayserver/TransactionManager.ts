import { TransactionReceipt } from 'web3-core'
import { PrefixedHexString, Transaction, TransactionOptions } from 'ethereumjs-tx'

import { Address, IntString } from '../relayclient/types/Aliases'
import { StoredTx, transactionToStoredTx, TxStoreManager } from './TxStoreManager'
import ContractInteractor from '../relayclient/ContractInteractor'
import { Mutex } from 'async-mutex'
import { KeyManager } from './KeyManager'
import { ServerDependencies } from './ServerConfigParams'
import log from 'loglevel'

export interface SignedTransactionDetails {
  receipt: TransactionReceipt
  signedTx: PrefixedHexString
}

export interface SendTransactionDetails {
  signer: Address
  method?: any
  destination: Address
  value?: IntString
  gasLimit?: IntString
  gasPrice?: IntString
}

const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
const confirmationsNeeded = 12
const retryGasPriceFactor = 1.2
const maxGasPrice = 100e9

export class TransactionManager {
  nonceMutex = new Mutex()
  managerKeyManager: KeyManager
  workersKeyManager: KeyManager
  contractInteractor: ContractInteractor
  nonces: Record<Address, number> = {}
  txStoreManager: TxStoreManager

  rawTxOptions!: TransactionOptions

  constructor (contractInteractor: ContractInteractor, dependencies: ServerDependencies) {
    this.contractInteractor = contractInteractor

    this.txStoreManager = dependencies.txStoreManager
    this.workersKeyManager = dependencies.workersKeyManager
    this.managerKeyManager = dependencies.managerKeyManager

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

  async sendTransaction ({ signer, method, destination, value = '0x', gasLimit, gasPrice }: SendTransactionDetails): Promise<SignedTransactionDetails> {
    const encodedCall = method?.encodeABI() ?? '0x'
    const _gasPrice = parseInt(gasPrice ?? await this.contractInteractor.getGasPrice())
    log.debug('gasPrice', _gasPrice)
    log.debug('encodedCall', encodedCall)
    const gas = parseInt(gasLimit ?? await method?.estimateGas({ from: signer }))
    log.debug('gasLimit', gas)
    log.debug('nonceMutex locked?', this.nonceMutex.isLocked())
    const releaseMutex = await this.nonceMutex.acquire()
    let signedTx
    let storedTx: StoredTx
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
      storedTx = transactionToStoredTx(txToSign, signer, 1)
      this.nonces[signer]++
      await this.txStoreManager.putTx(storedTx, false)
    } finally {
      releaseMutex()
    }
    const receipt = await this.contractInteractor.sendSignedTransaction(signedTx)
    log.info('\ntxhash is', receipt.transactionHash)
    if (receipt.transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${receipt.transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      receipt,
      signedTx
    }
  }

  async resendTransaction (tx: StoredTx): Promise<SignedTransactionDetails> {
    // Calculate new gas price as a % increase over the previous one
    let newGasPrice = tx.gasPrice * retryGasPriceFactor
    // Sanity check to ensure we are not burning all our balance in gas fees
    if (newGasPrice > maxGasPrice) {
      log.debug('Capping gas price to max value of', maxGasPrice)
      newGasPrice = maxGasPrice
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
    const storedTx = transactionToStoredTx(txToSign, tx.from, tx.attempts + 1)
    await this.txStoreManager.putTx(storedTx, true)

    log.debug('resending tx with nonce', txToSign.nonce, 'from', tx.from)
    log.debug('account nonce', await this.contractInteractor.getTransactionCount(tx.from))
    const receipt = await this.contractInteractor.sendSignedTransaction(signedTx)
    log.info('\ntxhash is', receipt.transactionHash)
    if (receipt.transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${receipt.transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      receipt,
      signedTx
    }
  }

  async pollNonce (signer: Address): Promise<number> {
    const nonce = await this.contractInteractor.getTransactionCount(signer, 'pending')
    if (nonce > this.nonces[signer]) {
      log.warn('NONCE FIX for signer=', signer, ': nonce=', nonce, this.nonces[signer])
      this.nonces[signer] = nonce
    }
    return nonce
  }

  async resendUnconfirmedTransactionsForSigner (blockNumber: number, signer: string): Promise<PrefixedHexString | null> {
    // Load unconfirmed transactions from store, and bail if there are none
    let sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return null
    }
    log.debug('resending unconfirmed transactions')
    // Get nonce at confirmationsNeeded blocks ago
    for (const transaction of sortedTxs) {
      const receipt = await this.contractInteractor.getTransaction(transaction.txId)
      if (receipt == null) {
        // I believe this means this transaction was not confirmed
        continue
      }
      if (receipt.blockNumber == null) {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        throw new Error(`invalid block number in receipt ${receipt.toString()}`)
      }
      const txBlockNumber = receipt.blockNumber
      const confirmations = blockNumber - txBlockNumber
      if (confirmations >= confirmationsNeeded) {
        // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
        log.debug(`removing tx number ${receipt.nonce} sent by ${receipt.from} with ${confirmations} confirmations`)
        await this.txStoreManager.removeTxsUntilNonce(
          receipt.from,
          receipt.nonce
        )
      }
    }

    // Load unconfirmed transactions from store again
    sortedTxs = await this.txStoreManager.getAllBySigner(signer)
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
    if (Date.now() - (new Date(sortedTxs[0].createdAt)).getTime() < pendingTransactionTimeout) {
      log.trace(Date.now(), (new Date()), (new Date()).getTime())
      log.trace(sortedTxs[0].createdAt, (new Date(sortedTxs[0].createdAt)), (new Date(sortedTxs[0].createdAt)).getTime())
      log.debug('resend', signer, ': awaiting transaction', sortedTxs[0].txId, 'to be mined. nonce:', nonce)
      return null
    }
    const { receipt, signedTx } = await this.resendTransaction(sortedTxs[0])
    log.debug('resent transaction', sortedTxs[0].nonce, sortedTxs[0].txId, 'as',
      receipt.transactionHash)
    if (sortedTxs[0].attempts > 2) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      log.debug(`resend ${signer}: Sent tx ${sortedTxs[0].attempts} times already`)
    }
    return signedTx
  }
}
