import log from 'loglevel'
import ow from 'ow'
import { BlockHeader } from 'web3-eth'
import { EventData } from 'web3-eth-contract'
import { EventEmitter } from 'events'
import { PrefixedHexString } from 'ethereumjs-tx'
import { TransactionReceipt } from 'web3-core'
import { toBN, toHex } from 'web3-utils'

import RelayRequest from '../common/EIP712/RelayRequest'

import ContractInteractor, {
  TransactionRejectedByPaymaster
} from '../relayclient/ContractInteractor'
import PingResponse from '../common/PingResponse'
import RelayTransactionRequest from '../relayclient/types/RelayTransactionRequest'
import { IPaymasterInstance, IRelayHubInstance } from '../../types/truffle-contracts'
import VersionsManager from '../common/VersionsManager'
import {
  address2topic,
  calculateTransactionMaxPossibleGas,
  decodeRevertReason,
  randomInRange,
  sleep
} from '../common/Utils'
import { defaultEnvironment } from '../common/Environments'
import { constants } from '../common/Constants'
import { RegistrationManager, StateError } from './RegistrationManager'
import { TransactionManager } from './TransactionManager'
import { configureServer, ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import Timeout = NodeJS.Timeout

const VERSION = '2.0.0-beta.1'
const GAS_RESERVE = 100000

export class RelayServer extends EventEmitter {
  lastScannedBlock = 0
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

  registrationManager!: RegistrationManager
  chainId!: number
  networkId!: number
  relayHubContract!: IRelayHubInstance
  paymasterContract!: IPaymasterInstance

  constructor (config: Partial<ServerConfigParams>, dependencies: ServerDependencies) {
    super()
    this.versionManager = new VersionsManager(VERSION)
    this.config = configureServer(config)
    this.contractInteractor = dependencies.contractInteractor
    this.transactionManager = new TransactionManager(this.contractInteractor, dependencies)
    this.managerAddress = this.transactionManager.managerKeyManager.getAddress(0)
    this.workerAddress = this.transactionManager.workersKeyManager.getAddress(0)
    log.debug('config:', JSON.stringify(this.config))
  }

  getMinGasPrice (): number {
    return this.gasPrice
  }

  isReady (): boolean {
    return this.ready
  }

  pingHandler (): PingResponse {
    return {
      RelayServerAddress: this.workerAddress,
      RelayManagerAddress: this.managerAddress,
      RelayHubAddress: this.relayHubContract?.address ?? '',
      MinGasPrice: this.getMinGasPrice().toString(),
      MaxAcceptanceBudget: this.config.maxAcceptanceBudget.toString(),
      Ready: this.isReady(),
      Version: VERSION
    }
  }

  async createRelayTransaction (req: RelayTransactionRequest): Promise<PrefixedHexString> {
    log.debug('dump request params', arguments[0])
    ow(req.data, ow.string)
    ow(req.approvalData, ow.string)
    ow(req.signature, ow.string)

    // Check that the relayHub is the correct one
    if (req.relayHubAddress !== this.relayHubContract?.address) {
      throw new Error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract?.address}, request's hub address: ${req.relayHubAddress}\n`)
    }

    // Check the relayWorker (todo: once migrated to multiple relays, check if exists)
    const workerIndex = 0
    if (req.relayWorker.toLowerCase() !== this.workerAddress.toLowerCase()) {
      throw new Error(
        `Wrong worker address: ${req.relayWorker}\n`)
    }

    // if trusted paymaster, we trust it to handle fees
    if (!this.config.trustedPaymasters.map(it => it.toLowerCase()).includes(req.paymaster.toLowerCase())) {
      // Check that the fee is acceptable
      if (isNaN(parseInt(req.pctRelayFee)) || parseInt(req.pctRelayFee) < this.config.pctRelayFee) {
        throw new Error(`Unacceptable pctRelayFee: ${req.pctRelayFee} relayServer's pctRelayFee: ${this.config.pctRelayFee}`)
      }
      if (isNaN(parseInt(req.baseRelayFee)) || toBN(req.baseRelayFee).lt(toBN(this.config.baseRelayFee))) {
        throw new Error(`Unacceptable baseRelayFee: ${req.baseRelayFee} relayServer's baseRelayFee: ${this.config.baseRelayFee}`)
      }
    }
    // Check that the gasPrice is initialized & acceptable
    if (this.gasPrice === 0 || this.gasPrice == null) {
      throw new Error('gasPrice not initialized')
    }
    if (this.gasPrice > parseInt(req.gasPrice ?? '0')) {
      throw new Error(
        `Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice} request's gasPrice: ${req.gasPrice}`)
    }

    // Check that max nonce is valid
    const nonce = await this.transactionManager.pollNonce(this.workerAddress)
    if (nonce > req.relayMaxNonce) {
      throw new Error(`Unacceptable relayMaxNonce: ${req.relayMaxNonce}. current nonce: ${nonce}`)
    }

    // Call relayCall as a view function to see if we'll get paid for relaying this tx
    const relayRequest: RelayRequest = {
      request: {
        to: req.to,
        data: req.data,
        from: req.from,
        nonce: req.senderNonce,
        gas: req.gasLimit,
        value: req.value
      },
      relayData: {
        baseRelayFee: req.baseRelayFee,
        pctRelayFee: req.pctRelayFee,
        gasPrice: req.gasPrice,
        paymaster: req.paymaster,
        paymasterData: req.paymasterData,
        clientId: req.clientId,
        forwarder: req.forwarder,
        relayWorker: this.workerAddress
      }
    }

    let gasLimits
    try {
      if (this.paymasterContract === undefined) {
        this.paymasterContract = await this.contractInteractor._createPaymaster(req.paymaster)
      }
      this.paymasterContract.contract.options.address = req.paymaster
      gasLimits = await this.paymasterContract.getGasLimits()
    } catch (e) {
      if (
        (e as Error).message.includes(
          'Returned values aren\'t valid, did it run Out of Gas?'
        )
      ) {
        throw new Error(`non-existent or incompatible paymaster contract: ${req.paymaster}`)
      }
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`unknown paymaster error: ${e.message}`)
    }

    const hubOverhead = (await this.relayHubContract.gasOverhead()).toNumber()
    const maxPossibleGas = GAS_RESERVE + calculateTransactionMaxPossibleGas({
      gasLimits,
      hubOverhead,
      relayCallGasLimit: req.gasLimit
    })
    const method = this.relayHubContract.contract.methods.relayCall(this.config.maxAcceptanceBudget, relayRequest, req.signature, req.approvalData, maxPossibleGas)
    let viewRelayCallRet: { paymasterAccepted: boolean, returnValue: string }
    try {
      viewRelayCallRet =
        await method.call({
          from: this.workerAddress,
          gasPrice: relayRequest.relayData.gasPrice,
          gasLimit: maxPossibleGas
        })
    } catch (e) {
      throw new Error(`relayCall reverted in server: ${(e as Error).message}`)
    }
    log.debug('viewRelayCallRet', viewRelayCallRet)
    if (!viewRelayCallRet.paymasterAccepted) {
      throw new Error(
        `Paymaster rejected in server: ${decodeRevertReason(viewRelayCallRet.returnValue)} req=${JSON.stringify(relayRequest, null, 2)}`)
    }
    // Send relayed transaction
    log.debug('maxPossibleGas is', typeof maxPossibleGas, maxPossibleGas)

    const maxCharge =
      await this.relayHubContract.calculateCharge(maxPossibleGas, {
        gasPrice: req.gasPrice?.toString() ?? '0',
        pctRelayFee: req.pctRelayFee.toString(),
        baseRelayFee: req.baseRelayFee.toString(),
        relayWorker: req.relayWorker,
        forwarder: req.forwarder,
        paymaster: req.paymaster,
        paymasterData: req.paymasterData,
        clientId: req.clientId
      })
    const paymasterBalance = await this.relayHubContract.balanceOf(req.paymaster)
    if (paymasterBalance.lt(maxCharge)) {
      throw new Error(`paymaster balance too low: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    }
    console.log(`paymaster balance: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    console.log(`Estimated max charge of relayed tx: ${maxCharge.toString()}, GasLimit of relayed tx: ${maxPossibleGas}`)
    const { signedTx } = await this.transactionManager.sendTransaction(
      {
        signer: this.workerAddress,
        method,
        destination: req.relayHubAddress,
        gasLimit: maxPossibleGas.toString(),
        gasPrice: req.gasPrice
      })
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(workerIndex)
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
              this._workerSemaphore.bind(this)(block)
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

  _workerSemaphore (blockHeader: BlockHeader): void {
    if (this._workerSemaphoreOn) {
      log.debug('Different worker is not finished yet')
      return
    }
    this._workerSemaphoreOn = true
    this._worker(blockHeader)
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
    this.relayHubContract = await this.contractInteractor._createRelayHub(this.config.relayHubAddress)

    // TODO TODO 2: anything else!
    // @ts-ignore
    this.contractInteractor.config.stakeManagerAddress = await this.relayHubContract.stakeManager()
    // end TODO TODO 2: anything else!

    const relayHubAddress = this.relayHubContract.address
    console.log('Server address', this.managerAddress)
    const code = await this.contractInteractor.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    } else {
      log.debug('code length', code.length)
    }
    const version = await this.relayHubContract.versionHub().catch(_ => 'no getVersion() method')
    if (!this.versionManager.isMinorSameOrNewer(version)) {
      this.fatal(`Not a valid RelayHub at ${relayHubAddress}: version: ${version}`)
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

  async replenishServer (workerIndex: number): Promise<TransactionReceipt[]> {
    const receipts: TransactionReceipt[] = []
    let managerEthBalance = await this.getManagerBalance()
    const managerHubBalance = await this.relayHubContract.balanceOf(this.managerAddress)
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (managerEthBalance.gte(toBN(this.config.managerTargetBalance.toString())) && workerBalance.gte(toBN(this.config.workerMinBalance.toString()))) {
      // all filled, nothing to do
      return receipts
    }
    if (managerEthBalance.lt(toBN(this.config.managerTargetBalance.toString())) && managerHubBalance.gte(toBN(this.config.minHubWithdrawalBalance))) {
      console.log(`withdrawing manager hub balance (${managerHubBalance.toString()}) to manager`)
      // Refill manager eth balance from hub balance
      const method = this.relayHubContract?.contract.methods.withdraw(toHex(managerHubBalance), this.managerAddress)
      receipts.push((await this.transactionManager.sendTransaction({
        signer: this.managerAddress,
        destination: this.relayHubContract.address,
        method
      })).receipt)
    }
    managerEthBalance = await this.getManagerBalance()
    if (workerBalance.lt(toBN(this.config.workerMinBalance.toString()))) {
      const refill = toBN(this.config.workerTargetBalance.toString()).sub(workerBalance)
      console.log(
        `== replenishServer: mgr balance=${managerEthBalance.toString()}  manager hub balance=${managerHubBalance.toString()} 
          worker balance=${workerBalance.toString()} refill=${refill.toString()}`)
      if (refill.lt(managerEthBalance.sub(toBN(this.config.managerMinBalance)))) {
        console.log('Replenishing worker balance by manager eth balance')
        receipts.push((await this.transactionManager.sendTransaction({
          signer: this.managerAddress,
          destination: this.workerAddress,
          value: toHex(refill),
          gasLimit: defaultEnvironment.mintxgascost.toString()
        })).receipt)
      } else {
        const message = `== replenishServer: can't replenish: mgr balance too low ${managerEthBalance.toString()} refill=${refill.toString()}`
        this.emit('fundingNeeded', message)
        console.log(message)
      }
    }
    return receipts
  }

  async _worker (blockHeader: BlockHeader): Promise<TransactionReceipt[]> {
    if (!this.initialized) {
      await this.init()
    }
    const gasPriceString = await this.contractInteractor.getGasPrice()
    this.gasPrice = Math.floor(parseInt(gasPriceString) * this.config.gasPriceFactor)
    if (this.gasPrice === 0) {
      throw new StateError('Could not get gasPrice from node')
    }
    await this.registrationManager.assertManagerBalance()

    const shouldRegisterAgain = await this.getShouldRegisterAgain()
    let { receipts, unregistered } = await this.registrationManager.handlePastEvents(this.lastScannedBlock, shouldRegisterAgain)
    await this._resendUnconfirmedTransactions(blockHeader)
    if (unregistered) {
      this.lastScannedBlock = blockHeader.number
      return receipts
    }
    await this.registrationManager.assertRegistered()
    await this.handlePastHubEvents(blockHeader)
    this.lastScannedBlock = blockHeader.number
    const workerIndex = 0
    receipts = receipts.concat(await this.replenishServer(workerIndex))
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
    if (this.alerted && this.alertedBlock + this.config.alertedBlockDelay < blockHeader.number) {
      console.log(`Relay exited alerted state. Alerted block: ${this.alertedBlock}. Current block number: ${blockHeader.number}`)
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

  async getShouldRegisterAgain (): Promise<boolean> {
    const currentBlock = await this.contractInteractor.getBlockNumber()
    const latestTxBlockNumber = await this._getLatestTxBlockNumber()
    return this.config.registrationBlockRate === 0 ? false : currentBlock - latestTxBlockNumber >= this.config.registrationBlockRate
  }

  async handlePastHubEvents (blockHeader: BlockHeader): Promise<void> {
    const topics = [address2topic(this.managerAddress)]
    const options = {
      fromBlock: this.lastScannedBlock + 1,
      toBlock: 'latest'
    }
    const eventNames = [TransactionRejectedByPaymaster]
    const decodedEvents = await this.contractInteractor.getPastEventsForHub(eventNames, topics, options)
    for (const dlog of decodedEvents) {
      switch (dlog.event) {
        case TransactionRejectedByPaymaster:
          await this._handleTransactionRejectedByPaymasterEvent(dlog, blockHeader.number)
          break
      }
    }
  }

  async _handleTransactionRejectedByPaymasterEvent (dlog: EventData, blockNumber: number): Promise<void> {
    log.debug('handle TransactionRejectedByPaymaster event', dlog)
    this.alerted = true
    this.alertedBlock = blockNumber
    console.error(`Relay entered alerted state. Block number: ${blockNumber}`)
  }

  async _getLatestTxBlockNumber (): Promise<number> {
    const events: EventData[] = await this.contractInteractor.getPastEventsForHub(constants.activeManagerEvents, [address2topic(this.managerAddress)], {
      fromBlock: 1
    })
    const latestBlock = events
      .filter(
        (e: EventData) =>
          e.returnValues.relayManager.toLowerCase() === this.managerAddress.toLowerCase())
      .map(
        (e: EventData) =>
          e.blockNumber)
      .reduce(
        (b1: any, b2: any) => Math.max(b1, b2), 0)
    return latestBlock
  }

  /**
   * resend Txs of all signers (manager, workers)
   * @return the receipt from the first request
   */
  async _resendUnconfirmedTransactions (blockHeader: BlockHeader): Promise<PrefixedHexString | undefined> {
    // repeat separately for each signer (manager, all workers)
    let signedTx = await this._resendUnconfirmedTransactionsForManager(blockHeader)
    if (signedTx != null) {
      return signedTx
    }
    for (const workerIndex of [0]) {
      signedTx = await this._resendUnconfirmedTransactionsForWorker(blockHeader, workerIndex)
      if (signedTx != null) {
        return signedTx // TODO: should we early-return ?
      }
    }
  }

  async _resendUnconfirmedTransactionsForManager (blockHeader: BlockHeader): Promise<PrefixedHexString | null> {
    return await this.transactionManager.resendUnconfirmedTransactionsForSigner(blockHeader, this.managerAddress)
  }

  async _resendUnconfirmedTransactionsForWorker (blockHeader: BlockHeader, workerIndex: number): Promise<PrefixedHexString | null> {
    const signer = this.workerAddress
    return await this.transactionManager.resendUnconfirmedTransactionsForSigner(blockHeader, signer)
  }

  timeUnit (): number {
    if (this.config.devMode) {
      return 10
    }
    return 1000
  }
}
