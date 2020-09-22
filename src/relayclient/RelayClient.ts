import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { HttpProvider } from 'web3-core'
import { constants } from '../common/Constants'

import RelayRequest from '../common/EIP712/RelayRequest'
import { RelayMetadata, RelayTransactionRequest } from './types/RelayTransactionRequest'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { Address, AsyncDataCallback, PingFilter } from './types/Aliases'
import HttpClient from './HttpClient'
import ContractInteractor from './ContractInteractor'
import RelaySelectionManager from './RelaySelectionManager'
import { IKnownRelaysManager } from './KnownRelaysManager'
import AccountManager from './AccountManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import { configureGSN, getDependencies, GSNConfig, GSNDependencies } from './GSNConfigurator'
import { RelayInfo } from './types/RelayInfo'
import { decodeRevertReason } from '../common/Utils'
import { EventEmitter } from 'events'

import {
  GsnEvent,
  GsnInitEvent,
  GsnNextRelayEvent,
  GsnDoneRefreshRelaysEvent,
  GsnRefreshRelaysEvent, GsnRelayerResponseEvent, GsnSendToRelayerEvent, GsnSignRequestEvent, GsnValidateRequestEvent
} from './GsnEvents'

// generate "approvalData" and "paymasterData" for a request.
// both are bytes arrays. paymasterData is part of the client request.
// approvalData is created after request is filled and signed.
export const EmptyDataCallback: AsyncDataCallback = async (): Promise<PrefixedHexString> => {
  return '0x'
}

export const GasPricePingFilter: PingFilter = (pingResponse, gsnTransactionDetails) => {
  if (
    gsnTransactionDetails.gasPrice != null &&
    parseInt(pingResponse.minGasPrice) > parseInt(gsnTransactionDetails.gasPrice)
  ) {
    throw new Error(`Proposed gas price: ${gsnTransactionDetails.gasPrice}; relay's MinGasPrice: ${pingResponse.minGasPrice}`)
  }
}

interface RelayingAttempt {
  transaction?: Transaction
  error?: Error
}

export interface RelayingResult {
  transaction?: Transaction
  pingErrors: Map<string, Error>
  relayingErrors: Map<string, Error>
}

export class RelayClient {
  readonly emitter = new EventEmitter()
  readonly config: GSNConfig
  private readonly httpClient: HttpClient
  protected contractInteractor: ContractInteractor
  protected knownRelaysManager: IKnownRelaysManager
  private readonly asyncApprovalData: AsyncDataCallback
  private readonly asyncPaymasterData: AsyncDataCallback
  private readonly transactionValidator: RelayedTransactionValidator
  private readonly pingFilter: PingFilter

  public readonly accountManager: AccountManager
  private initialized = false

  /**
   * create a RelayClient library object, to force contracts to go through a relay.
   */
  constructor (
    provider: HttpProvider,
    configOverride: Partial<GSNConfig>,
    overrideDependencies?: Partial<GSNDependencies>
  ) {
    const config = configureGSN(configOverride)
    const dependencies = getDependencies(config, provider, overrideDependencies)

    this.config = dependencies.config
    this.httpClient = dependencies.httpClient
    this.contractInteractor = dependencies.contractInteractor
    this.knownRelaysManager = dependencies.knownRelaysManager
    this.transactionValidator = dependencies.transactionValidator
    this.accountManager = dependencies.accountManager
    this.pingFilter = dependencies.pingFilter
    this.asyncApprovalData = dependencies.asyncApprovalData
    this.asyncPaymasterData = dependencies.asyncPaymasterData
  }

  /**
   * register a listener for GSN events
   * @see GsnEvent and its subclasses for emitted events
   * @param handler callback function to handle events
   */
  registerEventListener (handler: (event: GsnEvent) => void): void {
    this.emitter.on('gsn', handler)
  }

  /**
   * unregister previously registered event listener
   * @param handler callback function to unregister
   */
  unregisterEventListener (handler: (event: GsnEvent) => void): void {
    this.emitter.off('gsn', handler)
  }

  private emit (event: GsnEvent): void {
    this.emitter.emit('gsn', event)
  }

  /**
   * In case Relay Server does not broadcast the signed transaction to the network,
   * client also broadcasts the same transaction. If the transaction fails with nonce
   * error, it indicates Relay may have signed multiple transactions with same nonce,
   * causing a DoS attack.
   *
   * @param {*} transaction - actual Ethereum transaction, signed by a relay
   */
  async _broadcastRawTx (transaction: Transaction): Promise<{ hasReceipt: boolean, broadcastError?: Error, wrongNonce?: boolean }> {
    const rawTx = '0x' + transaction.serialize().toString('hex')
    const txHash = '0x' + transaction.hash(true).toString('hex')
    if (this.config.verbose) {
      console.log('txHash= ' + txHash)
    }
    try {
      if (await this._isAlreadySubmitted(txHash)) {
        return { hasReceipt: true }
      }

      // can't find the TX in the mempool. broadcast it ourselves.
      await this.contractInteractor.sendSignedTransaction(rawTx)
      return { hasReceipt: true }
    } catch (broadcastError) {
      // don't display error for the known-good cases
      if (broadcastError?.message.match(/the tx doesn't have the correct nonce|known transaction/) != null) {
        return {
          hasReceipt: false,
          wrongNonce: true,
          broadcastError
        }
      }
      return { hasReceipt: false, broadcastError }
    }
  }

  async _isAlreadySubmitted (txHash: string): Promise<boolean> {
    const [txMinedReceipt, pendingBlock] = await Promise.all([
      this.contractInteractor.web3.eth.getTransactionReceipt(txHash),
      // mempool transactions
      this.contractInteractor.web3.eth.getBlock('pending')
    ])

    if (txMinedReceipt != null) {
      return true
    }

    if (pendingBlock.transactions.includes(txHash)) {
      return true
    }
    return false
  }

  async _init (): Promise<void> {
    if (this.initialized) { return }
    this.emit(new GsnInitEvent())
    await this.contractInteractor.init()
    this.initialized = true
  }

  async relayTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    await this._init()
    // TODO: should have a better strategy to decide how often to refresh known relays
    this.emit(new GsnRefreshRelaysEvent())
    await this.knownRelaysManager.refresh()
    gsnTransactionDetails.gasPrice = gsnTransactionDetails.forceGasPrice ?? await this._calculateGasPrice()
    if (gsnTransactionDetails.gas == null) {
      const estimated = await this.contractInteractor.estimateGas(gsnTransactionDetails)
      gsnTransactionDetails.gas = `0x${estimated.toString(16)}`
    }
    const relaySelectionManager = await new RelaySelectionManager(gsnTransactionDetails, this.knownRelaysManager, this.httpClient, this.pingFilter, this.config).init()
    this.emit(new GsnDoneRefreshRelaysEvent((relaySelectionManager.relaysLeft().length)))
    const relayingErrors = new Map<string, Error>()
    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay()
      if (activeRelay != null) {
        this.emit(new GsnNextRelayEvent(activeRelay.relayInfo.relayUrl))
        relayingAttempt = await this._attemptRelay(activeRelay, gsnTransactionDetails)
          .catch(error => ({ error }))
        if (relayingAttempt.transaction == null) {
          relayingErrors.set(activeRelay.relayInfo.relayUrl, relayingAttempt.error ?? new Error('No error reason was given'))
          continue
        }
      }
      return {
        transaction: relayingAttempt?.transaction,
        relayingErrors,
        pingErrors: relaySelectionManager.errors
      }
    }
  }

  async _calculateGasPrice (): Promise<PrefixedHexString> {
    const pct = this.config.gasPriceFactorPercent
    const networkGasPrice = await this.contractInteractor.getGasPrice()
    let gasPrice = Math.round(parseInt(networkGasPrice) * (pct + 100) / 100)
    if (this.config.minGasPrice != null && gasPrice < this.config.minGasPrice) {
      gasPrice = this.config.minGasPrice
    }
    return `0x${gasPrice.toString(16)}`
  }

  async _attemptRelay (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayingAttempt> {
    if (this.config.verbose) {
      console.log(`attempting relay: ${JSON.stringify(relayInfo)} transaction: ${JSON.stringify(gsnTransactionDetails)}`)
    }
    const maxAcceptanceBudget = parseInt(relayInfo.pingResponse.maxAcceptanceBudget)
    const httpRequest = await this._prepareRelayHttpRequest(relayInfo, gsnTransactionDetails)

    this.emit(new GsnValidateRequestEvent())

    const acceptRelayCallResult = await this.contractInteractor.validateAcceptRelayCall(maxAcceptanceBudget, httpRequest.relayRequest, httpRequest.metadata.signature, httpRequest.metadata.approvalData)
    if (!acceptRelayCallResult.paymasterAccepted) {
      let message: string
      if (acceptRelayCallResult.reverted) {
        message = 'local view call to \'relayCall()\' reverted'
      } else {
        message = 'paymaster rejected in local view call to \'relayCall()\' '
      }
      return { error: new Error(`${message}: ${decodeRevertReason(acceptRelayCallResult.returnValue)}`) }
    }
    let hexTransaction: PrefixedHexString
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      hexTransaction = await this.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, httpRequest)
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        this.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      if (this.config.verbose) {
        console.log('relayTransaction: ', JSON.stringify(httpRequest))
      }
      return { error }
    }
    const transaction = new Transaction(hexTransaction, this.contractInteractor.getRawTxOptions())
    if (!this.transactionValidator.validateRelayResponse(httpRequest, maxAcceptanceBudget, hexTransaction)) {
      this.emit(new GsnRelayerResponseEvent(false))
      this.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return { error: new Error('Returned transaction did not pass validation') }
    }
    this.emit(new GsnRelayerResponseEvent(true))
    await this._broadcastRawTx(transaction)
    return {
      transaction
    }
  }

  async _prepareRelayHttpRequest (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayTransactionRequest> {
    const forwarderAddress = await this.resolveForwarder(gsnTransactionDetails)
    const paymaster = gsnTransactionDetails.paymaster ?? this.config.paymasterAddress

    const senderNonce = await this.contractInteractor.getSenderNonce(gsnTransactionDetails.from, forwarderAddress)
    const relayWorker = relayInfo.pingResponse.relayWorkerAddress
    const gasPriceHex = gsnTransactionDetails.gasPrice
    const gasLimitHex = gsnTransactionDetails.gas
    if (gasPriceHex == null || gasLimitHex == null) {
      throw new Error('RelayClient internal exception. Gas price or gas limit still not calculated. Cannot happen.')
    }
    if (gasPriceHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid gasPrice hex string: ${gasPriceHex}`)
    }
    if (gasLimitHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid gasLimit hex string: ${gasLimitHex}`)
    }
    const gasLimit = parseInt(gasLimitHex, 16).toString()
    const gasPrice = parseInt(gasPriceHex, 16).toString()
    const value = gsnTransactionDetails.value ?? '0'
    const relayRequest: RelayRequest = {
      request: {
        to: gsnTransactionDetails.to,
        data: gsnTransactionDetails.data,
        from: gsnTransactionDetails.from,
        value: value,
        nonce: senderNonce,
        gas: gasLimit
      },
      relayData: {
        pctRelayFee: relayInfo.relayInfo.pctRelayFee,
        baseRelayFee: relayInfo.relayInfo.baseRelayFee,
        gasPrice,
        paymaster,
        paymasterData: '', // temp value. filled in by asyncPaymasterData, below.
        clientId: this.config.clientId,
        forwarder: forwarderAddress,
        relayWorker
      }
    }

    // put paymasterData into struct before signing
    relayRequest.relayData.paymasterData = await this.asyncPaymasterData(relayRequest)
    this.emit(new GsnSignRequestEvent())
    const signature = await this.accountManager.sign(relayRequest)
    const approvalData = await this.asyncApprovalData(relayRequest)
    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const transactionCount = await this.contractInteractor.getTransactionCount(relayWorker)
    const relayMaxNonce = transactionCount + this.config.maxRelayNonceGap
    // TODO: the server accepts a flat object, and that is why this code looks like shit.
    //  Must teach server to accept correct types
    const metadata: RelayMetadata = {
      relayHubAddress: this.config.relayHubAddress,
      signature,
      approvalData,
      relayMaxNonce
    }
    const httpRequest: RelayTransactionRequest = {
      relayRequest,
      metadata
    }
    if (this.config.verbose) {
      console.log(`Created HTTP relay request: ${JSON.stringify(httpRequest)}`)
    }

    return httpRequest
  }

  async resolveForwarder (gsnTransactionDetails: GsnTransactionDetails): Promise<Address> {
    let forwarderAddress = gsnTransactionDetails.forwarder ?? this.config.forwarderAddress
    if (forwarderAddress !== constants.ZERO_ADDRESS) {
      const isRecipientDeployed = await this.contractInteractor.isContractDeployed(gsnTransactionDetails.to)
      if (!isRecipientDeployed) {
        console.warn(`No IRelayRecipient code at ${gsnTransactionDetails.to}, proceeding without validating 'isTrustedForwarder'!
        Unless you are using some counterfactual contract deployment technique the transaction will fail!`)
      } else {
        const isTrusted = await this.contractInteractor.isTrustedForwarder(gsnTransactionDetails.to, forwarderAddress)
        if (!isTrusted) {
          throw new Error('The Forwarder address configured but is not trusted by the Recipient contract')
        }
      }
    } else {
      try {
        if (this.config.verbose) {
          console.log(`will attempt to get trusted forwarder from: ${gsnTransactionDetails.to}`)
        }
        forwarderAddress = await this.contractInteractor.getForwarder(gsnTransactionDetails.to)
        if (this.config.verbose) {
          console.log(`on-chain forwarder for: ${gsnTransactionDetails.to} is ${forwarderAddress}`)
        }
      } catch (e) {
        throw new Error('No forwarder address configured and no getTrustedForwarder in target contract (fetching from Recipient failed)')
      }
    }

    return forwarderAddress
  }
}
