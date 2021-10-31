import BN from 'bn.js'
import ow from 'ow'
import { EventEmitter } from 'events'
import { Transaction } from '@ethereumjs/tx'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'

import { ContractInteractor, asRelayCallAbi } from '@opengsn/common/dist/ContractInteractor'
import { GsnTransactionDetails, GsnTransactionDetailsShape } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { VersionsManager } from '@opengsn/common/dist/VersionsManager'
import {
  Address,
  AsyncDataCallback,
  IntString,
  PingFilter,
  Web3ProviderBaseInterface
} from '@opengsn/common/dist/types/Aliases'
import { AuditResponse } from '@opengsn/common/dist/types/AuditRequest'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import {
  RelayMetadata,
  RelayTransactionRequest,
  RelayTransactionRequestShape
} from '@opengsn/common/dist/types/RelayTransactionRequest'
import { decodeRevertReason, getRelayRequestID } from '@opengsn/common/dist/Utils'
import { gsnRequiredVersion, gsnRuntimeVersion } from '@opengsn/common/dist/Version'
import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { HttpWrapper } from '@opengsn/common/dist/HttpWrapper'

import { AccountKeypair, AccountManager } from './AccountManager'
import { DefaultRelayScore, EmptyFilter, KnownRelaysManager } from './KnownRelaysManager'
import { RelaySelectionManager } from './RelaySelectionManager'
import { RelayedTransactionValidator } from './RelayedTransactionValidator'
import { createClientLogger } from './ClientWinstonLogger'
import { defaultGsnConfig, defaultLoggerConfiguration, GSNConfig, GSNDependencies } from './GSNConfigurator'

import {
  GsnDoneRefreshRelaysEvent,
  GsnEvent,
  GsnInitEvent,
  GsnNextRelayEvent,
  GsnRefreshRelaysEvent,
  GsnRelayerResponseEvent,
  GsnSendToRelayerEvent,
  GsnSignRequestEvent,
  GsnValidateRequestEvent
} from './GsnEvents'
import { ForwardRequest } from '@opengsn/common/dist/EIP712/ForwardRequest'
import { RelayData } from '@opengsn/common/dist/EIP712/RelayData'
import { toHex } from 'web3-utils'

// forwarder requests are signed with expiration time.

// generate "approvalData" and "paymasterData" for a request.
// both are bytes arrays. paymasterData is part of the client request.
// approvalData is created after request is filled and signed.
export const EmptyDataCallback: AsyncDataCallback = async (): Promise<PrefixedHexString> => {
  return '0x'
}

export const GasPricePingFilter: PingFilter = (pingResponse, gsnTransactionDetails) => {
  if (
    gsnTransactionDetails.gasPriceForLookup != null &&
    parseInt(pingResponse.minGasPrice) > parseInt(gsnTransactionDetails.gasPriceForLookup)
  ) {
    throw new Error(`Proposed gas price: ${gsnTransactionDetails.gasPrice}; relay's MinGasPrice: ${pingResponse.minGasPrice}`)
  }
}

export interface GSNUnresolvedConstructorInput {
  provider: Web3ProviderBaseInterface
  config: Partial<GSNConfig>
  overrideDependencies?: Partial<GSNDependencies>
}

export interface RelayingAttempt {
  relayRequestID?: PrefixedHexString
  transaction?: Transaction
  hexTransaction?: PrefixedHexString
  error?: Error
  auditPromise?: Promise<AuditResponse>
}

export interface RelayingResult {
  relayRequestID?: PrefixedHexString
  transaction?: Transaction
  pingErrors: Map<string, Error>
  relayingErrors: Map<string, Error>
  auditPromises?: Array<Promise<AuditResponse>>
}

export interface GSNContractsDeploymentResolvedForRequest {
  forwarderAddress: Address
  paymasterAddress: Address
  relayHubAddress: Address
}

export class RelayClient {
  readonly emitter = new EventEmitter()
  config!: GSNConfig
  dependencies!: GSNDependencies
  private readonly rawConstructorInput: GSNUnresolvedConstructorInput

  private initialized = false
  logger!: LoggerInterface
  initializingPromise?: Promise<void>

  protected auditPromises: Array<Promise<AuditResponse>> = []

  constructor (
    rawConstructorInput: GSNUnresolvedConstructorInput
  ) {
    // TODO: backwards-compatibility 102 - remove on next version bump
    if (arguments[0] == null || arguments[0].send != null || arguments[2] != null) {
      throw new Error('Sorry, but the constructor parameters of the RelayClient class have changed. See "GSNUnresolvedConstructorInput" interface for details.')
    }
    this.rawConstructorInput = rawConstructorInput
    this.logger = rawConstructorInput.overrideDependencies?.logger ??
      createClientLogger(rawConstructorInput.config?.loggerConfiguration ?? defaultLoggerConfiguration)
  }

  async init (): Promise<this> {
    if (this.initialized) {
      throw new Error('init() already called')
    }
    this.initializingPromise = this._initInternal()
    await this.initializingPromise
    this.initialized = true
    return this
  }

  async _initInternal (): Promise<void> {
    this.emit(new GsnInitEvent())
    this.config = await this._resolveConfiguration(this.rawConstructorInput)
    this.dependencies = await this._resolveDependencies(this.rawConstructorInput)
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

  protected emit (event: GsnEvent): void {
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
    const txHash = '0x' + transaction.hash().toString('hex')
    this.logger.info(`Broadcasting raw transaction signed by relay. TxHash: ${txHash}`)
    try {
      if (await this._isAlreadySubmitted(txHash)) {
        return { hasReceipt: true }
      }

      // can't find the TX in the mempool. broadcast it ourselves.
      await this.dependencies.contractInteractor.sendSignedTransaction(rawTx)
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
      return {
        hasReceipt: false,
        broadcastError
      }
    }
  }

  async _isAlreadySubmitted (txHash: string): Promise<boolean> {
    const [txMinedReceipt, pendingBlock] = await Promise.all([
      this.dependencies.contractInteractor.web3.eth.getTransactionReceipt(txHash),
      // mempool transactions
      this.dependencies.contractInteractor.web3.eth.getBlock('pending')
    ])

    if (txMinedReceipt != null) {
      return true
    }

    return pendingBlock.transactions.includes(txHash)
  }

  async relayTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    if (!this.initialized) {
      if (this.initializingPromise == null) {
        this._warn('suggestion: call RelayProvider.init()/RelayClient.init() in advance (to make first request faster)')
      }
      await this.init()
    }
    // TODO: should have a better strategy to decide how often to refresh known relays
    this.emit(new GsnRefreshRelaysEvent())
    await this.dependencies.knownRelaysManager.refresh()
    gsnTransactionDetails.gasPrice = '0x0'
    gsnTransactionDetails.gasPriceForLookup = await this._getRelayRequestGasPriceValueForServerLookup(gsnTransactionDetails)
    gsnTransactionDetails.value = gsnTransactionDetails.value ?? '0x0'
    if (gsnTransactionDetails.gas == null) {
      const estimated = await this.dependencies.contractInteractor.estimateGasWithoutCalldata(
        Object.assign({}, gsnTransactionDetails, { gasPrice: gsnTransactionDetails.gasPriceForLookup }))
      gsnTransactionDetails.gas = `0x${estimated.toString(16)}`
    }
    const relaySelectionManager = await new RelaySelectionManager(gsnTransactionDetails, this.dependencies.knownRelaysManager, this.dependencies.httpClient, this.dependencies.pingFilter, this.logger, this.config).init()
    const count = relaySelectionManager.relaysLeft().length
    this.emit(new GsnDoneRefreshRelaysEvent(count))
    if (count === 0) {
      throw new Error('no registered relayers')
    }
    const relayingErrors = new Map<string, Error>()
    this.auditPromises = []

    const paymaster = this.dependencies.contractInteractor.getDeployment().paymasterAddress

    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay(paymaster)
      if (activeRelay != null) {
        this.emit(new GsnNextRelayEvent(activeRelay.relayInfo.relayUrl))
        relayingAttempt = await this._attemptRelay(activeRelay, gsnTransactionDetails)
          .catch(error => ({ error }))
        if (relayingAttempt.error != null) {
          relayingErrors.set(activeRelay.relayInfo.relayUrl, relayingAttempt.error)
          continue
        }
      }
      return {
        relayRequestID: relayingAttempt?.relayRequestID,
        transaction: relayingAttempt?.transaction,
        relayingErrors,
        auditPromises: this.auditPromises,
        pingErrors: relaySelectionManager.errors
      }
    }
  }

  _warn (msg: string): void {
    this.logger.warn(msg)
  }

  async _calculateGasPrice (): Promise<PrefixedHexString> {
    const pct = this.config.gasPriceFactorPercent
    const networkGasPrice = await this.dependencies.contractInteractor.getGasPrice()
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
    this.logger.info(`attempting relay: ${JSON.stringify(relayInfo)} transaction: ${JSON.stringify(gsnTransactionDetails)}`)
    const httpRequest = await this._prepareRelayHttpRequest(relayInfo, gsnTransactionDetails)

    this.emit(new GsnValidateRequestEvent())
    const { error: validationError } = await this._validateRequestBeforeSending(httpRequest)
    if (validationError != null) { return { error: validationError } }
    const {
      hexTransaction,
      transaction,
      error: requestError
    } = await this._sendRelayRequestToServer(httpRequest, relayInfo)
    if (requestError != null) { return { error: requestError } }
    const { error: callbackError } = await this._onTransactionSentToServer(relayInfo, httpRequest, transaction, hexTransaction)
    if (callbackError != null) { return { error: callbackError } }
    this.emit(new GsnRelayerResponseEvent(true))
    return {
      relayRequestID: getRelayRequestID(httpRequest.relayRequest, httpRequest.metadata.signature),
      transaction
    }
  }

  async _validateRequestBeforeSending (httpRequest: RelayTransactionRequest): Promise<{ error?: Error }> {
    const localViewCallParameters = await this._getLocalViewCallParameters(httpRequest)

    const acceptRelayCallResult =
      await this.dependencies.contractInteractor.validateRelayCall(localViewCallParameters)
    if (!acceptRelayCallResult.paymasterAccepted) {
      let message: string
      if (acceptRelayCallResult.reverted) {
        message = 'local view call to \'relayCall()\' reverted'
      } else {
        message = 'paymaster rejected in local view call to \'relayCall()\' '
      }
      return { error: new Error(`${message}: ${decodeRevertReason(acceptRelayCallResult.returnValue)}`) }
    }
    return {}
  }

  async _getLocalViewCallParameters (httpRequest: RelayTransactionRequest): Promise<TransactionConfig> {
    const viewCallGasLimit =
      await this.dependencies.contractInteractor.getMaxViewableGasLimit(httpRequest.relayRequest, this.config.maxViewableGasLimit)
    const encodedRelayCall = this.dependencies.contractInteractor.encodeABI(asRelayCallAbi(httpRequest))

    return {
      from: httpRequest.relayRequest.relayData.relayWorker,
      to: this._getResolvedDeployment().relayHubAddress,
      gasPrice: toHex(httpRequest.relayRequest.relayData.gasPrice),
      gas: toHex(viewCallGasLimit),
      data: encodedRelayCall
    }
  }

  async _onTransactionSentToServer (
    relayInfo: RelayInfo,
    httpRequest: RelayTransactionRequest,
    transaction?: Transaction,
    hexTransaction?: PrefixedHexString
  ): Promise<{ error?: Error }> {
    if (transaction == null || hexTransaction == null) {
      this.logger.warn('_onTransactionSentToServer called empty - transaction likely was not relayed')
      return {}
    }
    // 1. Broadcast the raw transaction we have received from the server
    // TODO: push this promise into 'auditPromises' array
    await this._broadcastRawTx(transaction)

    // 2. Initiate sending audit requests to alternative servers
    const auditPromise = this.auditTransaction(hexTransaction, relayInfo.relayInfo.relayUrl)
      .then((penalizeResponse) => {
        if (penalizeResponse.commitTxHash != null) {
          const txHash = bufferToHex(transaction.hash())
          this.logger.error(`The transaction with id: ${txHash} was penalized! Penalization commitment tx id: ${penalizeResponse.commitTxHash}`)
        }
        return penalizeResponse
      })
    this.auditPromises.push(auditPromise)

    // 3. Validate response from server is valid
    if (!this.dependencies.transactionValidator.validateRelayResponse(httpRequest, hexTransaction)) {
      this.emit(new GsnRelayerResponseEvent(false))
      this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return {
        error: new Error('Returned transaction did not pass validation')
      }
    }
    return {}
  }

  async _sendRelayRequestToServer (httpRequest: RelayTransactionRequest, relayInfo: RelayInfo): Promise<RelayingAttempt> {
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      const hexTransaction = await this.dependencies.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, httpRequest)
      const transaction = Transaction.fromSerializedTx(toBuffer(hexTransaction), this.dependencies.contractInteractor.getRawTxOptions())
      return {
        hexTransaction,
        transaction
      }
    } catch (error) {
      return this._onRelayTransactionError(error, relayInfo, httpRequest)
    }
  }

  _onRelayTransactionError (error: Error, relayInfo: RelayInfo, httpRequest: RelayTransactionRequest): { error: Error } {
    if (error?.message == null || error.message.includes('timeout')) {
      this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
    }
    this.logger.info(`relayTransaction: ${JSON.stringify(httpRequest)}`)
    return { error }
  }

  async _prepareRelayHttpRequest (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayTransactionRequest> {
    // TODO: narrow down the GsnTransactionDetails interface and resolve it by this point so we can actually use exactShape here
    ow(gsnTransactionDetails, ow.object.partialShape(GsnTransactionDetailsShape))
    const deployment = this._getResolvedDeployment()

    const request = await this._prepareForwarderRequest(gsnTransactionDetails, relayInfo)
    const relayData = await this._prepareRelayData(gsnTransactionDetails, relayInfo, deployment)
    const relayRequest: RelayRequest = {
      request,
      relayData
    }

    const metadata = await this.prepareRelayRequestMetadata(relayRequest, relayInfo, deployment)
    const httpRequest: RelayTransactionRequest = {
      relayRequest,
      metadata
    }
    this._verifyRelayTransactionRequestCorrectness(httpRequest)
    this.logger.info(`Created HTTP relay request: ${JSON.stringify(httpRequest)}`)

    return httpRequest
  }

  async _getRelayRequestValidUntilValue (_relayInfo: RelayInfo): Promise<IntString> {
    // valid that many blocks into the future.
    const blockNumber = await this.dependencies.contractInteractor.getBlockNumberRightNow()
    return new BN(this.config.requestValidBlocks).addn(blockNumber).toString()
  }

  async _getRelayRequestGasPriceValueForServerLookup (gsnTransactionDetails: GsnTransactionDetails): Promise<PrefixedHexString> {
    return gsnTransactionDetails.forceGasPrice ?? await this._calculateGasPrice()
  }

  async _getRelayRequestGasPriceValue (gsnTransactionDetails: GsnTransactionDetails, _relayInfo: RelayInfo): Promise<PrefixedHexString> {
    if (gsnTransactionDetails.gasPriceForLookup == null) {
      throw new Error('BaseRelayClient uses the same gas price for lookup and relaying. Cannot happen.')
    }
    return gsnTransactionDetails.gasPriceForLookup
  }

  async _getRelayRequestGasLimitValue (gsnTransactionDetails: GsnTransactionDetails): Promise<PrefixedHexString> {
    // ?? for regular flow gas price can be omitted from tx params and filled in from RPC to sort relays, or passed in (web3.js fills it in before tx reaches provider)
    //  on batched flow it must be omitted and must be set from the HTTP response
    return parseInt(gsnTransactionDetails.gas ?? '', 16).toString()
  }

  async _prepareForwarderRequest (gsnTransactionDetails: GsnTransactionDetails, relayInfo: RelayInfo): Promise<ForwardRequest> {
    const gas = await this._getRelayRequestGasLimitValue(gsnTransactionDetails)
    const validUntil = await this._getRelayRequestValidUntilValue(relayInfo)
    const nonce = await this.dependencies.contractInteractor.getSenderNonce(gsnTransactionDetails.from)
    const value = gsnTransactionDetails.value ?? '0x0'
    return {
      to: gsnTransactionDetails.to,
      data: gsnTransactionDetails.data,
      from: gsnTransactionDetails.from,
      value,
      nonce,
      gas,
      validUntil
    }
  }

  async _prepareRelayData (gsnTransactionDetails: GsnTransactionDetails, relayInfo: RelayInfo, deployment: GSNContractsDeploymentResolvedForRequest): Promise<RelayData> {
    const gasPrice = await this._getRelayRequestGasPriceValue(gsnTransactionDetails, relayInfo)
    const relayWorker = relayInfo.pingResponse.relayWorkerAddress
    return {
      gasPrice,
      relayWorker,
      clientId: this.config.clientId,
      pctRelayFee: relayInfo.relayInfo.pctRelayFee,
      baseRelayFee: relayInfo.relayInfo.baseRelayFee,
      paymaster: deployment.paymasterAddress,
      forwarder: deployment.forwarderAddress,
      transactionCalldataGasUsed: '', // temp value. filled in by estimateCalldataCostAbi, below.
      paymasterData: '' // temp value. filled in by asyncPaymasterData, below.
    }
  }

  // modifies the input object itself
  async _fillInComputedFields (relayRequest: RelayRequest): Promise<void> {
    relayRequest.relayData.transactionCalldataGasUsed =
      this.dependencies.contractInteractor.estimateCalldataCostForRequest(relayRequest, this.config)

    // put paymasterData into struct before signing
    relayRequest.relayData.paymasterData = await this.dependencies.asyncPaymasterData(relayRequest)
  }

  _getResolvedDeployment (): GSNContractsDeploymentResolvedForRequest {
    const {
      relayHubAddress,
      paymasterAddress,
      forwarderAddress
    } = this.dependencies.contractInteractor.getDeployment()
    if (
      relayHubAddress == null ||
      paymasterAddress == null ||
      forwarderAddress == null) {
      throw new Error('Contract addresses are not initialized!')
    }
    return {
      relayHubAddress,
      paymasterAddress,
      forwarderAddress
    }
  }

  _verifyRelayTransactionRequestCorrectness (relayTransactionRequest: RelayTransactionRequest): void {
    if (toBuffer(relayTransactionRequest.relayRequest.relayData.paymasterData).length >
      this.config.maxPaymasterDataLength) {
      throw new Error('actual paymasterData larger than maxPaymasterDataLength')
    }
    if (toBuffer(relayTransactionRequest.metadata.approvalData).length >
      this.config.maxApprovalDataLength) {
      throw new Error('actual approvalData larger than maxApprovalDataLength')
    }

    ow(relayTransactionRequest, ow.object.exactShape(RelayTransactionRequestShape))
  }

  async prepareRelayRequestMetadata (relayRequest: RelayRequest, relayInfo: RelayInfo, deployment: GSNContractsDeploymentResolvedForRequest): Promise<RelayMetadata> {
    this.emit(new GsnSignRequestEvent())
    await this._fillInComputedFields(relayRequest)
    const signature = await this.dependencies.accountManager.signEIP712ECDSA(relayRequest)
    const approvalData = await this.dependencies.asyncApprovalData(relayRequest)
    const transactionCount =
      await this.dependencies.contractInteractor.getTransactionCount(relayRequest.relayData.relayWorker)
    const relayMaxNonce = transactionCount + this.config.maxRelayNonceGap
    return {
      maxAcceptanceBudget: relayInfo.pingResponse.maxAcceptanceBudget,
      relayHubAddress: deployment.relayHubAddress,
      signature,
      approvalData,
      relayMaxNonce
    }
  }

  newAccount (): AccountKeypair {
    this._verifyInitialized()
    return this.dependencies.accountManager.newAccount()
  }

  addAccount (privateKey: PrefixedHexString): void {
    this._verifyInitialized()
    this.dependencies.accountManager.addAccount(privateKey)
  }

  _verifyInitialized (): void {
    if (!this.initialized) {
      throw new Error('not initialized. must call RelayClient.init()')
    }
  }

  async auditTransaction (hexTransaction: PrefixedHexString, sourceRelayUrl: string): Promise<AuditResponse> {
    const auditors = this.dependencies.knownRelaysManager.getAuditors([sourceRelayUrl])
    let failedAuditorsCount = 0
    for (const auditor of auditors) {
      try {
        const penalizeResponse = await this.dependencies.httpClient.auditTransaction(auditor, hexTransaction)
        if (penalizeResponse.commitTxHash != null) {
          return penalizeResponse
        }
      } catch (e) {
        failedAuditorsCount++
        this.logger.info(`Audit call failed for relay at URL: ${auditor}. Failed audit calls: ${failedAuditorsCount}/${auditors.length}`)
      }
    }
    if (auditors.length === failedAuditorsCount && failedAuditorsCount !== 0) {
      this.logger.error('All auditors failed!')
    }
    return {
      message: `Transaction was not audited. Failed audit calls: ${failedAuditorsCount}/${auditors.length}`
    }
  }

  getUnderlyingProvider (): Web3ProviderBaseInterface {
    return this.rawConstructorInput.provider
  }

  async _resolveConfiguration ({
    provider,
    config = {}
  }: GSNUnresolvedConstructorInput): Promise<GSNConfig> {
    return {
      ...defaultGsnConfig,
      ...config
    }
  }

  async _resolveDependencies ({
    provider,
    config = {},
    overrideDependencies = {}
  }: GSNUnresolvedConstructorInput): Promise<GSNDependencies> {
    const versionManager = new VersionsManager(gsnRuntimeVersion, config.requiredVersionRange ?? gsnRequiredVersion)
    const contractInteractor = overrideDependencies?.contractInteractor ??
      await new ContractInteractor({
        provider,
        versionManager,
        logger: this.logger,
        maxPageSize: this.config.pastEventsQueryMaxPageSize,
        environment: this.config.environment,
        deployment: { paymasterAddress: config?.paymasterAddress }
      }).init()
    const accountManager = overrideDependencies?.accountManager ?? new AccountManager(provider, contractInteractor.chainId, this.config)

    const httpClient = overrideDependencies?.httpClient ?? new HttpClient(new HttpWrapper(), this.logger)
    const pingFilter = overrideDependencies?.pingFilter ?? GasPricePingFilter
    const relayFilter = overrideDependencies?.relayFilter ?? EmptyFilter
    const asyncApprovalData = overrideDependencies?.asyncApprovalData ?? EmptyDataCallback
    const asyncPaymasterData = overrideDependencies?.asyncPaymasterData ?? EmptyDataCallback
    const scoreCalculator = overrideDependencies?.scoreCalculator ?? DefaultRelayScore
    const knownRelaysManager = overrideDependencies?.knownRelaysManager ?? new KnownRelaysManager(contractInteractor, this.logger, this.config, relayFilter)
    const transactionValidator = overrideDependencies?.transactionValidator ?? new RelayedTransactionValidator(contractInteractor, this.logger, this.config)

    return {
      logger: this.logger,
      httpClient,
      contractInteractor,
      knownRelaysManager,
      accountManager,
      transactionValidator,
      pingFilter,
      relayFilter,
      asyncApprovalData,
      asyncPaymasterData,
      scoreCalculator
    }
  }
}

export function _dumpRelayingResult (relayingResult: RelayingResult): string {
  let str = ''
  if (relayingResult.pingErrors.size > 0) {
    str += `Ping errors (${relayingResult.pingErrors.size}):`
    Array.from(relayingResult.pingErrors.keys()).forEach(e => {
      const err = relayingResult.pingErrors.get(e)
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const error = err?.message ?? err?.toString() ?? ''
      str += `\n${e} => ${error} stack:${err?.stack}\n`
    })
  }
  if (relayingResult.relayingErrors.size > 0) {
    str += `Relaying errors (${relayingResult.relayingErrors.size}):\n`
    Array.from(relayingResult.relayingErrors.keys()).forEach(e => {
      const err = relayingResult.relayingErrors.get(e)
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const error = err?.message ?? err?.toString() ?? ''
      str += `${e} => ${error} stack:${err?.stack}`
    })
  }
  return str
}
