import log from 'loglevel'
import ow from 'ow'
import { EventData } from 'web3-eth-contract'
import { EventEmitter } from 'events'
import { PrefixedHexString } from 'ethereumjs-tx'
import { TransactionReceipt } from 'web3-core'
import { toBN, toHex } from 'web3-utils'

import ContractInteractor, { TransactionRejectedByPaymaster } from '../relayclient/ContractInteractor'
import PingResponse from '../common/PingResponse'
import { RelayTransactionRequest, RelayTransactionRequestShape } from '../relayclient/types/RelayTransactionRequest'
import { IRelayHubInstance } from '../../types/truffle-contracts'
import VersionsManager from '../common/VersionsManager'
import {
  address2topic,
  calculateTransactionMaxPossibleGas,
  decodeRevertReason, PaymasterGasLimits,
  randomInRange,
  reduceToLatestTx,
  sleep
} from '../common/Utils'
import { defaultEnvironment } from '../common/Environments'
import { RegistrationManager, StateError } from './RegistrationManager'
import { SendTransactionDetails, TransactionManager } from './TransactionManager'
import { configureServer, ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import Timeout = NodeJS.Timeout

const VERSION = '2.0.0-beta.2'
const GAS_RESERVE = 100000

export class RelayServer extends EventEmitter {
  lastScannedBlock = 0
  lastRefreshBlock = 0
  ready = false
  readonly managerAddress: PrefixedHexString
  readonly workerAddress: PrefixedHexString
  gasPrice: number = 0
  _workerSemaphoreOn = false
  alerted = false
  alertedBlock: number = 0
  private initialized = false
  readonly contractInteractor: ContractInteractor
  private readonly versionManager: VersionsManager
  lastError?: string
  private workerTask?: Timeout
  config: ServerConfigParams
  transactionManager: TransactionManager

  lastMinedActiveTransaction?: EventData

  registrationManager!: RegistrationManager
  chainId!: number
  networkId!: number
  relayHubContract!: IRelayHubInstance

  constructor (config: Partial<ServerConfigParams>, dependencies: ServerDependencies) {
    super()
    this.versionManager = new VersionsManager(VERSION)
    this.config = configureServer(config)
    this.contractInteractor = dependencies.contractInteractor
    this.transactionManager = new TransactionManager(dependencies, this.config)
    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.workerAddress = this.transactionManager.workersKeyManager.getAddress(0)
    log.setLevel(this.config.logLevel)
    log.debug('config:', JSON.stringify(this.config))
  }

  getMinGasPrice (): number {
    return this.gasPrice
  }

  pingHandler (): PingResponse {
    return {
      RelayServerAddress: this.workerAddress,
      RelayManagerAddress: this.managerAddress,
      RelayHubAddress: this.relayHubContract?.address ?? '',
      MinGasPrice: this.getMinGasPrice().toString(),
      MaxAcceptanceBudget: this.config.maxAcceptanceBudget.toString(),
      Ready: this.ready,
      Version: VERSION
    }
  }

  validateInputTypes (req: RelayTransactionRequest): void {
    ow(req, ow.object.exactShape(RelayTransactionRequestShape))
  }

  validateInput (req: RelayTransactionRequest): void {
    // Check that the relayHub is the correct one
    if (req.metadata.relayHubAddress !== this.relayHubContract?.address) {
      throw new Error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract?.address}, request's hub address: ${req.metadata.relayHubAddress}\n`)
    }

    // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
    if (req.relayRequest.relayData.relayWorker.toLowerCase() !== this.workerAddress.toLowerCase()) {
      throw new Error(
        `Wrong worker address: ${req.relayRequest.relayData.relayWorker}\n`)
    }

    // Check that the gasPrice is initialized & acceptable
    if (this.gasPrice > parseInt(req.relayRequest.relayData.gasPrice)) {
      throw new Error(
        `Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice} request's gasPrice: ${req.relayRequest.relayData.gasPrice}`)
    }
  }

  validateFees (req: RelayTransactionRequest): void {
    // if trusted paymaster, we trust it to handle fees
    if (this._isTrustedPaymaster(req.relayRequest.relayData.paymaster)) {
      return
    }
    // Check that the fee is acceptable
    if (isNaN(parseInt(req.relayRequest.relayData.pctRelayFee)) || parseInt(req.relayRequest.relayData.pctRelayFee) < this.config.pctRelayFee) {
      throw new Error(`Unacceptable pctRelayFee: ${req.relayRequest.relayData.pctRelayFee} relayServer's pctRelayFee: ${this.config.pctRelayFee}`)
    }
    if (isNaN(parseInt(req.relayRequest.relayData.baseRelayFee)) || toBN(req.relayRequest.relayData.baseRelayFee).lt(toBN(this.config.baseRelayFee))) {
      throw new Error(`Unacceptable baseRelayFee: ${req.relayRequest.relayData.baseRelayFee} relayServer's baseRelayFee: ${this.config.baseRelayFee}`)
    }
  }

  async validateMaxNonce (relayMaxNonce: number): Promise<void> {
    // Check that max nonce is valid
    const nonce = await this.transactionManager.pollNonce(this.workerAddress)
    if (nonce > relayMaxNonce) {
      throw new Error(`Unacceptable relayMaxNonce: ${relayMaxNonce}. current nonce: ${nonce}`)
    }
  }

  async validatePaymasterGasLimits (req: RelayTransactionRequest): Promise<{
    maxPossibleGas: number
    acceptanceBudget: number
  }> {
    let gasLimits: PaymasterGasLimits
    try {
      const paymasterContract = await this.contractInteractor._createPaymaster(req.relayRequest.relayData.paymaster)
      gasLimits = await paymasterContract.getGasLimits()
    } catch (e) {
      const error = e as Error
      let message = `unknown paymaster error: ${error.message}`
      if (error.message.includes('Returned values aren\'t valid, did it run Out of Gas?')) {
        message = `incompatible paymaster contract: ${req.relayRequest.relayData.paymaster}`
      } else if (error.message.includes('no code at address')) {
        message = `'non-existent paymaster contract: ${req.relayRequest.relayData.paymaster}`
      }
      throw new Error(message)
    }
    let acceptanceBudget = this.config.maxAcceptanceBudget
    const paymasterAcceptanceBudget = parseInt(gasLimits.acceptanceBudget)
    if (paymasterAcceptanceBudget > acceptanceBudget) {
      if (!this._isTrustedPaymaster(req.relayRequest.relayData.paymaster)) {
        throw new Error(
          `paymaster acceptance budget too high. given: ${paymasterAcceptanceBudget} max allowed: ${this.config.maxAcceptanceBudget}`)
      }
      log.debug(`Using trusted paymaster's higher than max acceptance budget: ${paymasterAcceptanceBudget}`)
      acceptanceBudget = paymasterAcceptanceBudget
    }

    const hubOverhead = (await this.relayHubContract.gasOverhead()).toNumber()
    const maxPossibleGas = GAS_RESERVE + calculateTransactionMaxPossibleGas({
      gasLimits,
      hubOverhead,
      relayCallGasLimit: req.relayRequest.request.gas
    })
    const maxCharge =
      await this.relayHubContract.calculateCharge(maxPossibleGas, req.relayRequest.relayData)
    const paymasterBalance = await this.relayHubContract.balanceOf(req.relayRequest.relayData.paymaster)

    if (paymasterBalance.lt(maxCharge)) {
      throw new Error(`paymaster balance too low: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    }
    console.log(`paymaster balance: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    console.log(`Estimated max charge of relayed tx: ${maxCharge.toString()}, GasLimit of relayed tx: ${maxPossibleGas}`)

    return {
      acceptanceBudget,
      maxPossibleGas
    }
  }

  async validateViewCallSucceeds (req: RelayTransactionRequest, acceptanceBudget: number, maxPossibleGas: number): Promise<void> {
    const method = this.relayHubContract.contract.methods.relayCall(
      acceptanceBudget, req.relayRequest, req.metadata.signature, req.metadata.approvalData, maxPossibleGas)
    let viewRelayCallRet: { paymasterAccepted: boolean, returnValue: string }
    try {
      viewRelayCallRet =
        await method.call({
          from: this.workerAddress,
          gasPrice: req.relayRequest.relayData.gasPrice,
          gasLimit: maxPossibleGas
        })
    } catch (e) {
      throw new Error(`relayCall reverted in server: ${(e as Error).message}`)
    }
    log.debug('viewRelayCallRet', viewRelayCallRet)
    if (!viewRelayCallRet.paymasterAccepted) {
      throw new Error(
        `Paymaster rejected in server: ${decodeRevertReason(viewRelayCallRet.returnValue)} req=${JSON.stringify(req, null, 2)}`)
    }
  }

  async createRelayTransaction (req: RelayTransactionRequest): Promise<PrefixedHexString> {
    log.debug('dump request params', arguments[0])
    if (!this.ready) {
      throw new Error('relay not ready')
    }
    this.validateInputTypes(req)
    this.validateInput(req)
    this.validateFees(req)
    await this.validateMaxNonce(req.metadata.relayMaxNonce)

    // Call relayCall as a view function to see if we'll get paid for relaying this tx
    const { acceptanceBudget, maxPossibleGas } = await this.validatePaymasterGasLimits(req)
    await this.validateViewCallSucceeds(req, acceptanceBudget, maxPossibleGas)
    // Send relayed transaction
    log.debug('maxPossibleGas is', typeof maxPossibleGas, maxPossibleGas)

    const method = this.relayHubContract.contract.methods.relayCall(
      acceptanceBudget, req.relayRequest, req.metadata.signature, req.metadata.approvalData, maxPossibleGas)
    const currentBlock = await this.contractInteractor.getBlockNumber()
    const details: SendTransactionDetails =
      {
        signer: this.workerAddress,
        method,
        destination: req.metadata.relayHubAddress,
        gasLimit: maxPossibleGas.toString(),
        creationBlockNumber: currentBlock,
        gasPrice: req.relayRequest.relayData.gasPrice
      }
    const { signedTx } = await this.transactionManager.sendTransaction(details)
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(0, currentBlock)
    if (this.alerted) {
      console.log('Alerted state: slowing down traffic')
      await sleep(randomInRange(this.config.minAlertedDelayMS, this.config.maxAlertedDelayMS))
    }
    return signedTx
  }

  start (): void {
    log.debug('Polling new blocks')

    const handler = (): void => {
      this.contractInteractor.getBlock('latest')
        .then(
          block => {
            if (block.number > this.lastScannedBlock) {
              this._workerSemaphore.bind(this)(block.number)
            }
          })
        .catch((e) => {
          this.emit('error', e)
          console.error('error in start:', e)
        })
    }
    this.workerTask = setInterval(handler, 10 * this.timeUnit())
  }

  stop (): void {
    if (this.workerTask == null) {
      throw new Error('Server not started')
    }
    clearInterval(this.workerTask)
    console.log('Successfully stopped polling!!')
  }

  _workerSemaphore (blockNumber: number): void {
    if (this._workerSemaphoreOn) {
      log.debug('Different worker is not finished yet')
      return
    }
    this._workerSemaphoreOn = true
    this._worker(blockNumber)
      .then(() => {
        this._workerSemaphoreOn = false
      })
      .catch((e) => {
        if (e instanceof StateError) {
          if (e.message !== this.lastError) {
            this.lastError = e.message
            console.log('worker: ', this.lastError)
          }
        } else {
          this.emit('error', e)
          console.error('error in worker:', e)
        }
        this.ready = false
        this._workerSemaphoreOn = false
      })
  }

  fatal (message: string): void {
    console.error('FATAL: ' + message)
    process.exit(1)
  }

  async init (): Promise<void> {
    if (this.initialized) {
      throw new Error('_init was already called')
    }

    await this.transactionManager._init()
    this.relayHubContract = await this.contractInteractor.relayHubInstance

    const relayHubAddress = this.relayHubContract.address
    console.log('Server address', this.managerAddress)
    const code = await this.contractInteractor.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    } else {
      log.debug('code length', code.length)
    }

    this.registrationManager = new RegistrationManager(
      this.contractInteractor,
      this.transactionManager,
      this,
      this.config,
      this.managerAddress,
      this.workerAddress
    )

    this.chainId = await this.contractInteractor.getChainId()
    this.networkId = await this.contractInteractor.getNetworkId()
    if (this.config.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }

    log.debug('initialized', this.chainId, this.networkId)
    this.initialized = true
  }

  async replenishServer (workerIndex: number, currentBlock: number): Promise<TransactionReceipt[]> {
    const receipts: TransactionReceipt[] = []
    let managerEthBalance = await this.getManagerBalance()
    const managerHubBalance = await this.relayHubContract.balanceOf(this.managerAddress)
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (managerEthBalance.gte(toBN(this.config.managerTargetBalance.toString())) && workerBalance.gte(
      toBN(this.config.workerMinBalance.toString()))) {
      // all filled, nothing to do
      return receipts
    }
    if (managerEthBalance.lt(toBN(this.config.managerTargetBalance.toString())) && managerHubBalance.gte(
      toBN(this.config.minHubWithdrawalBalance))) {
      console.log(`withdrawing manager hub balance (${managerHubBalance.toString()}) to manager`)
      // Refill manager eth balance from hub balance
      const method = this.relayHubContract?.contract.methods.withdraw(toHex(managerHubBalance), this.managerAddress)
      const details: SendTransactionDetails = {
        signer: this.managerAddress,
        destination: this.relayHubContract.address,
        creationBlockNumber: currentBlock,
        method
      }
      receipts.push((await this.transactionManager.sendTransaction(details)).receipt)
    }
    managerEthBalance = await this.getManagerBalance()
    if (workerBalance.lt(toBN(this.config.workerMinBalance.toString()))) {
      const refill = toBN(this.config.workerTargetBalance.toString()).sub(workerBalance)
      console.log(
        `== replenishServer: mgr balance=${managerEthBalance.toString()}  manager hub balance=${managerHubBalance.toString()} 
          worker balance=${workerBalance.toString()} refill=${refill.toString()}`)
      if (refill.lt(managerEthBalance.sub(toBN(this.config.managerMinBalance)))) {
        console.log('Replenishing worker balance by manager eth balance')
        const details: SendTransactionDetails = {
          signer: this.managerAddress,
          destination: this.workerAddress,
          value: toHex(refill),
          creationBlockNumber: currentBlock,
          gasLimit: defaultEnvironment.mintxgascost.toString()
        }
        const tx = await this.transactionManager.sendTransaction(details)
        receipts.push(tx.receipt)
      } else {
        const message = `== replenishServer: can't replenish: mgr balance too low ${managerEthBalance.toString()} refill=${refill.toString()}`
        this.emit('fundingNeeded', message)
        console.log(message)
      }
    }
    return receipts
  }

  async _worker (blockNumber: number): Promise<TransactionReceipt[]> {
    if (!this.initialized) {
      await this.init()
    }
    if (blockNumber <= this.lastScannedBlock) {
      throw new Error('Attempt to scan older block, aborting')
    }
    if (!this._shouldRefreshState(blockNumber)) {
      return []
    }
    this.lastRefreshBlock = blockNumber
    const gasPriceString = await this.contractInteractor.getGasPrice()
    this.gasPrice = Math.floor(parseInt(gasPriceString) * this.config.gasPriceFactor)
    if (this.gasPrice === 0) {
      throw new StateError('Could not get gasPrice from node')
    }
    await this.registrationManager.assertManagerBalance()

    const hubEventsSinceLastScan = await this.getAllHubEventsSinceLastScan()
    const shouldRegisterAgain = await this._shouldRegisterAgain(blockNumber, hubEventsSinceLastScan)
    let { receipts, unregistered } = await this.registrationManager.handlePastEvents(hubEventsSinceLastScan, this.lastScannedBlock, blockNumber, shouldRegisterAgain)
    await this.transactionManager.removeConfirmedTransactions(blockNumber)
    await this._boostStuckPendingTransactions(blockNumber)
    if (unregistered) {
      this.lastScannedBlock = blockNumber
      return receipts
    }
    await this.registrationManager.assertRegistered()
    await this.handlePastHubEvents(blockNumber, hubEventsSinceLastScan)
    this.lastScannedBlock = blockNumber
    const workerIndex = 0
    receipts = receipts.concat(await this.replenishServer(workerIndex, blockNumber))
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (workerBalance.lt(toBN(this.config.workerMinBalance))) {
      this.emit('error', new Error('workers not funded...'))
      this.ready = false
      return receipts
    }
    if (!this.ready) {
      console.log('Relay is Ready.')
    }
    this.ready = true
    if (this.alerted && this.alertedBlock + this.config.alertedBlockDelay < blockNumber) {
      console.log(`Relay exited alerted state. Alerted block: ${this.alertedBlock}. Current block number: ${blockNumber}`)
      this.alerted = false
    }
    delete this.lastError
    return receipts
  }

  async getManagerBalance (): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.managerAddress))
  }

  async getWorkerBalance (workerIndex: number): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.workerAddress))
  }

  async _shouldRegisterAgain (currentBlock: number, hubEventsSinceLastScan: EventData[]): Promise<boolean> {
    const latestTxBlockNumber = await this._getLatestTxBlockNumber(hubEventsSinceLastScan)
    return this.config.registrationBlockRate === 0 ? false : currentBlock - latestTxBlockNumber >= this.config.registrationBlockRate
  }

  _shouldRefreshState (currentBlock: number): boolean {
    return currentBlock - this.lastRefreshBlock > this.config.refreshStateTimeoutBlocks || !this.ready
  }

  async handlePastHubEvents (blockNumber: number, hubEventsSinceLastScan: EventData[]): Promise<void> {
    for (const event of hubEventsSinceLastScan) {
      switch (event.event) {
        case TransactionRejectedByPaymaster:
          log.debug('handle TransactionRejectedByPaymaster event', event)
          await this._handleTransactionRejectedByPaymasterEvent(blockNumber)
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
    return await this.contractInteractor.getPastEventsForHub(topics, options)
  }

  async _handleTransactionRejectedByPaymasterEvent (blockNumber: number): Promise<void> {
    this.alerted = true
    this.alertedBlock = blockNumber
    console.error(`Relay entered alerted state. Block number: ${blockNumber}`)
  }

  async _getLatestTxBlockNumber (eventsSinceLastScan: EventData[]): Promise<number> {
    const latestTransactionSinceLastScan = reduceToLatestTx(eventsSinceLastScan)
    if (latestTransactionSinceLastScan != null) {
      this.lastMinedActiveTransaction = latestTransactionSinceLastScan
    }
    if (this.lastMinedActiveTransaction == null) {
      this.lastMinedActiveTransaction = await this._queryLatestActiveEvent()
    }
    return this.lastMinedActiveTransaction?.blockNumber ?? -1
  }

  async _queryLatestActiveEvent (): Promise<EventData | undefined> {
    const events: EventData[] = await this.contractInteractor.getPastEventsForHub([address2topic(this.managerAddress)], {
      fromBlock: 1
    })
    return reduceToLatestTx(events)
  }

  /**
   * Resend the earliest pending transactions of all signers (manager, workers)
   * @return the receipt from the first request
   */
  async _boostStuckPendingTransactions (blockNumber: number): Promise<PrefixedHexString[]> {
    const transactionHashes: PrefixedHexString[] = []
    // repeat separately for each signer (manager, all workers)
    let signedTx = await this._boostStuckTransactionsForManager(blockNumber)
    if (signedTx != null) {
      transactionHashes.push(signedTx)
    }
    for (const workerIndex of [0]) {
      signedTx = await this._boostStuckTransactionsForWorker(blockNumber, workerIndex)
      if (signedTx != null) {
        transactionHashes.push(signedTx)
      }
    }
    return transactionHashes
  }

  async _boostStuckTransactionsForManager (blockNumber: number): Promise<PrefixedHexString | null> {
    return await this.transactionManager.boostOldestPendingTransactionForSigner(this.managerAddress, blockNumber)
  }

  async _boostStuckTransactionsForWorker (blockNumber: number, workerIndex: number): Promise<PrefixedHexString | null> {
    const signer = this.workerAddress
    return await this.transactionManager.boostOldestPendingTransactionForSigner(signer, blockNumber)
  }

  _isTrustedPaymaster (paymaster: string): boolean {
    return this.config.trustedPaymasters.map(it => it.toLowerCase()).includes(paymaster.toLowerCase())
  }

  timeUnit (): number {
    if (this.config.devMode) {
      return 10
    }
    return 1000
  }
}
