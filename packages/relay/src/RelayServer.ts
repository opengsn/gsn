import chalk from 'chalk'
import { EventEmitter } from 'events'
import { toBN, toHex } from 'web3-utils'
import { PrefixedHexString, BN } from 'ethereumjs-util'
import { Block } from '@ethersproject/providers'

import { IRelayHubInstance } from '@opengsn/contracts/types/truffle-contracts'

import {
  Address,
  AmountRequired,
  ContractInteractor,
  Environment,
  EventData,
  IntString,
  LoggerInterface,
  ObjectMap,
  PingResponse,
  ReadinessInfo,
  RelayCallGasLimitCalculationHelper,
  RelayRequest,
  RelayRequestLimits,
  RelayTransactionRequest,
  StatsResponse,
  TransactionRejectedByPaymaster,
  TransactionRelayed,
  TransactionType,
  VersionsManager,
  constants,
  gsnRequiredVersion,
  gsnRuntimeVersion,
  isSameAddress,
  toNumber
} from '@opengsn/common'

import { GasPriceFetcher } from './GasPriceFetcher'

import {
  address2topic,
  decodeRevertReason,
  PaymasterGasAndDataLimits,
  randomInRange,
  sleep
} from '@opengsn/common/dist/Utils'

import { RegistrationManager } from './RegistrationManager'
import { PaymasterStatus, ReputationManager } from './ReputationManager'
import {
  BoostingResult,
  SendTransactionDetails,
  TransactionManager
} from './TransactionManager'
import { ServerAction, ShortBlockInfo } from './StoredTransaction'
import { TxStoreManager } from './TxStoreManager'
import { configureServer, ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import { Web3MethodsBuilder } from './Web3MethodsBuilder'

export class RelayServer extends EventEmitter {
  readonly logger: LoggerInterface
  lastScannedBlock = 0
  lastRefreshBlock = 0
  ready = false
  readonly managerAddress: PrefixedHexString
  readonly workerAddress: PrefixedHexString
  minMaxPriorityFeePerGas: number = 0
  minMaxFeePerGas: number = 0
  running = false
  alerted = false
  alertedByTransactionBlockTimestamp: number = 0
  initialized: boolean = false
  shouldRefreshBalances = true
  readonly contractInteractor: ContractInteractor
  readonly gasLimitCalculator: RelayCallGasLimitCalculationHelper
  readonly web3MethodsBuilder: Web3MethodsBuilder
  readonly gasPriceFetcher: GasPriceFetcher
  private readonly versionManager: VersionsManager
  config: ServerConfigParams
  transactionManager: TransactionManager
  txStoreManager: TxStoreManager
  readinessInfo: ReadinessInfo
  maxGasLimit: number = 0
  transactionType = TransactionType.LEGACY

  reputationManager!: ReputationManager
  registrationManager: RegistrationManager
  chainId!: number
  networkId!: number
  relayHubContract!: IRelayHubInstance

  trustedPaymastersGasAndDataLimits: Map<String | undefined, PaymasterGasAndDataLimits> = new Map<String | undefined, PaymasterGasAndDataLimits>()

  workerBalanceRequired: AmountRequired

  environment: Environment

  constructor (
    config: Partial<ServerConfigParams>,
    transactionManager: TransactionManager,
    dependencies: ServerDependencies) {
    super()
    this.logger = dependencies.logger
    this.versionManager = new VersionsManager(gsnRuntimeVersion, gsnRequiredVersion)
    this.config = configureServer(config)
    this.contractInteractor = dependencies.contractInteractor
    this.gasLimitCalculator = dependencies.gasLimitCalculator
    this.web3MethodsBuilder = dependencies.web3MethodsBuilder
    this.environment = this.contractInteractor.environment
    this.gasPriceFetcher = dependencies.gasPriceFetcher
    this.txStoreManager = dependencies.txStoreManager
    this.transactionManager = transactionManager
    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.workerAddress = this.transactionManager.workersKeyManager.getAddress(0)
    this.workerBalanceRequired = new AmountRequired('Worker Balance', toBN(this.config.workerMinBalance), constants.ZERO_ADDRESS, this.logger)
    if (this.config.runPaymasterReputations) {
      if (dependencies.reputationManager == null) {
        throw new Error('ReputationManager is not initialized')
      }
      this.reputationManager = dependencies.reputationManager
    }
    this.registrationManager = new RegistrationManager(
      this.contractInteractor,
      this.web3MethodsBuilder,
      this.transactionManager,
      this.txStoreManager,
      this,
      this.logger,
      this.config,
      this.managerAddress,
      this.workerAddress
    )
    const now = Date.now()
    this.readinessInfo = {
      runningSince: now,
      currentStateTimestamp: now,
      totalReadyTime: 0,
      totalNotReadyTime: 0,
      totalReadinessChanges: 0
    }
    this.printServerAddresses()
    this.logger.warn(`RelayServer version', ${gsnRuntimeVersion}`)
    this.logger.info(`Using server configuration:\n ${JSON.stringify(this.config)}`)
  }

  printServerAddresses (): void {
    this.logger.info(`Server manager address  | ${this.managerAddress}`)
    this.logger.info(`Server worker  address  | ${this.workerAddress}`)
  }

  getMinMaxPriorityFeePerGas (): number {
    return this.minMaxPriorityFeePerGas
  }

  async pingHandler (paymaster?: string): Promise<PingResponse> {
    if (this.config.runPaymasterReputations && paymaster != null) {
      await this.validatePaymasterReputation(paymaster, this.lastScannedBlock)
    }
    return {
      relayWorkerAddress: this.workerAddress,
      relayManagerAddress: this.managerAddress,
      relayHubAddress: this.relayHubContract?.address ?? '',
      ownerAddress: this.config.ownerAddress,
      minMaxPriorityFeePerGas: this.getMinMaxPriorityFeePerGas().toString(),
      maxMaxFeePerGas: this.config.maxMaxFeePerGas,
      minMaxFeePerGas: this.minMaxFeePerGas.toString(),
      maxAcceptanceBudget: this._getPaymasterMaxAcceptanceBudget(paymaster),
      chainId: this.chainId.toString(),
      networkId: this.networkId.toString(),
      ready: this.isReady() ?? false,
      version: gsnRuntimeVersion
    }
  }

  statsHandler (): StatsResponse {
    // First updating latest saved state up to the time of this 'stats' http request, since it might not be up to date.
    const now = Date.now()
    const statsResponse: StatsResponse = { ...this.readinessInfo, totalUptime: now - this.readinessInfo.runningSince }
    if (this.isReady()) {
      statsResponse.totalReadyTime = this.readinessInfo.totalReadyTime + now - this.readinessInfo.currentStateTimestamp
    } else {
      statsResponse.totalNotReadyTime = this.readinessInfo.totalNotReadyTime + now - this.readinessInfo.currentStateTimestamp
    }
    return statsResponse
  }

  validateRequestTxType (req: RelayTransactionRequest): void {
    if (this.transactionType === TransactionType.LEGACY && req.relayRequest.relayData.maxFeePerGas !== req.relayRequest.relayData.maxPriorityFeePerGas) {
      throw new Error(`Current network (${this.chainId}) does not support EIP-1559 transactions.`)
    }
  }

  validateInput (req: RelayTransactionRequest): void {
    // Check that the relayHub is the correct one
    if (req.metadata.relayHubAddress !== this.relayHubContract.address) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract.address}, request's hub address: ${req.metadata.relayHubAddress}\n`)
    }

    // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
    if (!isSameAddress(req.relayRequest.relayData.relayWorker.toLowerCase(), this.workerAddress.toLowerCase())) {
      throw new Error(
        `Wrong worker address: ${req.relayRequest.relayData.relayWorker}\n`)
    }

    this.validateGasFees(req.relayRequest)
    this.validateWhitelistsAndBlacklists(req.relayRequest)
    // validate the validUntil is not too close
    const secondsNow = Math.round(Date.now() / 1000)
    const expiredInSeconds = parseInt(req.relayRequest.request.validUntilTime) - secondsNow
    if (expiredInSeconds < this.config.requestMinValidSeconds) {
      const expirationDate = new Date(parseInt(req.relayRequest.request.validUntilTime) * 1000)
      throw new Error(
        `Request expired (or too close): expired at (${expirationDate.toUTCString()}), we expect it to be valid until ${new Date(secondsNow + this.config.requestMinValidSeconds).toUTCString()} `)
    }
  }

  validateWhitelistsAndBlacklists (relayRequest: RelayRequest): void {
    if (this._isBlacklistedPaymaster(relayRequest.relayData.paymaster)) {
      throw new Error(`Paymaster ${relayRequest.relayData.paymaster} is blacklisted!`)
    }
    if (this._isBlacklistedRecipient(relayRequest.request.to)) {
      throw new Error(`Recipient ${relayRequest.request.to} is blacklisted!`)
    }
    if (this.config.url.length === 0) {
      if (!this._isWhitelistedPaymaster(relayRequest.relayData.paymaster)) {
        throw new Error(`Paymaster ${relayRequest.relayData.paymaster} is not whitelisted!`)
      }
      if (!this._isWhitelistedRecipient(relayRequest.request.to)) {
        throw new Error(`Recipient ${relayRequest.request.to} is not whitelisted!`)
      }
    }
  }

  validateGasFees (relayRequest: RelayRequest): void {
    const requestPriorityFee = parseInt(relayRequest.relayData.maxPriorityFeePerGas)
    const requestMaxFee = parseInt(relayRequest.relayData.maxFeePerGas)
    if (this.minMaxPriorityFeePerGas > requestPriorityFee) {
      throw new Error(
        `priorityFee given ${requestPriorityFee} too low. Minimum maxPriorityFee server accepts: ${this.minMaxPriorityFeePerGas}`)
    }
    if (this.minMaxFeePerGas > requestMaxFee) {
      throw new Error(
        `maxFeePerGas given ${requestMaxFee} too low. Minimum maxFeePerGas server accepts: ${this.minMaxFeePerGas}`)
    }
    if (parseInt(this.config.maxMaxFeePerGas) < requestMaxFee) {
      throw new Error(
        `maxFee given ${requestMaxFee} too high : ${this.config.maxMaxFeePerGas}`)
    }
    if (requestMaxFee < requestPriorityFee) {
      throw new Error(
        `maxFee ${requestMaxFee} cannot be lower than priorityFee ${requestPriorityFee}`)
    }
  }

  async validateMaxNonce (relayMaxNonce: number): Promise<void> {
    // Check that max nonce is valid
    const nonce = await this.transactionManager.pollNonce(this.workerAddress)
    if (nonce > relayMaxNonce) {
      throw new Error(`Unacceptable relayMaxNonce: ${relayMaxNonce}. current nonce: ${nonce}`)
    }
  }

  async validatePaymasterReputation (paymaster: Address, currentBlockNumber: number): Promise<void> {
    if (this._isTrustedPaymaster(paymaster)) {
      return
    }
    const status = await this.reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
    if (status === PaymasterStatus.GOOD) {
      return
    }
    let message: string
    switch (status) {
      case PaymasterStatus.ABUSED:
        message = 'This paymaster has failed a lot of transactions recently is temporarily blocked by this relay'
        break
      case PaymasterStatus.THROTTLED:
        message = 'This paymaster only had a small number of successful transactions and is therefore throttled by this relay'
        break
      case PaymasterStatus.BLOCKED:
        message = 'This paymaster had too many unsuccessful transactions and is now permanently blocked by this relay'
        break
    }
    throw new Error(`Refusing to serve transactions for paymaster at ${paymaster}: ${message}`)
  }

  async calculateAndValidatePaymasterGasAndDataLimits (relayTransactionRequest: RelayTransactionRequest): Promise<number> {
    let gasAndDataLimits = this.trustedPaymastersGasAndDataLimits.get(relayTransactionRequest.relayRequest.relayData.paymaster)
    if (gasAndDataLimits == null) {
      gasAndDataLimits = await this.contractInteractor.getGasAndDataLimitsFromPaymaster(relayTransactionRequest.relayRequest.relayData.paymaster)
    }

    const relayRequestLimits = await this.gasLimitCalculator.calculateRelayRequestLimits(
      relayTransactionRequest,
      gasAndDataLimits
    )
    await this.validatePaymasterGasAndDataLimits(
      relayTransactionRequest,
      relayRequestLimits,
      gasAndDataLimits
    )
    return relayRequestLimits.maxPossibleGasUsed.toNumber()
  }

  async validatePaymasterGasAndDataLimits (
    relayTransactionRequest: RelayTransactionRequest,
    relayRequestLimits: RelayRequestLimits,
    gasAndDataLimits: PaymasterGasAndDataLimits
  ): Promise<void> {
    const paymaster = relayTransactionRequest.relayRequest.relayData.paymaster
    this.verifyTransactionCalldataGasUsed(relayTransactionRequest, relayRequestLimits.transactionCalldataGasUsed)
    this.verifyEffectiveAcceptanceBudget(gasAndDataLimits.acceptanceBudget.toNumber(), relayRequestLimits.effectiveAcceptanceBudgetGasUsed, parseInt(relayTransactionRequest.metadata.maxAcceptanceBudget), paymaster)
    this.verifyMaxPossibleGas(relayRequestLimits.maxPossibleGasUsed.toNumber())
    await this.verifyPaymasterBalance(relayRequestLimits.maxPossibleCharge, relayRequestLimits.maxPossibleGasUsed.toNumber(), paymaster)
  }

  verifyTransactionCalldataGasUsed (req: RelayTransactionRequest, transactionCalldataGasUsed: number): void {
    const message =
      `Client signed transactionCalldataGasUsed: ${req.relayRequest.relayData.transactionCalldataGasUsed}` +
      `Server estimate of its transactionCalldata gas expenses: ${transactionCalldataGasUsed}`
    this.logger.info(message)
    if (toBN(transactionCalldataGasUsed).gt(toBN(req.relayRequest.relayData.transactionCalldataGasUsed))) {
      throw new Error(`Refusing to relay a transaction due to calldata cost. ${message}`)
    }
  }

  verifyEffectiveAcceptanceBudget (
    paymasterAcceptanceBudget: number,
    effectiveAcceptanceBudget: number,
    requestMaxAcceptanceBudget: number,
    paymaster: string
  ): void {
    if (paymasterAcceptanceBudget > requestMaxAcceptanceBudget) {
      throw new Error(
        `paymaster acceptance budget is too high. given: ${requestMaxAcceptanceBudget} paymaster: ${paymasterAcceptanceBudget}`)
    }
    if (effectiveAcceptanceBudget > this.config.maxAcceptanceBudget) {
      if (!this._isTrustedPaymaster(paymaster)) {
        throw new Error(
          `paymaster acceptance budget + msg.data gas cost too high. given: ${effectiveAcceptanceBudget} max allowed: ${this.config.maxAcceptanceBudget}`)
      }
      this.logger.debug(`Using trusted paymaster's higher than max acceptance budget. requestMaxAcceptanceBudget: ${requestMaxAcceptanceBudget} effectiveAcceptanceBudget: ${effectiveAcceptanceBudget}`)
    }
  }

  verifyMaxPossibleGas (maxPossibleGasFactorReserve: number): void {
    if (maxPossibleGasFactorReserve > this.maxGasLimit) {
      throw new Error(`maxPossibleGas (${maxPossibleGasFactorReserve}) exceeds maxGasLimit (${this.maxGasLimit})`)
    }
  }

  async verifyPaymasterBalance (maxPossibleCharge: BN, maxPossibleGasFactorReserve: number, paymaster: string): Promise<void> {
    const paymasterBalance = await this.relayHubContract.balanceOf(paymaster)
    this.logger.debug(`paymaster balance: ${paymasterBalance.toString()}, maxCharge: ${maxPossibleCharge.toString()}`)
    this.logger.debug(`Estimated max charge of relayed tx: ${maxPossibleCharge.toString()}, GasLimit of relayed tx: ${maxPossibleGasFactorReserve}`)
    if (paymasterBalance.lt(maxPossibleCharge)) {
      throw new Error(`paymaster balance too low: ${paymasterBalance.toString()}, maxCharge: ${maxPossibleCharge.toString()}`)
    }
  }

  async validateViewCallSucceeds (req: RelayTransactionRequest, maxAcceptanceBudget: number, maxPossibleGas: number): Promise<void> {
    this.logger.debug(`validateViewCallSucceeds: ${JSON.stringify(arguments)}`)
    const method = this.web3MethodsBuilder.getRelayCallMethod(
      req.metadata.domainSeparatorName,
      maxAcceptanceBudget, req.relayRequest, req.metadata.signature, req.metadata.approvalData)
    let viewRelayCallRet: { paymasterAccepted: boolean, returnValue: string }
    try {
      if (this.transactionType === TransactionType.TYPE_TWO) {
        viewRelayCallRet =
          await method.call({
            from: this.workerAddress,
            maxFeePerGas: toHex(req.relayRequest.relayData.maxFeePerGas),
            maxPriorityFeePerGas: toHex(req.relayRequest.relayData.maxPriorityFeePerGas),
            gasLimit: maxPossibleGas
          }, 'pending')
      } else {
        viewRelayCallRet =
          await method.call({
            from: this.workerAddress,
            gasPrice: toHex(req.relayRequest.relayData.maxFeePerGas),
            gasLimit: maxPossibleGas
          }, 'pending')
      }
    } catch (e) {
      throw new Error(`relayCall reverted in server: ${(e as Error).message}`)
    }
    this.logger.debug(`Result for view-only relay call (on pending block):
paymasterAccepted  | ${viewRelayCallRet.paymasterAccepted ? chalk.green('true') : chalk.red('false')}
returnValue        | ${viewRelayCallRet.returnValue}
`)
    if (!viewRelayCallRet.paymasterAccepted) {
      throw new Error(
        `Paymaster rejected in server: ${decodeRevertReason(viewRelayCallRet.returnValue)} req=${JSON.stringify(req, null, 2)}`)
    }
  }

  async createRelayTransaction (req: RelayTransactionRequest): Promise<{
    signedTx: PrefixedHexString
    nonceGapFilled: ObjectMap<PrefixedHexString>
  }> {
    this.logger.debug(`dump request params: ${JSON.stringify(req)}`)
    if (!this.isReady()) {
      throw new Error('relay not ready')
    }
    this.validateRequestTxType(req)
    if (this.alerted) {
      this.logger.error('Alerted state: slowing down traffic')
      await sleep(randomInRange(this.config.minAlertedDelayMS, this.config.maxAlertedDelayMS))
    }
    const currentBlock = await this.contractInteractor.getBlock('latest')
    const currentBlockTimestamp = toNumber(currentBlock.timestamp)
    this.validateInput(req)
    await this.validateMaxNonce(req.metadata.relayMaxNonce)
    if (this.config.runPaymasterReputations) {
      await this.validatePaymasterReputation(req.relayRequest.relayData.paymaster, this.lastScannedBlock)
    }

    const maxPossibleGas = await this.calculateAndValidatePaymasterGasAndDataLimits(req)

    // Call relayCall as a view function to see if we'll get paid for relaying this tx
    await this.validateViewCallSucceeds(req, parseInt(req.metadata.maxAcceptanceBudget), maxPossibleGas)
    if (this.config.runPaymasterReputations) {
      await this.reputationManager.onRelayRequestAccepted(req.relayRequest.relayData.paymaster)
    }
    // Send relayed transaction
    this.logger.debug(`maxPossibleGas is: ${maxPossibleGas}`)

    const method = this.web3MethodsBuilder.getRelayCallMethod(
      req.metadata.domainSeparatorName, req.metadata.maxAcceptanceBudget, req.relayRequest, req.metadata.signature, req.metadata.approvalData)
    const details: SendTransactionDetails =
      {
        signer: this.workerAddress,
        serverAction: ServerAction.RELAY_CALL,
        method,
        destination: req.metadata.relayHubAddress,
        gasLimit: maxPossibleGas,
        creationBlockNumber: currentBlock.number,
        creationBlockHash: currentBlock.hash,
        creationBlockTimestamp: currentBlockTimestamp,
        maxFeePerGas: req.relayRequest.relayData.maxFeePerGas,
        maxPriorityFeePerGas: req.relayRequest.relayData.maxPriorityFeePerGas
      }
    const { signedTx, nonce } = await this.transactionManager.sendTransaction(details)
    const nonceGapFilled = await this.transactionManager.getNonceGapFilled(this.workerAddress, req.metadata.relayLastKnownNonce, nonce - 1)
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(0, currentBlock.number, currentBlock.hash, currentBlockTimestamp)
    return { signedTx, nonceGapFilled }
  }

  start (): void {
    this.logger.info(`Started polling for new blocks every ${this.config.checkInterval}ms`)
    this.running = true
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(this.intervalHandler.bind(this), this.config.checkInterval)
  }

  stop (): void {
    if (!this.running) {
      throw new Error('Server not started')
    }
    this.running = false
    this.logger.info('Stopping server')
  }

  fatal (message: string): void {
    this.logger.error('FATAL: ' + message)
    process.exit(1)
  }

  /***
   * initialize data from trusted paymasters.
   * "Trusted" paymasters means that:
   * - we trust their code not to alter the gas limits (getGasAndDataLimits returns constants)
   * - we trust preRelayedCall to be consistent: off-chain call and on-chain calls should either both succeed
   *    or both revert.
   * - given that, we agree to give the requested acceptanceBudget (since breaking one of the above two "invariants"
   *    is the only cases where the relayer will have to pay for this budget)
   *
   * @param paymasters list of trusted paymaster addresses
   */
  async _initTrustedPaymasters (paymasters: string[] = []): Promise<void> {
    this.trustedPaymastersGasAndDataLimits.clear()
    for (const paymasterAddress of paymasters) {
      const paymaster = await this.contractInteractor._createPaymaster(paymasterAddress)
      const gasAndDataLimits = await paymaster.getGasAndDataLimits().catch((e: Error) => {
        throw new Error(`not a valid paymaster address in trustedPaymasters list: ${paymasterAddress}: ${e.message}`)
      })
      this.trustedPaymastersGasAndDataLimits.set(paymasterAddress.toLowerCase(), gasAndDataLimits)
    }
  }

  _getPaymasterMaxAcceptanceBudget (paymaster?: string): IntString {
    const limits = this.trustedPaymastersGasAndDataLimits.get(paymaster?.toLowerCase())
    if (limits != null) {
      return limits.acceptanceBudget.toString()
    } else {
      // todo fix
      return this.config.maxAcceptanceBudget.toString()
    }
  }

  async init (): Promise<PrefixedHexString[]> {
    const initStartTimestamp = Date.now()
    this.logger.debug('server init start')
    if (this.initialized) {
      throw new Error('_init was already called')
    }
    const latestBlock = await this.contractInteractor.getBlock('latest')
    this.lastScannedBlock = latestBlock.number - 10
    if (this.lastScannedBlock < 0) {
      this.lastScannedBlock = 0
    }
    if (latestBlock.baseFeePerGas != null) {
      this.transactionType = TransactionType.TYPE_TWO
    }
    await this.transactionManager.init(this.transactionType)
    this.transactionManager.on('TransactionBroadcast', () => {
      this.shouldRefreshBalances = true
    })
    await this._initTrustedPaymasters(this.config.trustedPaymasters)
    if (!this.config.skipErc165Check) {
      await this.contractInteractor._validateERC165InterfacesRelay()
    }
    this.relayHubContract = await this.contractInteractor.relayHubInstance

    const relayHubAddress = this.relayHubContract.address
    const code = await this.contractInteractor.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    }

    const transactionHashes = await this.registrationManager.init(this.lastScannedBlock, latestBlock)

    this.chainId = this.contractInteractor.chainId
    this.networkId = this.contractInteractor.getNetworkId()

    this.logger.info(`Current network info:
chainId                 | ${this.chainId}
networkId               | ${this.networkId}
latestBlock             | ${latestBlock.number}
latestBlock timestamp   | ${latestBlock.timestamp}
`)
    this.maxGasLimit = Math.floor(0.75 * parseInt(latestBlock.gasLimit.toString()))
    this.initialized = true

    // Assume started server is not registered until _worker figures stuff out
    this.registrationManager.printNotRegisteredMessage()
    this.logger.debug(`server init finished in ${Date.now() - initStartTimestamp} ms`)
    return transactionHashes
  }

  async _replenishWorker (
    workerReplenishAmount: BN,
    currentBlockNumber: number,
    currentBlockHash: string,
    currentBlockTimestamp: number
  ): Promise<PrefixedHexString> {
    this.logger.debug('Replenishing worker balance by manager eth balance')
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      serverAction: ServerAction.VALUE_TRANSFER,
      destination: this.workerAddress,
      value: toHex(workerReplenishAmount),
      creationBlockNumber: currentBlockNumber,
      creationBlockHash: currentBlockHash,
      creationBlockTimestamp: currentBlockTimestamp
    }
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    return transactionHash
  }

  async _withdrawHubDeposit (
    managerHubBalance: BN,
    currentBlockNumber: number,
    currentBlockHash: string,
    currentBlockTimestamp: number
  ): Promise<PrefixedHexString> {
    this.logger.info(`withdrawing manager hub balance (${managerHubBalance.toString()}) to manager`)
    // Refill manager eth balance from hub balance
    const method = await this.web3MethodsBuilder.getWithdrawMethod(this.managerAddress, managerHubBalance)
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      serverAction: ServerAction.DEPOSIT_WITHDRAWAL,
      destination: this.relayHubContract.address,
      creationBlockNumber: currentBlockNumber,
      creationBlockHash: currentBlockHash,
      creationBlockTimestamp: currentBlockTimestamp,
      method
    }
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    return transactionHash
  }

  async replenishServer (
    workerIndex: number,
    currentBlockNumber: number,
    currentBlockHash: string,
    currentBlockTimestamp: number
  ): Promise<PrefixedHexString[]> {
    const transactionHashes: PrefixedHexString[] = []
    // get balances
    let managerEthBalance = this.registrationManager.balanceRequired.currentValue
    const managerHubBalance = await this.relayHubContract.balanceOf(this.managerAddress)

    const isWithdrawalPending = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.DEPOSIT_WITHDRAWAL, currentBlockNumber, this.config.recentActionAvoidRepeatDistanceBlocks)
    const isReplenishPendingForWorker = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.VALUE_TRANSFER, currentBlockNumber, this.config.recentActionAvoidRepeatDistanceBlocks, this.workerAddress)
    const mustReplenishWorker = !this.workerBalanceRequired.isSatisfied && !isReplenishPendingForWorker
    const mustReplenishManager = toBN(this.config.managerMinBalance).gt(managerEthBalance) && !isWithdrawalPending

    if (!mustReplenishManager && !mustReplenishWorker) {
      // all filled, nothing to do
      return transactionHashes
    }

    const workerReplenishAmount = toBN(this.config.workerTargetBalance.toString()).sub(this.workerBalanceRequired.currentValue)
    const managerReplenishAmount = toBN(this.config.managerTargetBalance.toString()).sub(managerEthBalance)
    const canReplenishManager = managerHubBalance.gte(managerReplenishAmount)
    const cantReplenishWorkerFromBalance = managerEthBalance.sub(toBN(this.config.managerMinBalance)).lt(workerReplenishAmount)
    const canReplenishWorkerFromHubAndBalance = managerHubBalance.add(managerEthBalance).sub(toBN(this.config.managerMinBalance)).gte(workerReplenishAmount)
    const mustWithdrawHubDeposit =
      (mustReplenishManager && canReplenishManager) ||
      (mustReplenishWorker && cantReplenishWorkerFromBalance && canReplenishWorkerFromHubAndBalance)

    if (mustWithdrawHubDeposit) {
      const transactionHash = await this._withdrawHubDeposit(managerHubBalance, currentBlockNumber, currentBlockHash, currentBlockTimestamp)
      transactionHashes.push(transactionHash)
      await this.registrationManager.refreshBalance()
      managerEthBalance = this.registrationManager.balanceRequired.currentValue
    }
    if (mustReplenishWorker) {
      this.logger.debug(
        `== replenishServer: manager eth balance=${managerEthBalance.toString()}  manager hub balance=${managerHubBalance.toString()}
          \n${this.workerBalanceRequired.description}\n refill=${workerReplenishAmount.toString()}`)
      if (workerReplenishAmount.lt(managerEthBalance.sub(toBN(this.config.managerMinBalance)))) {
        const transactionHash = await this._replenishWorker(workerReplenishAmount, currentBlockNumber, currentBlockHash, currentBlockTimestamp)
        transactionHashes.push(transactionHash)
      } else {
        const message = `== replenishServer: can't replenish: balance too low ${managerEthBalance.toString()} refill=${workerReplenishAmount.toString()}`
        this.logger.error(message)
      }
    }
    return transactionHashes
  }

  async intervalHandler (): Promise<void> {
    try {
      const block = await this.contractInteractor.getBlock('latest')
      if (block.number > this.lastScannedBlock) {
        await this._worker(block)
          .then((transactions) => {
            if (transactions.length !== 0) {
              this.logger.debug(`Done handling block #${block.number}. Created ${transactions.length} transactions.`)
            }
          })
      }
    } catch (e) {
      this.emit('error', e)
      const error = e as Error
      // this is the catch that is reached eventually
      this.logger.error(`error in worker: ${error.message}`)
      this.setReadyState(false)
    } finally {
      if (this.running) {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        setTimeout(this.intervalHandler.bind(this), this.config.checkInterval)
      } else {
        this.logger.info('Shutting down worker task')
      }
    }
  }

  async _worker (block: Block): Promise<PrefixedHexString[]> {
    if (!this.initialized) {
      throw new Error('Please run init() first')
    }
    if (block.number <= this.lastScannedBlock) {
      throw new Error('Attempt to scan older block, aborting')
    }
    if (!this._shouldRefreshState(block)) {
      return []
    }
    const currentBlockTimestamp = toNumber(block.timestamp)
    await this.withdrawToOwnerIfNeeded(block.number, block.hash, currentBlockTimestamp)
    this.lastRefreshBlock = block.number
    await this._refreshGasFees()
    const isManagerBalanceReady = await this._refreshAndCheckBalances()
    if (!isManagerBalanceReady) {
      return []
    }
    return await this._handleChanges(block)
  }

  async _refreshAndCheckBalances (): Promise<boolean> {
    const minBalanceToNotReadyFactor = 2
    let isManagerBalanceReady = true
    let isWorkerBalanceReady = true
    if (this.shouldRefreshBalances) {
      await this.registrationManager.refreshBalance()
      this.workerBalanceRequired.currentValue = await this.getWorkerBalance(0)

      isManagerBalanceReady = this.registrationManager.balanceRequired.currentValue.gte(toBN(this.config.managerMinBalance.toString()).divn(minBalanceToNotReadyFactor))
      isWorkerBalanceReady = this.workerBalanceRequired.currentValue.gte(toBN(this.config.workerMinBalance.toString()).divn(minBalanceToNotReadyFactor))

      if (!isManagerBalanceReady || !isWorkerBalanceReady) {
        this.setReadyState(false)
      }
      if (!isWorkerBalanceReady) {
        this.logger.debug('worker balance too low')
      }
      if (!isManagerBalanceReady) {
        this.logger.debug('manager balance too low')
      }
      const shouldReplenishManager = this.registrationManager.balanceRequired.currentValue.lt(toBN(this.config.managerMinBalance.toString()))
      const shouldReplenishWorker = this.workerBalanceRequired.currentValue.lt(toBN(this.config.workerMinBalance.toString()))
      this.shouldRefreshBalances = shouldReplenishManager || shouldReplenishWorker
    }
    return isManagerBalanceReady
  }

  async _refreshGasFees (): Promise<void> {
    const {
      baseFeePerGas,
      priorityFeePerGas
    } = await this.contractInteractor.getGasFees(this.config.getGasFeesBlocks, this.config.getGasFeesPercentile)

    // server will not accept Relay Requests with MaxFeePerGas lower than BaseFeePerGas of a recent block
    this.minMaxFeePerGas = parseInt(baseFeePerGas)

    this.minMaxPriorityFeePerGas = Math.floor(parseInt(priorityFeePerGas) * this.config.gasPriceFactor)
    if (this.minMaxPriorityFeePerGas === 0 && parseInt(this.config.defaultPriorityFee) > 0) {
      this.logger.debug(`Priority fee received from node is 0. Setting priority fee to ${this.config.defaultPriorityFee}`)
      this.minMaxPriorityFeePerGas = parseInt(this.config.defaultPriorityFee)
    }

    if (this.minMaxPriorityFeePerGas > parseInt(this.config.maxMaxFeePerGas)) {
      throw new Error(`network maxPriorityFeePerGas ${this.minMaxPriorityFeePerGas} is higher than config.maxMaxFeePerGas ${this.config.maxMaxFeePerGas}`)
    }

    if (this.minMaxFeePerGas > parseInt(this.config.maxMaxFeePerGas)) {
      throw new Error(`network minMaxFeePerGas ${this.minMaxFeePerGas} is higher than config.maxMaxFeePerGas ${this.config.maxMaxFeePerGas}`)
    }

    const currentNetworkFeePerGas = parseInt(baseFeePerGas) + parseInt(priorityFeePerGas)
    const shareOfMaximum = currentNetworkFeePerGas / parseInt(this.config.maxMaxFeePerGas)
    if (shareOfMaximum > 0.7) {
      this.logger.warn(`WARNING! Current network's reasonable fee per gas ${currentNetworkFeePerGas} is dangerously close to the config.maxMaxFeePerGas ${this.config.maxMaxFeePerGas}`)
    }
  }

  async _handleChanges (currentBlock: Block): Promise<PrefixedHexString[]> {
    const currentBlockTimestamp = toNumber(currentBlock.timestamp)
    let transactionHashes: PrefixedHexString[] = []
    const hubEventsSinceLastScan = await this.getAllHubEventsSinceLastScan()
    const shouldRegisterAgain =
      await this._shouldRegisterAgain(currentBlock.number, currentBlockTimestamp)
    transactionHashes = transactionHashes.concat(
      await this.registrationManager.handlePastEvents(
        hubEventsSinceLastScan, this.lastScannedBlock, currentBlock, currentBlockTimestamp, shouldRegisterAgain))
    await this.transactionManager.fillMinedBlockDetailsForTransactions(currentBlock)
    await this.transactionManager.removeArchivedTransactions(currentBlock)
    const boostingResults = await this._boostStuckPendingTransactions(currentBlock)
    if (boostingResults[0].balanceRequiredDetails != null && !boostingResults[0].balanceRequiredDetails.isSufficient) {
      this.logger.error('Server configuration problem! Relay manager cannot afford boosting transactions and may become stuck soon.')
    }
    const requiredWorkerBalance = boostingResults[1].balanceRequiredDetails?.requiredBalance ?? '0'
    if (boostingResults[1].balanceRequiredDetails != null &&
      !boostingResults[1].balanceRequiredDetails?.isSufficient &&
      toBN(requiredWorkerBalance).gt(toBN(this.config.workerTargetBalance.toString()))) {
      this.logger.error(`Server configuration problem! Even after the worker is replenished (workerTargetBalance=${this.config.workerTargetBalance}) boosting the next transaction will fail (requiredWorkerBalance=${requiredWorkerBalance}).`)
    }
    this.lastScannedBlock = currentBlock.number
    const isRegistered = await this.registrationManager.isRegistered()
    if (!isRegistered) {
      this.logger.debug('Not registered yet')
      this.setReadyState(false)
      return transactionHashes
    }
    await this.handlePastHubEvents(currentBlock, hubEventsSinceLastScan)
    const workerIndex = 0
    transactionHashes = transactionHashes.concat(await this.replenishServer(workerIndex, currentBlock.number, currentBlock.hash, currentBlockTimestamp))
    await this._refreshAndCheckBalances()
    this.setReadyState(true)
    if (this.alerted && this.alertedByTransactionBlockTimestamp + this.config.alertedDelaySeconds < currentBlockTimestamp) {
      this.logger.warn(`Relay exited alerted state. Alerted transaction timestamp: ${this.alertedByTransactionBlockTimestamp}. Current block timestamp: ${currentBlockTimestamp}`)
      this.alerted = false
    }
    return transactionHashes
  }

  async getManagerBalance (): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.managerAddress, 'pending'))
  }

  async getWorkerBalance (workerIndex: number): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.workerAddress, 'pending'))
  }

  async _shouldRegisterAgain (currentBlockNumber: number, currentBlockTimestamp: number): Promise<boolean> {
    const relayRegistrationMaxAge = await this.contractInteractor.getRelayRegistrationMaxAge()
    const relayInfo = await this.contractInteractor.getRelayInfo(this.managerAddress)
      .catch((e: Error) => {
        if (
          e.message.includes('relayManager not found') ||
          e.message.includes('Revert') ||
          e.message.includes('revert') ||
          e.message.includes('VM execution error')
        ) {
          return { lastSeenTimestamp: 0 }
        } else {
          this.logger.error(`getRelayInfo failed ${e.message}`)
          throw e
        }
      })
    const latestRegisterTxBlockTimestamp = toNumber(relayInfo.lastSeenTimestamp)
    const isPendingRegistration = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.REGISTER_SERVER, currentBlockNumber, this.config.recentActionAvoidRepeatDistanceBlocks)
    const registrationExpired =
      (currentBlockTimestamp - latestRegisterTxBlockTimestamp >= relayRegistrationMaxAge.toNumber()) &&
      !isPendingRegistration
    const shouldRegister = registrationExpired
    if (registrationExpired) {
      this.logger.debug(
        `_shouldRegisterAgain registrationExpired=${registrationExpired} currentBlock=${currentBlockNumber} latestTxBlockNumber=${latestRegisterTxBlockTimestamp} relayRegistrationMaxAge=${relayRegistrationMaxAge.toString()}`)
    }
    return shouldRegister
  }

  _shouldRefreshState (currentBlock: Block): boolean {
    return currentBlock.number - this.lastRefreshBlock >= this.config.refreshStateTimeoutBlocks || !this.isReady()
  }

  async handlePastHubEvents (currentBlock: Block, hubEventsSinceLastScan: EventData[]): Promise<void> {
    for (const event of hubEventsSinceLastScan) {
      switch (event.name) {
        case TransactionRejectedByPaymaster:
          this.logger.debug(`handle TransactionRejectedByPaymaster event: ${JSON.stringify(event)}`)
          await this._handleTransactionRejectedByPaymasterEvent(event.args.paymaster, event.blockNumber)
          break
        case TransactionRelayed:
          this.logger.debug(`handle TransactionRelayed event: ${JSON.stringify(event)}`)
          await this._handleTransactionRelayedEvent(event.args.paymaster, event.blockNumber)
          break
      }
    }
  }

  async getAllHubEventsSinceLastScan (): Promise<EventData[]> {
    const topics = [address2topic(this.managerAddress)]
    const options = {
      fromBlock: this.lastScannedBlock + 1,
      toBlock: 'latest'
    }
    const hubEvents = await this.contractInteractor.getPastEventsForHub(topics, options)
    const regEvents = await this.contractInteractor.getPastEventsForRegistrar(topics, options)
    const events = [...hubEvents, ...regEvents]
    if (events.length !== 0) {
      this.logger.debug(`Found ${events.length} events since last scan`)
    }
    return events
  }

  async _handleTransactionRelayedEvent (paymaster: Address, eventBlockNumber: number): Promise<void> {
    if (this.config.runPaymasterReputations) {
      await this.reputationManager.updatePaymasterStatus(paymaster, true, eventBlockNumber)
    }
  }

  // TODO: do not call this method when events are processed already (stateful server thing)
  async _handleTransactionRejectedByPaymasterEvent (paymaster: Address, eventBlockNumber: number): Promise<void> {
    this.alerted = true
    const block = await this.contractInteractor.getBlock(eventBlockNumber)
    const eventBlockTimestamp = toNumber(block.timestamp)
    this.alertedByTransactionBlockTimestamp = eventBlockTimestamp
    const alertedUntil = this.alertedByTransactionBlockTimestamp + this.config.alertedDelaySeconds
    this.logger.error(`Relay entered alerted state. Block number: ${eventBlockNumber} Block timestamp: ${eventBlockTimestamp}.
    Alerted for ${this.config.alertedDelaySeconds} seconds until ${alertedUntil}`)
    if (this.config.runPaymasterReputations) {
      await this.reputationManager.updatePaymasterStatus(paymaster, false, eventBlockNumber)
    }
  }

  async withdrawToOwnerIfNeeded (currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString[]> {
    try {
      let txHashes: PrefixedHexString[] = []
      if (!this.isReady() || this.config.withdrawToOwnerOnBalance == null) {
        return txHashes
      }
      // todo multiply workerTargetBalance by workerCount when adding multiple workers
      const reserveBalance = toBN(this.config.managerTargetBalance).add(toBN(this.config.workerTargetBalance))
      const effectiveWithdrawOnBalance = toBN(this.config.withdrawToOwnerOnBalance).add(reserveBalance)
      const managerHubBalance = await this.relayHubContract.balanceOf(this.managerAddress)
      if (managerHubBalance.lt(effectiveWithdrawOnBalance)) {
        return txHashes
      }
      const withdrawalAmount = managerHubBalance.sub(reserveBalance)
      txHashes = txHashes.concat(await this.registrationManager._sendManagerHubBalanceToOwner(currentBlockNumber, currentBlockHash, currentBlockTimestamp, withdrawalAmount))
      this.logger.info(`Withdrew ${withdrawalAmount.toString()} to owner`)
      return txHashes
    } catch (e) {
      this.logger.error(`withdrawToOwnerIfNeeded: ${(e as Error).message}`)
      return []
    }
  }

  /**
   * Resend all outgoing pending transactions with insufficient gas price by all signers (manager, workers)
   * @return the mapping of the previous transaction hash to details of a new boosted transaction
   */
  async _boostStuckPendingTransactions (currentBlockInfo: ShortBlockInfo): Promise<BoostingResult[]> {
    const managerBoostingResult = await this._boostStuckTransactionsForManager(currentBlockInfo)
    // TODO: get back to this "multiple workers" idea if necessary
    const workerBoostingResult = await this._boostStuckTransactionsForWorker(currentBlockInfo, 0)
    return [managerBoostingResult, workerBoostingResult]
  }

  async _boostStuckTransactionsForManager (currentBlockInfo: ShortBlockInfo): Promise<BoostingResult> {
    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(this.managerAddress, currentBlockInfo, this.minMaxPriorityFeePerGas)
  }

  async _boostStuckTransactionsForWorker (currentBlockInfo: ShortBlockInfo, workerIndex: number): Promise<BoostingResult> {
    const signer = this.workerAddress
    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(signer, currentBlockInfo, this.minMaxPriorityFeePerGas)
  }

  _isTrustedPaymaster (paymaster: string): boolean {
    return this.trustedPaymastersGasAndDataLimits.get(paymaster.toLowerCase()) != null
  }

  _isBlacklistedPaymaster (paymaster: string): boolean {
    return this.config.blacklistedPaymasters.map(it => it.toLowerCase()).includes(paymaster.toLowerCase())
  }

  _isBlacklistedRecipient (recipient: string): boolean {
    return this.config.blacklistedRecipients.map(it => it.toLowerCase()).includes(recipient.toLowerCase())
  }

  _isWhitelistedPaymaster (paymaster: string): boolean {
    return this.config.whitelistedPaymasters.length === 0 ||
      this.config.whitelistedPaymasters.map(it => it.toLowerCase()).includes(paymaster.toLowerCase())
  }

  _isWhitelistedRecipient (recipient: string): boolean {
    return this.config.whitelistedRecipients.length === 0 ||
      this.config.whitelistedRecipients.map(it => it.toLowerCase()).includes(recipient.toLowerCase())
  }

  isReady (): boolean {
    return this.ready
  }

  setReadyState (isReady: boolean): void {
    if (this.isReady() !== isReady) {
      const now = Date.now()
      if (isReady) {
        this.logger.warn(chalk.greenBright('Relayer state: READY'))
        this.readinessInfo.totalNotReadyTime += now - this.readinessInfo.currentStateTimestamp
      } else {
        this.readinessInfo.totalReadyTime += now - this.readinessInfo.currentStateTimestamp
        this.logger.warn(chalk.redBright('Relayer state: NOT-READY'))
      }
      this.readinessInfo.currentStateTimestamp = now
      this.readinessInfo.totalReadinessChanges++
    }
    this.ready = isReady
  }
}
