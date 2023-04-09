import { AbiCoder } from '@ethersproject/abi'
import { EventEmitter } from 'events'
import { ExternalProvider, JsonRpcProvider } from '@ethersproject/providers'
import { TransactionFactory, TypedTransaction } from '@ethereumjs/tx'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'

import {
  Address,
  ApprovalDataCallback,
  AuditResponse,
  ContractInteractor,
  EIP1559Fees,
  EIP712Domain,
  GsnTransactionDetails,
  HttpClient,
  HttpWrapper,
  LoggerInterface,
  ObjectMap,
  PaymasterDataCallback,
  PaymasterType,
  PingFilter,
  RelayCallABI,
  RelayInfo,
  RelayMetadata,
  RelayRequest,
  RelayTransactionRequest,
  TokenDomainSeparators,
  VersionsManager,
  asRelayCallAbi,
  constants,
  decodeRevertReason,
  getPaymasterAddressByTypeAndChain,
  getRelayRequestID,
  gsnRequiredVersion,
  gsnRuntimeVersion,
  removeNullValues,
  toBN,
  toHex,
  wrapWeb3JsProvider
} from '@opengsn/common'

import { AccountKeypair, AccountManager } from './AccountManager'
import { DefaultRelayFilter, KnownRelaysManager } from './KnownRelaysManager'
import { RelaySelectionManager } from './RelaySelectionManager'
import {
  createVerifierApprovalDataCallback,
  DEFAULT_VERIFIER_SERVER_APPROVAL_DATA_LENGTH,
  DEFAULT_VERIFIER_SERVER_URL
} from './VerifierUtils'
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
export const EmptyDataCallback: ApprovalDataCallback & PaymasterDataCallback = async (...args: any[]): Promise<PrefixedHexString> => {
  return '0x'
}

/**
 * Warning: if providing custom 'PingFilter' it is important to call this one as well.
 * The MaxMaxFeePerGas parameter only exists on the Relay Server for the sanity check (i.e. not paying 1 ETH per gas).
 * We do not adjust a request for the MaxMaxFeePerGas, proposing gas prices above it is a sure misconfiguration.
 */
export const GasPricePingFilter: PingFilter = (pingResponse, gsnTransactionDetails) => {
  if (
    parseInt(pingResponse.minMaxFeePerGas) >= parseInt(pingResponse.maxMaxFeePerGas)) {
    throw new Error(`Misconfigured relay: relay's configured maxMaxFeePerGas: ${pingResponse.maxMaxFeePerGas} relay's minMaxFeePerGas: ${pingResponse.minMaxFeePerGas}`)
  }
  if (parseInt(gsnTransactionDetails.maxFeePerGas) > parseInt(pingResponse.maxMaxFeePerGas)) {
    throw new Error(`Proposed fee per gas: ${parseInt(gsnTransactionDetails.maxFeePerGas)}; relay's configured maxMaxFeePerGas: ${pingResponse.maxMaxFeePerGas}`)
  }
}

export interface GSNUnresolvedConstructorInput {
  provider: JsonRpcProvider | ExternalProvider
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
    this.dependencies = await this._resolveDependencies({
      config: this.config,
      provider: this.getUnderlyingProvider(),
      overrideDependencies: this.rawConstructorInput.overrideDependencies
    })
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
      this.dependencies.contractInteractor.provider.getTransactionReceipt(txHash),
      // mempool transactions
      // ethers.js does not really support 'pending' block yet
      this.dependencies.contractInteractor.provider.send('eth_getBlockByNumber', ['pending', false])
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
      // in order to avoid using less gas in '_msgSender()', make an 'estimateGas' call from the Forwarder address
      let from = this.dependencies.contractInteractor.getDeployment().forwarderAddress
      let data = gsnTransactionDetails.data + gsnTransactionDetails.from.replace('0x', '')
      if (this.config.performEstimateGasFromRealSender) {
        // use only in case making an 'estimateGas' from Forwarder address causes exceptions
        from = gsnTransactionDetails.from
        data = gsnTransactionDetails.data
      }
      const value = '0'
      const txDetailsFromForwarder = Object.assign({}, gsnTransactionDetails, { from, data, value })
      const estimated = await this.dependencies.contractInteractor.estimateInnerCallGasLimit(txDetailsFromForwarder)
      gsnTransactionDetails.gas = `0x${estimated.toString(16)}`
    }
    const relayingErrors = new Map<string, Error>()
    const auditPromises: Array<Promise<AuditResponse>> = []

    let relayRequest: RelayRequest | undefined
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
      const relaySelectionResult = await relaySelectionManager.selectNextRelay(relayHub, paymaster)
      const activeRelay = relaySelectionResult?.relayInfo as RelayInfo // safe to cast as R.S.M. looks up missing details internally
      if (activeRelay != null) {
        if (relaySelectionResult != null) {
          // adjust relay request fees for the selected relay if necessary
          relayRequest.relayData.maxFeePerGas = toHex(relaySelectionResult.updatedGasFees.maxFeePerGas)
          relayRequest.relayData.maxPriorityFeePerGas = toHex(relaySelectionResult.updatedGasFees.maxPriorityFeePerGas)
        }
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

  async calculateGasFees (): Promise<EIP1559Fees> {
    const pct = this.config.gasPriceFactorPercent
    const gasFees = await this.dependencies.contractInteractor.getGasFees(this.config.getGasFeesBlocks, this.config.getGasFeesPercentile)
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
    const viewCallGasLimit = await this.dependencies.contractInteractor.calculateDryRunCallGasLimit(
      relayRequest.relayData.paymaster,
      relayRequest.relayData.relayWorker,
      toBN(relayRequest.relayData.maxFeePerGas),
      toBN(this.config.maxViewableGasLimit),
      toBN(this.config.minViewableGasLimit)
    )
    const error = await this._verifyViewCallSuccessful(relayInfo, asRelayCallAbi(httpRequest), viewCallGasLimit, false)
    if (error != null) {
      return { error }
    }
    let signedTx: PrefixedHexString
    let nonceGapFilled: ObjectMap<PrefixedHexString>
    let transaction: TypedTransaction
    let auditPromise: Promise<AuditResponse>
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
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
      relayRequestID: httpRequest.metadata.relayRequestId,
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

  async fillRelayInfo (relayRequest: RelayRequest, relayInfo: RelayInfo): Promise<void> {
    relayRequest.relayData.relayWorker = relayInfo.pingResponse.relayWorkerAddress
    // cannot estimate before relay info is filled in
    relayRequest.relayData.transactionCalldataGasUsed =
      await this.dependencies.contractInteractor.estimateCalldataCostForRequest(relayRequest, this.config)
  }

  async _prepareRelayHttpRequest (
    relayRequest: RelayRequest,
    relayInfo: RelayInfo
  ): Promise<RelayTransactionRequest> {
    this.emit(new GsnSignRequestEvent())
    const signature = await this.dependencies.accountManager.sign(this.config.domainSeparatorName, relayRequest)
    const relayRequestId = this._getRelayRequestID(relayRequest, signature)
    const approvalData = await this.dependencies.asyncApprovalData(relayRequest, relayRequestId)

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
      domainSeparatorName: this.config.domainSeparatorName,
      maxAcceptanceBudget: relayInfo.pingResponse.maxAcceptanceBudget,
      relayHubAddress,
      relayRequestId,
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

  getUnderlyingProvider (): JsonRpcProvider {
    return wrapWeb3JsProvider(this.rawConstructorInput.provider)
  }

  async _resolveConfiguration ({
    config = {}
  }: GSNUnresolvedConstructorInput): Promise<GSNConfig> {
    let configFromServer: Partial<GSNConfig> = {}
    const network = await this.getUnderlyingProvider().getNetwork()
    const chainId = network.chainId
    const useClientDefaultConfigUrl = config.useClientDefaultConfigUrl ?? defaultGsnConfig.useClientDefaultConfigUrl
    if (useClientDefaultConfigUrl) {
      this.logger.debug(`Reading default client config for chainId ${chainId.toString()}`)
      configFromServer = await this._resolveConfigurationFromServer(chainId, defaultGsnConfig.clientDefaultConfigUrl)
    }
    await this._resolveVerifierConfig(config, chainId)

    // EIP-712 Domain Separators are not so much config as extra info and should be merged
    const tokenPaymasterDomainSeparators: { [address: Address]: EIP712Domain } = {
      ...TokenDomainSeparators[chainId],
      ...configFromServer.tokenPaymasterDomainSeparators,
      ...config.tokenPaymasterDomainSeparators
    }
    const resolvedConfig = {
      ...defaultGsnConfig,
      ...configFromServer,
      ...removeNullValues(config),
      ...{ tokenPaymasterDomainSeparators }
    }
    this.logger.debug(`Fully resolved GSN configuration: ${JSON.stringify(resolvedConfig)}`)
    return resolvedConfig
  }

  async _resolveVerifyingPaymasterAddress (verifierUrl: string, chainId: number): Promise<Address> {
    try {
      const httpClient = new HttpClient(new HttpWrapper(), this.logger)
      return await httpClient.getVerifyingPaymasterAddress(verifierUrl, chainId)
    } catch (e) {
      this.logger.error(`Could not fetch VerifyingPaymaster address: ${(e as Error).message}`)
      return constants.ZERO_ADDRESS
    }
  }

  async _resolveVerifierConfig (config: Partial<GSNConfig>, chainId: number): Promise<void> {
    if (config.verifierServerApiKey == null || config.verifierServerApiKey.length === 0) {
      return
    }
    if (config.maxApprovalDataLength == null || config.maxApprovalDataLength === 0) {
      this.logger.info('Verifier server API Key is set - setting maxApprovalDataLength')
      config.maxApprovalDataLength = DEFAULT_VERIFIER_SERVER_APPROVAL_DATA_LENGTH
    } else {
      this.logger.warn('Verifier server API Key and "maxApprovalDataLength" are both set. Make sure they match!')
    }
    config.verifierServerUrl = config.verifierServerUrl ?? DEFAULT_VERIFIER_SERVER_URL
    this.logger.info(`Verifier server API Key is set - setting verifierServerUrl to ${config.verifierServerUrl}`)

    // TODO: fetching Verifier Paymaster flow contradicts 'OfficialPaymasterDeployments' flow - choose one
    if (
      config.paymasterAddress == null ||
      config.paymasterAddress === '' ||
      config.paymasterAddress === PaymasterType.VerifyingPaymaster.valueOf()
    ) {
      config.paymasterAddress = await this._resolveVerifyingPaymasterAddress(config.verifierServerUrl, chainId)
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
    config,
    overrideDependencies = {}
  }: {
    provider: JsonRpcProvider
    config: GSNConfig
    overrideDependencies?: Partial<GSNDependencies>
  }): Promise<GSNDependencies> {
    const versionManager = new VersionsManager(gsnRuntimeVersion, config.requiredVersionRange ?? gsnRequiredVersion)
    const network = await provider.getNetwork()
    const chainId = parseInt(network.chainId.toString())
    const paymasterAddress = getPaymasterAddressByTypeAndChain(config?.paymasterAddress, chainId, this.logger)
    const contractInteractor = overrideDependencies?.contractInteractor ??
      await new ContractInteractor({
        provider,
        versionManager,
        logger: this.logger,
        maxPageSize: this.config.pastEventsQueryMaxPageSize,
        maxPageCount: this.config.pastEventsQueryMaxPageCount,
        environment: this.config.environment,
        domainSeparatorName: this.config.domainSeparatorName,
        calldataEstimationSlackFactor: this.config.calldataEstimationSlackFactor,
        deployment: { paymasterAddress: paymasterAddress as any }
      }).init()
    const accountManager = overrideDependencies?.accountManager ?? new AccountManager(provider, chainId, this.config)

    // TODO: accept HttpWrapper as a dependency - calling 'new' here is breaking the init flow.
    const httpWrapper = new HttpWrapper()
    const httpClient = overrideDependencies?.httpClient ?? new HttpClient(httpWrapper, this.logger)
    const pingFilter = overrideDependencies?.pingFilter ?? GasPricePingFilter
    const relayFilter = overrideDependencies?.relayFilter ?? DefaultRelayFilter
    const asyncApprovalData = await this._resolveVerifierApprovalDataCallback(config, httpWrapper, chainId, overrideDependencies?.asyncApprovalData)
    const asyncPaymasterData = overrideDependencies?.asyncPaymasterData ?? this.resolveAsyncPaymasterCallback(config.paymasterAddress, config.dappOwner)
    const asyncSignTypedData = overrideDependencies?.asyncSignTypedData
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
      asyncSignTypedData
    }
  }

  async _resolveVerifierApprovalDataCallback (
    config: GSNConfig,
    httpWrapper: HttpWrapper,
    chainId: number,
    asyncApprovalData?: ApprovalDataCallback
  ): Promise<ApprovalDataCallback> {
    if (config.verifierServerApiKey == null || config.verifierServerApiKey.length === 0) {
      return asyncApprovalData ?? EmptyDataCallback
    }
    if (asyncApprovalData != null) {
      throw new Error('Passing both verifierServerApiKey and asyncApprovalData params is unsupported.')
    }
    if (config.verifierServerUrl == null) {
      throw new Error('The "verifierServerUrl" is not initialized but "verifierServerApiKey" is set.')
    }
    return createVerifierApprovalDataCallback(
      httpWrapper,
      this.logger,
      config.domainSeparatorName,
      chainId,
      config.verifierServerApiKey,
      config.verifierServerUrl)
  }

  async _verifyDryRunSuccessful (relayRequest: RelayRequest): Promise<Error | undefined> {
    // TODO: only 3 fields are needed, extract fields instead of building stub object
    const relayWorkerAddress = constants.DRY_RUN_ADDRESS
    const maxMaxFeePerGas = '0'
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
        relayWorkerAddress,
        relayManagerAddress: constants.ZERO_ADDRESS,
        relayHubAddress: constants.ZERO_ADDRESS,
        ownerAddress: constants.ZERO_ADDRESS,
        maxMaxFeePerGas,
        minMaxFeePerGas: '0',
        minMaxPriorityFeePerGas: '0',
        maxAcceptanceBudget: '0',
        ready: true,
        version: ''
      }
    }
    // TODO: clone?
    await this.fillRelayInfo(relayRequest, dryRunRelayInfo)
    const paymasterLimits =
      await this.dependencies.contractInteractor.getGasAndDataLimitsFromPaymaster(relayRequest.relayData.paymaster)
    const maxAcceptanceBudget = paymasterLimits.acceptanceBudget
    const viewCallGasLimit = await this.dependencies.contractInteractor.calculateDryRunCallGasLimit(
      relayRequest.relayData.paymaster,
      relayWorkerAddress,
      toBN(relayRequest.relayData.maxFeePerGas),
      toBN(this.config.maxViewableGasLimit),
      toBN(this.config.minViewableGasLimit)
    )
    // note that here 'maxAcceptanceBudget' is set to the entire transaction 'maxViewableGasLimit'
    const relayCallABI: RelayCallABI = {
      domainSeparatorName: this.config.domainSeparatorName,
      relayRequest,
      signature: '0x',
      approvalData: '0x',
      maxAcceptanceBudget: maxAcceptanceBudget.toString()
    }
    return await this._verifyViewCallSuccessful(dryRunRelayInfo, relayCallABI, viewCallGasLimit, true)
  }

  async _verifyViewCallSuccessful (
    relayInfo: RelayInfo,
    relayCallABI: RelayCallABI,
    viewCallGasLimit: BN,
    isDryRun: boolean
  ): Promise<Error | undefined> {
    const acceptRelayCallResult =
      await this.dependencies.contractInteractor.validateRelayCall(
        relayCallABI,
        viewCallGasLimit,
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

  private resolveAsyncPaymasterCallback (
    paymasterAddress: Address | PaymasterType | undefined,
    dappOwner?: Address
  ): PaymasterDataCallback {
    if (dappOwner != null && paymasterAddress === PaymasterType.SingletonWhitelistPaymaster) {
      // TODO: refactor
      this.config.maxPaymasterDataLength = 32
      return async () => { return new AbiCoder().encode(['address'], [dappOwner]) }
    }
    return EmptyDataCallback
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
