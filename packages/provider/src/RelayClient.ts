import { EventEmitter } from 'events'
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'

import { ContractInteractor, asRelayCallAbi } from '@opengsn/common/dist/ContractInteractor'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { VersionsManager } from '@opengsn/common/dist/VersionsManager'
import { AsyncDataCallback, PingFilter, Web3ProviderBaseInterface } from '@opengsn/common/dist/types/Aliases'
import { AuditResponse } from '@opengsn/common/dist/types/AuditRequest'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { RelayMetadata, RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { decodeRevertReason, removeNullValues } from '@opengsn/common/dist/Utils'
import { gsnRequiredVersion, gsnRuntimeVersion } from '@opengsn/common/dist/Version'

import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { HttpWrapper } from '@opengsn/common/dist/HttpWrapper'
import { AccountKeypair, AccountManager } from './AccountManager'
import { DefaultRelayScore, DefaultRelayFilter, KnownRelaysManager } from './KnownRelaysManager'
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
    gsnTransactionDetails.maxPriorityFeePerGas != null &&
    parseInt(pingResponse.minMaxPriorityFeePerGas) > parseInt(gsnTransactionDetails.maxPriorityFeePerGas)
  ) {
    throw new Error(`Proposed priority gas fee: ${gsnTransactionDetails.maxPriorityFeePerGas}; relay's minMaxPriorityFeePerGas: ${pingResponse.minMaxPriorityFeePerGas}`)
  }
}

export interface GSNUnresolvedConstructorInput {
  provider: Web3ProviderBaseInterface
  config: Partial<GSNConfig>
  overrideDependencies?: Partial<GSNDependencies>
}

interface RelayingAttempt {
  transaction?: TypedTransaction
  isRelayError?: boolean
  error?: Error
  auditPromise?: Promise<AuditResponse>
}

export interface RelayingResult {
  transaction?: TypedTransaction
  pingErrors: Map<string, Error>
  relayingErrors: Map<string, Error>
  auditPromises?: Array<Promise<AuditResponse>>
}

export class RelayClient {
  readonly emitter = new EventEmitter()
  config!: GSNConfig
  dependencies!: GSNDependencies
  private readonly rawConstructorInput: GSNUnresolvedConstructorInput

  private initialized = false
  logger!: LoggerInterface
  initializingPromise?: Promise<void>

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
  async _broadcastRawTx (transaction: TypedTransaction): Promise<{ hasReceipt: boolean, broadcastError?: Error, wrongNonce?: boolean }> {
    const rawTx = '0x' + transaction.serialize().toString('hex')
    const txHash = '0x' + transaction.hash().toString('hex')
    try {
      if (await this._isAlreadySubmitted(txHash)) {
        this.logger.debug('Not broadcasting raw transaction as our RPC endpoint already sees it')
        return { hasReceipt: true }
      }

      this.logger.info(`Broadcasting raw transaction signed by relay. TxHash: ${txHash}\nNote: this may cause a "transaction already known" error to appear in the logs. It is not a problem, please ignore that error.`)
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
      return { hasReceipt: false, broadcastError }
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

  async relayTransaction (_gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    if (!this.initialized) {
      if (this.initializingPromise == null) {
        this._warn('suggestion: call RelayProvider.init()/RelayClient.init() in advance (to make first request faster)')
      }
      await this.init()
    }
    const gsnTransactionDetails = { ..._gsnTransactionDetails }
    // TODO: should have a better strategy to decide how often to refresh known relays
    this.emit(new GsnRefreshRelaysEvent())
    await this.dependencies.knownRelaysManager.refresh()
    gsnTransactionDetails.maxFeePerGas = toHex(gsnTransactionDetails.maxFeePerGas)
    gsnTransactionDetails.maxPriorityFeePerGas = toHex(gsnTransactionDetails.maxPriorityFeePerGas)
    if (gsnTransactionDetails.gas == null) {
      const estimated = await this.dependencies.contractInteractor.estimateGasWithoutCalldata(gsnTransactionDetails)
      gsnTransactionDetails.gas = `0x${estimated.toString(16)}`
    }
    const relaySelectionManager = await new RelaySelectionManager(gsnTransactionDetails, this.dependencies.knownRelaysManager, this.dependencies.httpClient, this.dependencies.pingFilter, this.logger, this.config).init()
    const count = relaySelectionManager.relaysLeft().length
    this.emit(new GsnDoneRefreshRelaysEvent(count))
    if (count === 0) {
      throw new Error('no registered relayers')
    }
    const relayingErrors = new Map<string, Error>()
    const auditPromises: Array<Promise<AuditResponse>> = []
    const paymaster = this.dependencies.contractInteractor.getDeployment().paymasterAddress

    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay(paymaster)
      if (activeRelay != null) {
        this.emit(new GsnNextRelayEvent(activeRelay.relayInfo.relayUrl))
        relayingAttempt = await this._attemptRelay(activeRelay, gsnTransactionDetails)
          .catch(error => ({ error }))
        if (relayingAttempt.auditPromise != null) {
          auditPromises.push(relayingAttempt.auditPromise)
        }
        if (relayingAttempt.transaction == null) {
          relayingErrors.set(activeRelay.relayInfo.relayUrl, relayingAttempt.error ?? new Error('No error reason was given'))
          if (relayingAttempt.isRelayError ?? false) {
            // continue with next relayer
            continue
          }
        }
      }
      return {
        transaction: relayingAttempt?.transaction,
        relayingErrors,
        auditPromises,
        pingErrors: relaySelectionManager.errors
      }
    }
  }

  _warn (msg: string): void {
    this.logger.warn(msg)
  }

  async calculateGasFees (): Promise<{ maxFeePerGas: PrefixedHexString, maxPriorityFeePerGas: PrefixedHexString }> {
    const pct = this.config.gasPriceFactorPercent
    const gasFees = await this.dependencies.contractInteractor.getGasFees()
    let priorityFee = Math.round(parseInt(gasFees.priorityFeePerGas) * (pct + 100) / 100)
    if (this.config.minMaxPriorityFeePerGas != null && priorityFee < this.config.minMaxPriorityFeePerGas) {
      priorityFee = this.config.minMaxPriorityFeePerGas
    }
    const maxPriorityFeePerGas = `0x${priorityFee.toString(16)}`
    let maxFeePerGas = `0x${Math.round((parseInt(gasFees.baseFeePerGas) + priorityFee) * (pct + 100) / 100).toString(16)}`
    if (parseInt(maxFeePerGas) === 0) {
      maxFeePerGas = maxPriorityFeePerGas
    }
    return { maxFeePerGas, maxPriorityFeePerGas }
  }

  async _attemptRelay (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayingAttempt> {
    this.logger.info(`attempting relay: ${JSON.stringify(relayInfo)} transaction: ${JSON.stringify(gsnTransactionDetails)}`)
    const httpRequest = await this._prepareRelayHttpRequest(relayInfo, gsnTransactionDetails)
    this.emit(new GsnValidateRequestEvent())

    const viewCallGasLimit =
      await this.dependencies.contractInteractor.getMaxViewableGasLimit(httpRequest.relayRequest, this.config.maxViewableGasLimit)

    const acceptRelayCallResult =
      await this.dependencies.contractInteractor.validateRelayCall(
        asRelayCallAbi(httpRequest),
        viewCallGasLimit)
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
    let transaction: TypedTransaction
    let auditPromise: Promise<AuditResponse>
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      hexTransaction = await this.dependencies.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, httpRequest)
      transaction = TransactionFactory.fromSerializedData(toBuffer(hexTransaction), this.dependencies.contractInteractor.getRawTxOptions())
      auditPromise = this.auditTransaction(hexTransaction, relayInfo.relayInfo.relayUrl)
        .then((penalizeResponse) => {
          if (penalizeResponse.commitTxHash != null) {
            const txHash = bufferToHex(transaction.hash())
            this.logger.error(`The transaction with id: ${txHash} was penalized! Penalization commitment tx id: ${penalizeResponse.commitTxHash}`)
          }
          return penalizeResponse
        })
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      this.logger.info(`relayTransaction: ${JSON.stringify(httpRequest)}`)
      return { error, isRelayError: true }
    }
    let validationError: Error|undefined
    try {
      if (!this.dependencies.transactionValidator.validateRelayResponse(httpRequest, hexTransaction)) {
        validationError = new Error('Returned transaction did not pass validation')
      }
    } catch (e) {
      validationError = e
    }
    if (validationError != null) {
      this.emit(new GsnRelayerResponseEvent(false))
      this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return {
        auditPromise,
        isRelayError: true,
        error: validationError
      }
    }
    this.emit(new GsnRelayerResponseEvent(true))
    await this._broadcastRawTx(transaction)
    return {
      auditPromise,
      transaction
    }
  }

  async _prepareRelayHttpRequest (
    relayInfo: RelayInfo,
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayTransactionRequest> {
    const relayHubAddress = this.dependencies.contractInteractor.getDeployment().relayHubAddress
    const forwarder = this.dependencies.contractInteractor.getDeployment().forwarderAddress
    const paymaster = this.dependencies.contractInteractor.getDeployment().paymasterAddress
    if (relayHubAddress == null || paymaster == null || forwarder == null) {
      throw new Error('Contract addresses are not initialized!')
    }

    const senderNonce = await this.dependencies.contractInteractor.getSenderNonce(gsnTransactionDetails.from, forwarder)
    const relayWorker = relayInfo.pingResponse.relayWorkerAddress
    const maxFeePerGasHex = gsnTransactionDetails.maxFeePerGas
    const maxPriorityFeePerGasHex = gsnTransactionDetails.maxPriorityFeePerGas
    const gasLimitHex = gsnTransactionDetails.gas
    if (maxFeePerGasHex == null || maxPriorityFeePerGasHex == null || gasLimitHex == null) {
      throw new Error('RelayClient internal exception.  gas fees or gas limit still not calculated. Cannot happen.')
    }
    if (maxFeePerGasHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid maxFeePerGas hex string: ${maxFeePerGasHex}`)
    }
    if (maxPriorityFeePerGasHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid maxPriorityFeePerGas hex string: ${maxPriorityFeePerGasHex}`)
    }
    if (gasLimitHex.indexOf('0x') !== 0) {
      throw new Error(`Invalid gasLimit hex string: ${gasLimitHex}`)
    }
    const gasLimit = parseInt(gasLimitHex, 16).toString()
    const maxFeePerGas = parseInt(maxFeePerGasHex, 16).toString()
    const maxPriorityFeePerGas = parseInt(maxPriorityFeePerGasHex, 16).toString()
    const value = gsnTransactionDetails.value ?? '0'
    const secondsNow = Math.round(Date.now() / 1000)
    const validUntilTime = (secondsNow + this.config.requestValidSeconds).toString()
    const relayRequest: RelayRequest = {
      request: {
        to: gsnTransactionDetails.to,
        data: gsnTransactionDetails.data,
        from: gsnTransactionDetails.from,
        value: value,
        nonce: senderNonce,
        gas: gasLimit,
        validUntilTime
      },
      relayData: {
        pctRelayFee: relayInfo.relayInfo.pctRelayFee,
        baseRelayFee: relayInfo.relayInfo.baseRelayFee,
        maxFeePerGas,
        maxPriorityFeePerGas,
        paymaster,
        transactionCalldataGasUsed: '', // temp value. filled in by estimateCalldataCostAbi, below.
        paymasterData: '', // temp value. filled in by asyncPaymasterData, below.
        clientId: this.config.clientId,
        forwarder,
        relayWorker
      }
    }

    relayRequest.relayData.transactionCalldataGasUsed =
      this.dependencies.contractInteractor.estimateCalldataCostForRequest(relayRequest, this.config)

    // put paymasterData into struct before signing
    relayRequest.relayData.paymasterData = await this.dependencies.asyncPaymasterData(relayRequest)
    this.emit(new GsnSignRequestEvent())
    const signature = await this.dependencies.accountManager.sign(relayRequest)
    const approvalData = await this.dependencies.asyncApprovalData(relayRequest)

    if (toBuffer(relayRequest.relayData.paymasterData).length >
      this.config.maxPaymasterDataLength) {
      throw new Error('actual paymasterData larger than maxPaymasterDataLength')
    }
    if (toBuffer(approvalData).length >
      this.config.maxApprovalDataLength) {
      throw new Error('actual approvalData larger than maxApprovalDataLength')
    }

    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const transactionCount = await this.dependencies.contractInteractor.getTransactionCount(relayWorker)
    const relayMaxNonce = transactionCount + this.config.maxRelayNonceGap
    // TODO: the server accepts a flat object, and that is why this code looks like shit.
    //  Must teach server to accept correct types
    const metadata: RelayMetadata = {
      maxAcceptanceBudget: relayInfo.pingResponse.maxAcceptanceBudget,
      relayHubAddress,
      signature,
      approvalData,
      relayMaxNonce
    }
    const httpRequest: RelayTransactionRequest = {
      relayRequest,
      metadata
    }
    this.logger.info(`Created HTTP relay request: ${JSON.stringify(httpRequest)}`)

    return httpRequest
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
      ...removeNullValues(config)
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
    const relayFilter = overrideDependencies?.relayFilter ?? DefaultRelayFilter
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
