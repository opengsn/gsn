import Web3 from 'web3'
import { EventEmitter } from 'events'
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'
import { toBN, toHex } from 'web3-utils'

import {
  AsyncDataCallback,
  AuditResponse,
  ContractInteractor,
  GsnTransactionDetails,
  HttpClient,
  HttpWrapper,
  LoggerInterface,
  ObjectMap,
  PingFilter,
  RelayCallABI,
  RelayInfo,
  RelayMetadata,
  RelayRequest,
  RelayTransactionRequest,
  VersionsManager,
  Web3ProviderBaseInterface,
  asRelayCallAbi,
  constants,
  decodeRevertReason,
  getRelayRequestID,
  gsnRequiredVersion,
  gsnRuntimeVersion,
  removeNullValues
} from '@opengsn/common'

import { AccountKeypair, AccountManager } from './AccountManager'
import { DefaultRelayFilter, KnownRelaysManager } from './KnownRelaysManager'
import { RelaySelectionManager } from './RelaySelectionManager'
import { isTransactionValid, RelayedTransactionValidator } from './RelayedTransactionValidator'
import { defaultGsnConfig, GSNConfig, GSNDependencies } from './GSNConfigurator'

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
    throw new Error(`Proposed priority gas fee: ${parseInt(gsnTransactionDetails.maxPriorityFeePerGas)}; relay's minMaxPriorityFeePerGas: ${pingResponse.minMaxPriorityFeePerGas}`)
  }
}

export interface GSNUnresolvedConstructorInput {
  provider: Web3ProviderBaseInterface
  config: Partial<GSNConfig>
  overrideDependencies?: Partial<GSNDependencies>
}

interface RelayingAttempt {
  relayRequestID?: PrefixedHexString
  validUntilTime?: string
  transaction?: TypedTransaction
  isRelayError?: boolean
  error?: Error
  auditPromise?: Promise<AuditResponse>
}

export interface RelayingResult {
  relayRequestID?: PrefixedHexString
  submissionBlock?: number
  validUntilTime?: string
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
    this.logger = rawConstructorInput.overrideDependencies?.logger ?? console
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
    if (!this.config.skipErc165Check) {
      await this.dependencies.contractInteractor._validateERC165InterfacesClient()
    }
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
    } catch (broadcastError: any) {
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
    const relayingErrors = new Map<string, Error>()
    const auditPromises: Array<Promise<AuditResponse>> = []

    let relayRequest: RelayRequest
    try {
      relayRequest = await this._prepareRelayRequest(gsnTransactionDetails)
    } catch (error: any) {
      relayingErrors.set(constants.DRY_RUN_KEY, error)
      return {
        relayingErrors,
        auditPromises,
        pingErrors: new Map<string, Error>()
      }
    }
    if (this.config.performDryRunViewRelayCall) {
      const dryRunError = await this._verifyDryRunSuccessful(relayRequest)
      if (dryRunError != null) {
        relayingErrors.set(constants.DRY_RUN_KEY, dryRunError)
        return {
          relayingErrors,
          auditPromises,
          pingErrors: new Map<string, Error>()
        }
      }
    }

    const relaySelectionManager = await new RelaySelectionManager(gsnTransactionDetails, this.dependencies.knownRelaysManager, this.dependencies.httpClient, this.dependencies.pingFilter, this.logger, this.config).init()
    const count = relaySelectionManager.relaysLeft().length
    this.emit(new GsnDoneRefreshRelaysEvent(count))
    if (count === 0) {
      throw new Error('no registered relayers')
    }
    const paymaster = this.dependencies.contractInteractor.getDeployment().paymasterAddress
    // approximate block height when relaying began is used to look up relayed events
    const submissionBlock = await this.dependencies.contractInteractor.getBlockNumberRightNow()

    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const relayHub = this.dependencies.contractInteractor.getDeployment().relayHubAddress ?? ''
      const activeRelay = await relaySelectionManager.selectNextRelay(relayHub, paymaster)
      if (activeRelay != null) {
        this.emit(new GsnNextRelayEvent(activeRelay.relayInfo.relayUrl))
        relayingAttempt = await this._attemptRelay(activeRelay, relayRequest)
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
        relayRequestID: relayingAttempt?.relayRequestID,
        submissionBlock,
        validUntilTime: relayingAttempt?.validUntilTime,
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
    relayRequest: RelayRequest
  ): Promise<RelayingAttempt> {
    this.logger.info(`attempting relay: ${JSON.stringify(relayInfo)} transaction: ${JSON.stringify(relayRequest)}`)
    await this.fillRelayInfo(relayRequest, relayInfo)
    const httpRequest = await this._prepareRelayHttpRequest(relayRequest, relayInfo)
    this.emit(new GsnValidateRequestEvent())

    const error = await this._verifyViewCallSuccessful(relayInfo, asRelayCallAbi(httpRequest), false)
    if (error != null) {
      return { error }
    }
    let signedTx: PrefixedHexString
    let nonceGapFilled: ObjectMap<PrefixedHexString>
    let transaction: TypedTransaction
    let auditPromise: Promise<AuditResponse>
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    const relayRequestID = this._getRelayRequestID(httpRequest.relayRequest, httpRequest.metadata.signature)
    try {
      ({ signedTx, nonceGapFilled } =
        await this.dependencies.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, httpRequest))
      transaction = TransactionFactory.fromSerializedData(toBuffer(signedTx), this.dependencies.contractInteractor.getRawTxOptions())
      auditPromise = this.auditTransaction(signedTx, relayInfo.relayInfo.relayUrl)
        .then((penalizeResponse) => {
          if (penalizeResponse.commitTxHash != null) {
            const txHash = bufferToHex(transaction.hash())
            this.logger.error(`The transaction with id: ${txHash} was penalized! Penalization commitment tx id: ${penalizeResponse.commitTxHash}`)
          }
          return penalizeResponse
        })
    } catch (error: any) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      this.logger.info(`relayTransaction: ${JSON.stringify(httpRequest)}`)
      return { error, isRelayError: true }
    }
    const validationResponse = this.dependencies.transactionValidator.validateRelayResponse(httpRequest, signedTx, nonceGapFilled)
    const isValid = isTransactionValid(validationResponse)
    if (!isValid) {
      this.emit(new GsnRelayerResponseEvent(false))
      this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return {
        auditPromise,
        isRelayError: true,
        // TODO: return human-readable error messages
        error: new Error(`Transaction response verification failed. Validation results: ${JSON.stringify(validationResponse)}`)
      }
    }
    this.emit(new GsnRelayerResponseEvent(true))
    await this._broadcastRawTx(transaction)
    return {
      relayRequestID,
      validUntilTime: httpRequest.relayRequest.request.validUntilTime,
      auditPromise,
      transaction
    }
  }

  // noinspection JSMethodCanBeStatic
  _getRelayRequestID (relayRequest: RelayRequest, signature: PrefixedHexString): PrefixedHexString {
    return getRelayRequestID(relayRequest, signature)
  }

  async _prepareRelayRequest (
    gsnTransactionDetails: GsnTransactionDetails
  ): Promise<RelayRequest> {
    const relayHubAddress = this.dependencies.contractInteractor.getDeployment().relayHubAddress
    const forwarder = this.dependencies.contractInteractor.getDeployment().forwarderAddress
    const paymaster = this.dependencies.contractInteractor.getDeployment().paymasterAddress
    if (relayHubAddress == null || paymaster == null || forwarder == null) {
      throw new Error('Contract addresses are not initialized!')
    }

    const senderNonce = await this.dependencies.contractInteractor.getSenderNonce(gsnTransactionDetails.from, forwarder)
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
        // temp values. filled in by 'fillRelayInfo'
        relayWorker: '',
        transactionCalldataGasUsed: '', // temp value. filled in by estimateCalldataCostAbi, below.
        paymasterData: '', // temp value. filled in by asyncPaymasterData, below.
        maxFeePerGas,
        maxPriorityFeePerGas,
        paymaster,
        clientId: this.config.clientId,
        forwarder
      }
    }

    // put paymasterData into struct before signing
    relayRequest.relayData.paymasterData = await this.dependencies.asyncPaymasterData(relayRequest)
    return relayRequest
  }

  fillRelayInfo (relayRequest: RelayRequest, relayInfo: RelayInfo): void {
    relayRequest.relayData.relayWorker = relayInfo.pingResponse.relayWorkerAddress
    // cannot estimate before relay info is filled in
    relayRequest.relayData.transactionCalldataGasUsed =
      this.dependencies.contractInteractor.estimateCalldataCostForRequest(relayRequest, this.config)
  }

  async _prepareRelayHttpRequest (
    relayRequest: RelayRequest,
    relayInfo: RelayInfo
  ): Promise<RelayTransactionRequest> {
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
    const relayLastKnownNonce = await this.dependencies.contractInteractor.getTransactionCount(relayInfo.pingResponse.relayWorkerAddress)
    const relayMaxNonce = relayLastKnownNonce + this.config.maxRelayNonceGap
    const relayHubAddress = this.dependencies.contractInteractor.getDeployment().relayHubAddress ?? ''
    const metadata: RelayMetadata = {
      maxAcceptanceBudget: relayInfo.pingResponse.maxAcceptanceBudget,
      relayHubAddress,
      signature,
      approvalData,
      relayMaxNonce,
      relayLastKnownNonce
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

  addAccount (privateKey: PrefixedHexString): AccountKeypair {
    this._verifyInitialized()
    return this.dependencies.accountManager.addAccount(privateKey)
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
    let configFromServer = {}
    const chainId = await new Web3(provider as any).eth.getChainId()
    const useClientDefaultConfigUrl = config.useClientDefaultConfigUrl ?? defaultGsnConfig.useClientDefaultConfigUrl
    if (useClientDefaultConfigUrl) {
      this.logger.debug(`Reading default client config for chainId ${chainId.toString()}`)
      configFromServer = await this._resolveConfigurationFromServer(chainId, defaultGsnConfig.clientDefaultConfigUrl)
    }
    return {
      ...defaultGsnConfig,
      ...configFromServer,
      ...removeNullValues(config)
    }
  }

  async _resolveConfigurationFromServer (chainId: number, clientDefaultConfigUrl: string): Promise<Partial<GSNConfig>> {
    try {
      const httpClient = new HttpClient(new HttpWrapper(), this.logger)
      const jsonConfig = await httpClient.getNetworkConfiguration(clientDefaultConfigUrl)
      if (jsonConfig.networks[chainId] == null) {
        return {}
      }
      return jsonConfig.networks[chainId].gsnConfig
    } catch (e) {
      this.logger.error(`Could not fetch default configuration: ${(e as Error).message}`)
      return {}
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
      asyncPaymasterData
    }
  }

  async _verifyDryRunSuccessful (relayRequest: RelayRequest): Promise<Error | undefined> {
    // TODO: only 3 fields are needed, extract fields instead of building stub object
    const dryRunRelayInfo: RelayInfo = {
      relayInfo: {
        lastSeenTimestamp: toBN(0),
        lastSeenBlockNumber: toBN(0),
        firstSeenTimestamp: toBN(0),
        firstSeenBlockNumber: toBN(0),
        relayManager: '',
        relayUrl: ''
      },
      pingResponse: {
        relayWorkerAddress: constants.DRY_RUN_ADDRESS,
        relayManagerAddress: constants.ZERO_ADDRESS,
        relayHubAddress: constants.ZERO_ADDRESS,
        ownerAddress: constants.ZERO_ADDRESS,
        minMaxPriorityFeePerGas: '0',
        maxAcceptanceBudget: '0',
        ready: true,
        version: ''
      }
    }
    // TODO: clone?
    this.fillRelayInfo(relayRequest, dryRunRelayInfo)
    // note that here 'maxAcceptanceBudget' is set to the entire transaction 'maxViewableGasLimit'
    const relayCallABI: RelayCallABI = {
      relayRequest,
      signature: '0x',
      approvalData: '0x',
      maxAcceptanceBudget: this.config.maxViewableGasLimit
    }
    return await this._verifyViewCallSuccessful(dryRunRelayInfo, relayCallABI, true)
  }

  async _verifyViewCallSuccessful (
    relayInfo: RelayInfo,
    relayCallABI: RelayCallABI,
    isDryRun: boolean
  ): Promise<Error | undefined> {
    const acceptRelayCallResult =
      await this.dependencies.contractInteractor.validateRelayCall(
        relayCallABI,
        toBN(this.config.maxViewableGasLimit),
        isDryRun)
    if (!acceptRelayCallResult.paymasterAccepted || acceptRelayCallResult.recipientReverted) {
      let message: string
      if (acceptRelayCallResult.relayHubReverted) {
        message = `${isDryRun ? 'DRY-RUN' : 'local'} view call to 'relayCall()' reverted`
      } else if (acceptRelayCallResult.recipientReverted) {
        message = `paymaster accepted but recipient reverted in ${isDryRun ? 'DRY-RUN' : 'local'} view call to 'relayCall()'`
      } else {
        message = `paymaster rejected in ${isDryRun ? 'DRY-RUN' : 'local'} view call to 'relayCall()'`
      }
      if (isDryRun) {
        message += '\n(You can set \'performDryRunViewRelayCall\' to \'false\' if your want to skip the DRY-RUN step)\nReported reason: '
      }
      return new Error(`${message}: ${decodeRevertReason(acceptRelayCallResult.returnValue)}`)
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
