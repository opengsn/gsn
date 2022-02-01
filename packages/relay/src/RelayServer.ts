import chalk from 'chalk'
import { EventData } from 'web3-eth-contract'
import { EventEmitter } from 'events'
import { toBN, toHex } from 'web3-utils'
import { toBuffer, PrefixedHexString, BN } from 'ethereumjs-util'

import { IRelayHubInstance } from '@opengsn/contracts/types/truffle-contracts'

import { ContractInteractor, RelayCallABI } from '@opengsn/common/dist/ContractInteractor'
import { TransactionRejectedByPaymaster, TransactionRelayed } from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { GasPriceFetcher } from './GasPriceFetcher'
import { Address, IntString } from '@opengsn/common/dist/types/Aliases'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { ReadinessInfo, StatsResponse } from '@opengsn/common/dist/StatsResponse'

import { PingResponse } from '@opengsn/common/dist/PingResponse'
import { VersionsManager } from '@opengsn/common/dist/VersionsManager'
import { AmountRequired } from '@opengsn/common/dist/AmountRequired'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { Environment } from '@opengsn/common/dist/Environments'
import { gsnRequiredVersion, gsnRuntimeVersion } from '@opengsn/common/dist/Version'
import {
  address2topic,
  decodeRevertReason,
  getLatestEventData,
  PaymasterGasAndDataLimits,
  randomInRange,
  sleep
} from '@opengsn/common/dist/Utils'

import { RegistrationManager } from './RegistrationManager'
import { PaymasterStatus, ReputationManager } from './ReputationManager'
import { SendTransactionDetails, SignedTransactionDetails, TransactionManager } from './TransactionManager'
import { ServerAction } from './StoredTransaction'
import { TxStoreManager } from './TxStoreManager'
import { configureServer, ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import { TransactionType } from '@opengsn/common/dist/types/TransactionType'

/**
 * After EIP-150, every time the call stack depth is increased without explicit call gas limit set,
 * the 63/64th rule is applied to gas limit.
 * As we have to pass enough gas to a transaction to pass 'relayRequest.request.gas' to the recipient,
 * and this check is at stack depth of 3, we have to oversupply gas to an outermost ('relayCall') transaction
 * by approximately 1/(63/64)^3 times.
 */
const GAS_FACTOR = 1.1

/**
 * A constant oversupply of gas to each 'relayCall' transaction.
 */
const GAS_RESERVE = 100000

export class RelayServer extends EventEmitter {
  readonly logger: LoggerInterface
  lastScannedBlock: number
  lastRefreshBlock = 0
  ready = false
  readonly managerAddress: PrefixedHexString
  readonly workerAddress: PrefixedHexString
  minMaxPriorityFeePerGas: number = 0
  running = false
  alerted = false
  alertedBlock: number = 0
  initialized: boolean = false
  readonly contractInteractor: ContractInteractor
  readonly gasPriceFetcher: GasPriceFetcher
  private readonly versionManager: VersionsManager
  config: ServerConfigParams
  transactionManager: TransactionManager
  txStoreManager: TxStoreManager
  readinessInfo: ReadinessInfo
  maxGasLimit: number = 0
  transactionType = TransactionType.LEGACY

  lastMinedActiveTransaction?: EventData

  reputationManager!: ReputationManager
  registrationManager!: RegistrationManager
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
    this.lastScannedBlock = config.coldRestartLogsFromBlock ?? 0
    this.versionManager = new VersionsManager(gsnRuntimeVersion, gsnRequiredVersion)
    this.config = configureServer(config)
    this.contractInteractor = dependencies.contractInteractor
    this.environment = this.contractInteractor.environment
    this.gasPriceFetcher = dependencies.gasPriceFetcher
    this.txStoreManager = dependencies.txStoreManager
    this.transactionManager = transactionManager
    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.workerAddress = this.transactionManager.workersKeyManager.getAddress(0)
    this.workerBalanceRequired = new AmountRequired('Worker Balance', toBN(this.config.workerMinBalance), this.logger)
    if (this.config.runPaymasterReputations) {
      if (dependencies.reputationManager == null) {
        throw new Error('ReputationManager is not initialized')
      }
      this.reputationManager = dependencies.reputationManager
    }
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
      throw new Error(`Network ${this.contractInteractor.getNetworkType()} doesn't support eip1559`)
    }
  }

  validateInput (req: RelayTransactionRequest, currentBlockNumber: number): void {
    // Check that the relayHub is the correct one
    if (req.metadata.relayHubAddress !== this.relayHubContract.address) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract.address}, request's hub address: ${req.metadata.relayHubAddress}\n`)
    }

    // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
    if (req.relayRequest.relayData.relayWorker.toLowerCase() !== this.workerAddress.toLowerCase()) {
      throw new Error(
        `Wrong worker address: ${req.relayRequest.relayData.relayWorker}\n`)
    }

    this.validateGasFees(req)

    if (this._isBlacklistedPaymaster(req.relayRequest.relayData.paymaster)) {
      throw new Error(`Paymaster ${req.relayRequest.relayData.paymaster} is blacklisted!`)
    }

    // validate the validUntil is not too close
    const secondsNow = Math.round(Date.now() / 1000)
    const expiredInSeconds = parseInt(req.relayRequest.request.validUntilTime) - secondsNow
    if (expiredInSeconds < this.config.requestMinValidSeconds) {
      const expirationDate = new Date(parseInt(req.relayRequest.request.validUntilTime) * 1000)
      throw new Error(
        `Request expired (or too close): expired at (${expirationDate.toUTCString()}), we expect it to be valid until ${new Date(secondsNow + this.config.requestMinValidSeconds).toUTCString()} `)
    }
  }

  validateGasFees (req: RelayTransactionRequest): void {
    const requestPriorityFee = parseInt(req.relayRequest.relayData.maxPriorityFeePerGas)
    const requestMaxFee = parseInt(req.relayRequest.relayData.maxFeePerGas)
    if (this.minMaxPriorityFeePerGas > requestPriorityFee) {
      throw new Error(
        `priorityFee given ${requestPriorityFee} too low : ${this.minMaxPriorityFeePerGas}`)
    }
    if (parseInt(this.config.maxGasPrice) < requestMaxFee) {
      throw new Error(
        `maxFee given ${requestMaxFee} too high : ${this.config.maxGasPrice}`)
    }
    if (requestMaxFee < requestPriorityFee) {
      throw new Error(
        `maxFee ${requestMaxFee} cannot be lower than priorityFee ${requestPriorityFee}`)
    }
  }

  validateRelayFees (req: RelayTransactionRequest): void {
    // if trusted paymaster, we trust it to handle fees
    if (this._isTrustedPaymaster(req.relayRequest.relayData.paymaster)) {
      return
    }
    // Check that the fee is acceptable
    if (parseInt(req.relayRequest.relayData.pctRelayFee) < this.config.pctRelayFee) {
      throw new Error(
        `Unacceptable pctRelayFee: ${req.relayRequest.relayData.pctRelayFee} relayServer's pctRelayFee: ${this.config.pctRelayFee}`)
    }
    if (toBN(req.relayRequest.relayData.baseRelayFee).lt(toBN(this.config.baseRelayFee))) {
      throw new Error(
        `Unacceptable baseRelayFee: ${req.relayRequest.relayData.baseRelayFee} relayServer's baseRelayFee: ${this.config.baseRelayFee}`)
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

  async validatePaymasterGasAndDataLimits (req: RelayTransactionRequest): Promise<{
    maxPossibleGas: number
    acceptanceBudget: number
  }> {
    const paymaster = req.relayRequest.relayData.paymaster
    let gasAndDataLimits = this.trustedPaymastersGasAndDataLimits.get(paymaster)
    let acceptanceBudget: number
    acceptanceBudget = this.config.maxAcceptanceBudget

    const relayCallAbiInput: RelayCallABI = {
      maxAcceptanceBudget: acceptanceBudget.toString(),
      relayRequest: req.relayRequest,
      signature: req.metadata.signature,
      approvalData: req.metadata.approvalData
    }
    const msgData = this.contractInteractor.encodeABI(relayCallAbiInput)
    const relayTransactionCalldataGasUsedCalculation = this.contractInteractor.calculateCalldataCost(msgData)
    const message =
      `Client signed transactionCalldataGasUsed: ${req.relayRequest.relayData.transactionCalldataGasUsed}` +
      `Server estimate of its transactionCalldata gas expenses: ${relayTransactionCalldataGasUsedCalculation}`
    this.logger.info(message)
    if (toBN(relayTransactionCalldataGasUsedCalculation).gt(toBN(req.relayRequest.relayData.transactionCalldataGasUsed))) {
      throw new Error(`Refusing to relay a transaction due to calldata cost. ${message}`)
    }
    const msgDataLength = toBuffer(msgData).length
    // estimated cost of transferring the TX between GSN functions (innerRelayCall, preRelayedCall, forwarder, etc)
    // const msgDataGasCostInsideTransaction = (await this.relayHubContract.calldataGasCost(msgDataLength)).toNumber()
    if (gasAndDataLimits == null) {
      try {
        const paymasterContract = await this.contractInteractor._createPaymaster(paymaster)
        gasAndDataLimits = await paymasterContract.getGasAndDataLimits()
      } catch (e) {
        const error = e as Error
        let message = `unknown paymaster error: ${error.message}`
        if (error.message.includes('Returned values aren\'t valid, did it run Out of Gas?')) {
          message = `not a valid paymaster contract: ${paymaster}`
        } else if (error.message.includes('no code at address')) {
          message = `'non-existent paymaster contract: ${paymaster}`
        }
        throw new Error(message)
      }
      const msgDataGasCostInsideTransaction = msgDataLength * this.environment.dataOnChainHandlingGasCostPerByte
      const paymasterAcceptanceBudget = parseInt(gasAndDataLimits.acceptanceBudget.toString())
      if (paymasterAcceptanceBudget + msgDataGasCostInsideTransaction > acceptanceBudget) {
        if (!this._isTrustedPaymaster(paymaster)) {
          throw new Error(
            `paymaster acceptance budget + msg.data gas cost too high. given: ${paymasterAcceptanceBudget + msgDataGasCostInsideTransaction} max allowed: ${this.config.maxAcceptanceBudget}`)
        }
        this.logger.debug(`Using trusted paymaster's higher than max acceptance budget: ${paymasterAcceptanceBudget}`)
        acceptanceBudget = paymasterAcceptanceBudget
      }
    } else {
      // its a trusted paymaster. just use its acceptance budget as-is
      acceptanceBudget = parseInt(gasAndDataLimits.acceptanceBudget.toString())
    }

    // TODO: this is not a good way to calculate gas limit for relay call
    const tmpMaxPossibleGas = this.contractInteractor.calculateTransactionMaxPossibleGas({
      msgData,
      gasAndDataLimits,
      relayCallGasLimit: req.relayRequest.request.gas
    })

    const maxPossibleGas = GAS_RESERVE + Math.floor(tmpMaxPossibleGas * GAS_FACTOR)
    if (maxPossibleGas > this.maxGasLimit) {
      throw new Error(`maxPossibleGas (${maxPossibleGas}) exceeds maxGasLimit (${this.maxGasLimit})`)
    }
    const maxCharge =
      await this.relayHubContract.calculateCharge(maxPossibleGas, req.relayRequest.relayData,
        { gasPrice: req.relayRequest.relayData.maxFeePerGas })
    const paymasterBalance = await this.relayHubContract.balanceOf(paymaster)

    if (paymasterBalance.lt(maxCharge)) {
      throw new Error(`paymaster balance too low: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    }
    this.logger.debug(`paymaster balance: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    this.logger.debug(`Estimated max charge of relayed tx: ${maxCharge.toString()}, GasLimit of relayed tx: ${maxPossibleGas}`)

    return {
      acceptanceBudget,
      maxPossibleGas
    }
  }

  async validateViewCallSucceeds (req: RelayTransactionRequest, maxAcceptanceBudget: number, maxPossibleGas: number): Promise<void> {
    this.logger.debug(`validateViewCallSucceeds: ${JSON.stringify(arguments)}`)
    const method = this.relayHubContract.contract.methods.relayCall(
      maxAcceptanceBudget, req.relayRequest, req.metadata.signature, req.metadata.approvalData)
    let viewRelayCallRet: { paymasterAccepted: boolean, returnValue: string }
    try {
      if (this.transactionType === TransactionType.TYPE_TWO) {
        viewRelayCallRet =
          await method.call({
            from: this.workerAddress,
            maxFeePerGas: req.relayRequest.relayData.maxFeePerGas,
            maxPriorityFeePerGas: req.relayRequest.relayData.maxPriorityFeePerGas,
            gasLimit: maxPossibleGas
          }, 'pending')
      } else {
        viewRelayCallRet =
          await method.call({
            from: this.workerAddress,
            gasPrice: req.relayRequest.relayData.maxFeePerGas,
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

  async createRelayTransaction (req: RelayTransactionRequest): Promise<PrefixedHexString> {
    this.logger.debug(`dump request params: ${JSON.stringify(req)}`)
    if (!this.isReady()) {
      throw new Error('relay not ready')
    }
    this.validateRequestTxType(req)
    if (this.alerted) {
      this.logger.error('Alerted state: slowing down traffic')
      await sleep(randomInRange(this.config.minAlertedDelayMS, this.config.maxAlertedDelayMS))
    }
    const currentBlock = await this.contractInteractor.getBlockNumber()
    this.validateInput(req, currentBlock)
    this.validateRelayFees(req)
    await this.validateMaxNonce(req.metadata.relayMaxNonce)
    if (this.config.runPaymasterReputations) {
      await this.validatePaymasterReputation(req.relayRequest.relayData.paymaster, this.lastScannedBlock)
    }
    // Call relayCall as a view function to see if we'll get paid for relaying this tx
    const {
      acceptanceBudget,
      maxPossibleGas
    } = await this.validatePaymasterGasAndDataLimits(req)

    await this.validateViewCallSucceeds(req, acceptanceBudget, maxPossibleGas)
    if (this.config.runPaymasterReputations) {
      await this.reputationManager.onRelayRequestAccepted(req.relayRequest.relayData.paymaster)
    }
    // Send relayed transaction
    this.logger.debug(`maxPossibleGas is: ${maxPossibleGas}`)

    const method = this.relayHubContract.contract.methods.relayCall(
      acceptanceBudget, req.relayRequest, req.metadata.signature, req.metadata.approvalData)
    const details: SendTransactionDetails =
      {
        signer: this.workerAddress,
        serverAction: ServerAction.RELAY_CALL,
        method,
        destination: req.metadata.relayHubAddress,
        gasLimit: maxPossibleGas,
        creationBlockNumber: currentBlock,
        maxFeePerGas: req.relayRequest.relayData.maxFeePerGas,
        maxPriorityFeePerGas: req.relayRequest.relayData.maxPriorityFeePerGas
      }
    const { signedTx } = await this.transactionManager.sendTransaction(details)
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(0, currentBlock)
    return signedTx
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

  async init (): Promise<void> {
    const initStartTimestamp = Date.now()
    this.logger.debug('server init start')
    if (this.initialized) {
      throw new Error('_init was already called')
    }
    const latestBlock = await this.contractInteractor.getBlock('latest')
    if (latestBlock.number < this.config.coldRestartLogsFromBlock) {
      throw new Error(
        `Cannot start relay worker with coldRestartLogsFromBlock=${this.config.coldRestartLogsFromBlock} when "latest" block returned is ${latestBlock.number}`)
    }
    if (latestBlock.baseFeePerGas != null) {
      this.transactionType = TransactionType.TYPE_TWO
    }
    await this.transactionManager._init(this.transactionType)
    await this._initTrustedPaymasters(this.config.trustedPaymasters)
    this.relayHubContract = await this.contractInteractor.relayHubInstance

    const relayHubAddress = this.relayHubContract.address
    const code = await this.contractInteractor.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    }

    this.registrationManager = new RegistrationManager(
      this.contractInteractor,
      this.transactionManager,
      this.txStoreManager,
      this,
      this.logger,
      this.config,
      this.managerAddress,
      this.workerAddress
    )
    await this.registrationManager.init()

    this.chainId = this.contractInteractor.chainId
    this.networkId = this.contractInteractor.getNetworkId()
    if (this.config.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      this.logger.error('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }

    this.logger.info(`Current network info:
chainId                 | ${this.chainId}
networkId               | ${this.networkId}
latestBlock             | ${latestBlock.number}
latestBlock timestamp   | ${latestBlock.timestamp}
`)
    this.maxGasLimit = Math.floor(0.75 * latestBlock.gasLimit)
    this.initialized = true

    // Assume started server is not registered until _worker figures stuff out
    this.registrationManager.printNotRegisteredMessage()
    this.logger.debug(`server init finished in ${Date.now() - initStartTimestamp} ms`)
  }

  async replenishServer (workerIndex: number, currentBlock: number): Promise<PrefixedHexString[]> {
    const transactionHashes: PrefixedHexString[] = []
    let managerEthBalance = await this.getManagerBalance()
    const managerHubBalance = await this.relayHubContract.balanceOf(this.managerAddress)
    this.workerBalanceRequired.currentValue = await this.getWorkerBalance(workerIndex)
    if (managerEthBalance.gte(toBN(this.config.managerTargetBalance.toString())) && this.workerBalanceRequired.isSatisfied) {
      // all filled, nothing to do
      return transactionHashes
    }
    const mustWithdrawHubDeposit = managerEthBalance.lt(toBN(this.config.managerTargetBalance.toString())) && managerHubBalance.gte(
      toBN(this.config.minHubWithdrawalBalance))
    const isWithdrawalPending = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.DEPOSIT_WITHDRAWAL, currentBlock, this.config.recentActionAvoidRepeatDistanceBlocks)
    if (mustWithdrawHubDeposit && !isWithdrawalPending) {
      this.logger.info(`withdrawing manager hub balance (${managerHubBalance.toString()}) to manager`)
      // Refill manager eth balance from hub balance
      const method = this.relayHubContract?.contract.methods.withdraw(toHex(managerHubBalance), this.managerAddress)
      const gasLimit = await this.transactionManager.attemptEstimateGas('Withdraw', method, this.managerAddress)
      const details: SendTransactionDetails = {
        signer: this.managerAddress,
        serverAction: ServerAction.DEPOSIT_WITHDRAWAL,
        destination: this.relayHubContract.address,
        creationBlockNumber: currentBlock,
        gasLimit,
        method
      }
      const { transactionHash } = await this.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    }
    managerEthBalance = await this.getManagerBalance()
    const mustReplenishWorker = !this.workerBalanceRequired.isSatisfied
    const isReplenishPendingForWorker = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.VALUE_TRANSFER, currentBlock, this.config.recentActionAvoidRepeatDistanceBlocks, this.workerAddress)
    if (mustReplenishWorker && !isReplenishPendingForWorker) {
      const refill = toBN(this.config.workerTargetBalance.toString()).sub(this.workerBalanceRequired.currentValue)
      this.logger.debug(
        `== replenishServer: mgr balance=${managerEthBalance.toString()}  manager hub balance=${managerHubBalance.toString()}
          \n${this.workerBalanceRequired.description}\n refill=${refill.toString()}`)
      if (refill.lt(managerEthBalance.sub(toBN(this.config.managerMinBalance)))) {
        this.logger.debug('Replenishing worker balance by manager eth balance')
        const details: SendTransactionDetails = {
          signer: this.managerAddress,
          serverAction: ServerAction.VALUE_TRANSFER,
          destination: this.workerAddress,
          value: toHex(refill),
          creationBlockNumber: currentBlock
        }
        const { transactionHash } = await this.transactionManager.sendTransaction(details)
        transactionHashes.push(transactionHash)
      } else {
        const message = `== replenishServer: can't replenish: mgr balance too low ${managerEthBalance.toString()} refill=${refill.toString()}`
        this.emit('fundingNeeded', message)
        this.logger.error(message)
      }
    }
    return transactionHashes
  }

  async intervalHandler (): Promise<void> {
    try {
      const blockNumber = await this.contractInteractor.getBlockNumber()
      if (blockNumber > this.lastScannedBlock) {
        await this._worker(blockNumber)
          .then((transactions) => {
            if (transactions.length !== 0) {
              this.logger.debug(`Done handling block #${blockNumber}. Created ${transactions.length} transactions.`)
            }
          })
      }
    } catch (e) {
      this.emit('error', e)
      const error = e as Error
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

  async _worker (blockNumber: number): Promise<PrefixedHexString[]> {
    if (!this.initialized || this.registrationManager.balanceRequired == null) {
      throw new Error('Please run init() first')
    }
    if (blockNumber <= this.lastScannedBlock) {
      throw new Error('Attempt to scan older block, aborting')
    }
    await this.withdrawToOwnerIfNeeded(blockNumber)
    if (!this._shouldRefreshState(blockNumber)) {
      return []
    }
    this.lastRefreshBlock = blockNumber
    await this._refreshPriorityFee()
    await this.registrationManager.refreshBalance()
    if (!this.registrationManager.balanceRequired.isSatisfied) {
      this.setReadyState(false)
      return []
    }
    return await this._handleChanges(blockNumber)
  }

  async _refreshPriorityFee (): Promise<void> {
    const minMaxPriorityFeePerGas = parseInt(await this.contractInteractor.getMaxPriorityFee())
    this.minMaxPriorityFeePerGas = Math.floor(minMaxPriorityFeePerGas * this.config.gasPriceFactor)
    if (this.minMaxPriorityFeePerGas === 0) {
      this.logger.debug(`Priority fee received from node is 0. Setting priority fee to ${this.config.defaultPriorityFee}`)
      this.minMaxPriorityFeePerGas = parseInt(this.config.defaultPriorityFee)
    }
    if (this.minMaxPriorityFeePerGas > parseInt(this.config.maxGasPrice)) {
      throw new Error(`network maxPriorityFeePerGas ${this.minMaxPriorityFeePerGas} is higher than config.maxGasPrice ${this.config.maxGasPrice}`)
    }
  }

  async _handleChanges (currentBlockNumber: number): Promise<PrefixedHexString[]> {
    let transactionHashes: PrefixedHexString[] = []
    const hubEventsSinceLastScan = await this.getAllHubEventsSinceLastScan()
    await this._updateLatestTxBlockNumber(hubEventsSinceLastScan)
    await this.registrationManager.updateLatestRegistrationTxs(hubEventsSinceLastScan)
    const shouldRegisterAgain = await this._shouldRegisterAgain(currentBlockNumber, hubEventsSinceLastScan)
    transactionHashes = transactionHashes.concat(
      await this.registrationManager.handlePastEvents(hubEventsSinceLastScan, this.lastScannedBlock, currentBlockNumber,
        shouldRegisterAgain))
    await this.transactionManager.removeConfirmedTransactions(currentBlockNumber)
    await this._boostStuckPendingTransactions(currentBlockNumber)
    this.lastScannedBlock = currentBlockNumber
    const isRegistered = await this.registrationManager.isRegistered()
    if (!isRegistered) {
      this.logger.debug('Not registered yet')
      this.setReadyState(false)
      return transactionHashes
    }
    await this.handlePastHubEvents(currentBlockNumber, hubEventsSinceLastScan)
    const workerIndex = 0
    transactionHashes = transactionHashes.concat(await this.replenishServer(workerIndex, currentBlockNumber))
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (workerBalance.lt(toBN(this.config.workerMinBalance))) {
      this.logger.debug('Worker balance too low')
      this.setReadyState(false)
      return transactionHashes
    }
    this.setReadyState(true)
    if (this.alerted && this.alertedBlock + this.config.alertedBlockDelay < currentBlockNumber) {
      this.logger.warn(`Relay exited alerted state. Alerted block: ${this.alertedBlock}. Current block number: ${currentBlockNumber}`)
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

  async _shouldRegisterAgain (currentBlock: number, hubEventsSinceLastScan: EventData[]): Promise<boolean> {
    if (this.config.registrationBlockRate === 0 && this.config.activityBlockRate === 0) {
      // this.logger.debug(`_shouldRegisterAgain returns false isPendingActivityTransaction=${isPendingActivityTransaction} registrationBlockRate=${this.config.registrationBlockRate}`)
      return false
    }
    const latestTxBlockNumber = this._getLatestTxBlockNumber()
    const latestRegisterTxBlockNumber = this._getLatestRegisterTxBlockNumber()
    const isPendingRegistration = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.REGISTER_SERVER, currentBlock, this.config.recentActionAvoidRepeatDistanceBlocks)
    const isPendingActivity = isPendingRegistration || await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.RELAY_CALL, currentBlock, this.config.recentActionAvoidRepeatDistanceBlocks)
    const registrationExpired =
      this.config.registrationBlockRate !== 0 &&
      (currentBlock - latestRegisterTxBlockNumber >= this.config.registrationBlockRate) &&
      !isPendingRegistration
    const activityExpired =
      this.config.activityBlockRate !== 0 &&
      (currentBlock - latestTxBlockNumber >= this.config.activityBlockRate) &&
      !isPendingActivity
    const shouldRegister = registrationExpired || activityExpired
    if (!registrationExpired) {
      this.logger.debug(
        `_shouldRegisterAgain registrationExpired=${registrationExpired} currentBlock=${currentBlock} latestTxBlockNumber=${latestRegisterTxBlockNumber} registrationBlockRate=${this.config.registrationBlockRate}`)
    }
    if (!activityExpired) {
      this.logger.debug(
        `_shouldRegisterAgain activityExpired=${activityExpired} currentBlock=${currentBlock} latestTxBlockNumber=${latestTxBlockNumber} activityBlockRate=${this.config.activityBlockRate}`)
    }
    return shouldRegister
  }

  _shouldRefreshState (currentBlock: number): boolean {
    return currentBlock - this.lastRefreshBlock >= this.config.refreshStateTimeoutBlocks || !this.isReady()
  }

  async handlePastHubEvents (currentBlockNumber: number, hubEventsSinceLastScan: EventData[]): Promise<void> {
    for (const event of hubEventsSinceLastScan) {
      switch (event.event) {
        case TransactionRejectedByPaymaster:
          this.logger.debug(`handle TransactionRejectedByPaymaster event: ${JSON.stringify(event)}`)
          await this._handleTransactionRejectedByPaymasterEvent(event.returnValues.paymaster, currentBlockNumber, event.blockNumber)
          break
        case TransactionRelayed:
          this.logger.debug(`handle TransactionRelayed event: ${JSON.stringify(event)}`)
          await this._handleTransactionRelayedEvent(event.returnValues.paymaster, event.blockNumber)
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
  async _handleTransactionRejectedByPaymasterEvent (paymaster: Address, currentBlockNumber: number, eventBlockNumber: number): Promise<void> {
    this.alerted = true
    this.alertedBlock = eventBlockNumber
    this.logger.error(`Relay entered alerted state. Block number: ${currentBlockNumber}`)
    if (this.config.runPaymasterReputations) {
      await this.reputationManager.updatePaymasterStatus(paymaster, false, eventBlockNumber)
    }
  }

  _getLatestTxBlockNumber (): number {
    return this.lastMinedActiveTransaction?.blockNumber ?? -1
  }

  _getLatestRegisterTxBlockNumber (): number {
    return this.registrationManager.lastMinedRegisterTransaction?.blockNumber ?? -1
  }

  async _updateLatestTxBlockNumber (eventsSinceLastScan: EventData[]): Promise<void> {
    const latestTransactionSinceLastScan = getLatestEventData(eventsSinceLastScan)
    if (latestTransactionSinceLastScan != null) {
      this.lastMinedActiveTransaction = latestTransactionSinceLastScan
      this.logger.debug(`found newer block ${this.lastMinedActiveTransaction?.blockNumber}`)
    }
    if (this.lastMinedActiveTransaction == null) {
      this.lastMinedActiveTransaction = await this._queryLatestActiveEvent()
      this.logger.debug(`queried node for last active server event, found in block ${this.lastMinedActiveTransaction?.blockNumber}`)
    }
  }

  async _queryLatestActiveEvent (): Promise<EventData | undefined> {
    const events: EventData[] = await this.contractInteractor.getPastEventsForHub([address2topic(this.managerAddress)], {
      fromBlock: this.config.coldRestartLogsFromBlock
    })
    return getLatestEventData(events)
  }

  async withdrawToOwnerIfNeeded (blockNumber: number): Promise<PrefixedHexString[]> {
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
      txHashes = txHashes.concat(await this.registrationManager._sendManagerHubBalanceToOwner(blockNumber, withdrawalAmount))
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
  async _boostStuckPendingTransactions (blockNumber: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
    const transactionDetails = new Map<PrefixedHexString, SignedTransactionDetails>()
    // repeat separately for each signer (manager, all workers)
    const managerBoostedTransactions = await this._boostStuckTransactionsForManager(blockNumber)
    for (const [txHash, boostedTxDetails] of managerBoostedTransactions) {
      transactionDetails.set(txHash, boostedTxDetails)
    }
    for (const workerIndex of [0]) {
      const workerBoostedTransactions = await this._boostStuckTransactionsForWorker(blockNumber, workerIndex)
      for (const [txHash, boostedTxDetails] of workerBoostedTransactions) {
        transactionDetails.set(txHash, boostedTxDetails)
      }
    }
    return transactionDetails
  }

  async _boostStuckTransactionsForManager (blockNumber: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(this.managerAddress, blockNumber, this.minMaxPriorityFeePerGas)
  }

  async _boostStuckTransactionsForWorker (blockNumber: number, workerIndex: number): Promise<Map<PrefixedHexString, SignedTransactionDetails>> {
    const signer = this.workerAddress
    return await this.transactionManager.boostUnderpricedPendingTransactionsForSigner(signer, blockNumber, this.minMaxPriorityFeePerGas)
  }

  _isTrustedPaymaster (paymaster: string): boolean {
    return this.trustedPaymastersGasAndDataLimits.get(paymaster.toLowerCase()) != null
  }

  _isBlacklistedPaymaster (paymaster: string): boolean {
    return this.config.blacklistedPaymasters.map(it => it.toLowerCase()).includes(paymaster.toLowerCase())
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
