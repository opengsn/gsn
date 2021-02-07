import { EventEmitter } from 'events'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'

import ContractInteractor from '../common/ContractInteractor'
import GsnTransactionDetails from '../common/types/GsnTransactionDetails'
import RelayRequest from '../common/EIP712/RelayRequest'
import VersionsManager from '../common/VersionsManager'
import { AsyncDataCallback, PingFilter, Web3ProviderBaseInterface } from '../common/types/Aliases'
import { AuditResponse } from '../common/types/AuditRequest'
import { LoggerInterface } from '../common/LoggerInterface'
import { RelayInfo } from '../common/types/RelayInfo'
import { RelayMetadata, RelayTransactionRequest } from '../common/types/RelayTransactionRequest'
import { decodeRevertReason } from '../common/Utils'
import { gsnRequiredVersion, gsnRuntimeVersion } from '../common/Version'

import AccountManager, { AccountKeypair } from './AccountManager'
import HttpClient from './HttpClient'
import HttpWrapper from './HttpWrapper'
import RelaySelectionManager from './RelaySelectionManager'
import RelayedTransactionValidator from './RelayedTransactionValidator'
import { DefaultRelayScore, EmptyFilter, KnownRelaysManager } from './KnownRelaysManager'
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

// forwarder requests are signed with expiration time.
const REQUEST_VALID_BLOCKS = 6000 // roughly a day

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

export interface GSNUnresolvedConstructorInput {
  provider: Web3ProviderBaseInterface
  config: Partial<GSNConfig>
  overrideDependencies?: Partial<GSNDependencies>
}

interface RelayingAttempt {
  transaction?: Transaction
  error?: Error
  auditPromise?: Promise<AuditResponse>
}

export interface RelayingResult {
  transaction?: Transaction
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
  async _broadcastRawTx (transaction: Transaction): Promise<{ hasReceipt: boolean, broadcastError?: Error, wrongNonce?: boolean }> {
    const rawTx = '0x' + transaction.serialize().toString('hex')
    const txHash = '0x' + transaction.hash(true).toString('hex')
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
    gsnTransactionDetails.gasPrice = gsnTransactionDetails.forceGasPrice ?? await this._calculateGasPrice()
    if (gsnTransactionDetails.gas == null) {
      const estimated = await this.dependencies.contractInteractor.estimateGas(gsnTransactionDetails)
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
    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay()
      if (activeRelay != null) {
        this.emit(new GsnNextRelayEvent(activeRelay.relayInfo.relayUrl))
        relayingAttempt = await this._attemptRelay(activeRelay, gsnTransactionDetails)
          .catch(error => ({ error }))
        if (relayingAttempt.auditPromise != null) {
          auditPromises.push(relayingAttempt.auditPromise)
        }
        if (relayingAttempt.transaction == null) {
          relayingErrors.set(activeRelay.relayInfo.relayUrl, relayingAttempt.error ?? new Error('No error reason was given'))
          continue
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
    const maxAcceptanceBudget = parseInt(relayInfo.pingResponse.maxAcceptanceBudget)
    const httpRequest = await this._prepareRelayHttpRequest(relayInfo, gsnTransactionDetails)

    this.emit(new GsnValidateRequestEvent())

    const acceptRelayCallResult = await this.dependencies.contractInteractor.validateRelayCall(maxAcceptanceBudget, httpRequest.relayRequest, httpRequest.metadata.signature, httpRequest.metadata.approvalData)
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
    let transaction: Transaction
    let auditPromise: Promise<AuditResponse>
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      hexTransaction = await this.dependencies.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, httpRequest)
      transaction = new Transaction(hexTransaction, this.dependencies.contractInteractor.getRawTxOptions())
      auditPromise = this.auditTransaction(hexTransaction, relayInfo.relayInfo.relayUrl)
        .then((penalizeResponse) => {
          if (penalizeResponse.penalizeTxHash != null) {
            const txHash = bufferToHex(transaction.hash(true))
            this.logger.error(`The transaction with id: ${txHash} was penalized! Penalization tx id: ${penalizeResponse.penalizeTxHash}`)
          }
          return penalizeResponse
        })
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      this.logger.info(`relayTransaction: ${JSON.stringify(httpRequest)}`)
      return { error }
    }
    if (!this.dependencies.transactionValidator.validateRelayResponse(httpRequest, maxAcceptanceBudget, hexTransaction)) {
      this.emit(new GsnRelayerResponseEvent(false))
      this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return {
        auditPromise,
        error: new Error('Returned transaction did not pass validation')
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
    const forwarder = gsnTransactionDetails.forwarder ?? this.dependencies.contractInteractor.getDeployment().forwarderAddress
    const paymaster = gsnTransactionDetails.paymaster ?? this.dependencies.contractInteractor.getDeployment().paymasterAddress
    if (relayHubAddress == null || paymaster == null || forwarder == null) {
      throw new Error('Contract addresses are not initialized!')
    }

    // validTime is relative to current block time (don't rely on local clock, but also for test support)
    const validUntilPromise = this.dependencies.contractInteractor.getBlockNumber()
      .then((num: number) => (num + REQUEST_VALID_BLOCKS).toString())

    const senderNonce = await this.dependencies.contractInteractor.getSenderNonce(gsnTransactionDetails.from, forwarder)
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
        gas: gasLimit,
        validUntil: await validUntilPromise
      },
      relayData: {
        pctRelayFee: relayInfo.relayInfo.pctRelayFee,
        baseRelayFee: relayInfo.relayInfo.baseRelayFee,
        gasPrice,
        paymaster,
        paymasterData: '', // temp value. filled in by asyncPaymasterData, below.
        clientId: this.config.clientId,
        forwarder,
        relayWorker
      }
    }

    // put paymasterData into struct before signing
    relayRequest.relayData.paymasterData = await this.dependencies.asyncPaymasterData(relayRequest)
    this.emit(new GsnSignRequestEvent())
    const signature = await this.dependencies.accountManager.sign(relayRequest)
    const approvalData = await this.dependencies.asyncApprovalData(relayRequest)
    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const transactionCount = await this.dependencies.contractInteractor.getTransactionCount(relayWorker)
    const relayMaxNonce = transactionCount + this.config.maxRelayNonceGap
    // TODO: the server accepts a flat object, and that is why this code looks like shit.
    //  Must teach server to accept correct types
    const metadata: RelayMetadata = {
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
        if (penalizeResponse.penalizeTxHash != null) {
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
    const isMetamask: boolean = (provider as any).isMetaMask

    // provide defaults valid for metamask (unless explicitly specified values)
    const methodSuffix = config.methodSuffix ?? (isMetamask ? '_v4' : defaultGsnConfig.methodSuffix)
    const jsonStringifyRequest = config.jsonStringifyRequest ?? (isMetamask ? true : defaultGsnConfig.jsonStringifyRequest)

    const resolvedConfig: Partial<GSNConfig> = {
      methodSuffix,
      jsonStringifyRequest
    }
    return {
      ...defaultGsnConfig,
      ...resolvedConfig,
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
      const error = err?.message ?? err?.toString() ?? ''
      str += `\n${e} => ${error}\n`
    })
  }
  if (relayingResult.relayingErrors.size > 0) {
    str += `Relaying errors (${relayingResult.relayingErrors.size}):\n`
    Array.from(relayingResult.relayingErrors.keys()).forEach(e => {
      const err = relayingResult.relayingErrors.get(e)
      const error = err?.message ?? err?.toString() ?? ''
      str += `${e} => ${error}`
    })
  }
  return str
}
