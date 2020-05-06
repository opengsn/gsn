import { EventEmitter } from 'events'
import ow from 'ow'
import Web3 from 'web3'
// @ts-ignore
import abiDecoder from 'abi-decoder'

import { PrefixedHexString, Transaction, TransactionOptions } from 'ethereumjs-tx'

import RelayHubABI from '../common/interfaces/IRelayHub'
import PayMasterABI from '../common/interfaces/IPaymaster'
import StakeManagerABI from '../common/interfaces/IStakeManager'
import getDataToSign from '../common/EIP712/Eip712Helper'
import RelayRequest from '../common/EIP712/RelayRequest'
import utils from '../common/utils'
/*
cannot read TS module if executed by node. Use ts-node to run or, better, fix.
const Environments = require('../relayclient/types/Environments').environments
const gtxdatanonzero = Environments.constantinople.gtxdatanonzero
 */
import { StoredTx, transactionToStoredTx, TxStoreManager } from './TxStoreManager'

import { Mutex } from 'async-mutex'
import { KeyManager } from './KeyManager'
import ContractInteractor from '../relayclient/ContractInteractor'
import PingResponse from '../common/PingResponse'
import { Address, IntString } from '../relayclient/types/Aliases'
import GsnTransactionDetails from '../relayclient/types/GsnTransactionDetails'
import { IPaymasterInstance, IRelayHubInstance, IStakeManagerInstance } from '../../types/truffle-contracts'
import { BlockHeader } from 'web3-eth'
import { TransactionReceipt } from 'web3-core'
import { configureGSN } from '../relayclient/GSNConfigurator'

const gtxdatanonzero = 16
abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const VERSION = '0.0.1'
const minimumRelayBalance = 1e17 // 0.1 eth
const defaultWorkerMinBalance = 0.01e18
const defaultWorkerTargetBalance = 0.3e18
const confirmationsNeeded = 12
const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
const maxGasPrice = 100e9
const GAS_RESERVE = 100000
const retryGasPriceFactor = 1.2
let DEBUG = false
const SPAM = false

const toBN = Web3.utils.toBN

interface DecodeLogsEvent {
  name: string
  args: any
}

interface SignedTransactionDetails {
  receipt: TransactionReceipt
  signedTx: PrefixedHexString
}

function debug (...args: any): void {
  if (DEBUG) console.log(...args)
}

function spam (...args: any): void {
  if (SPAM) debug(...args)
}

class StateError extends Error {
}

export interface CreateTransactionDetails extends GsnTransactionDetails {
  // encodedFunction: PrefixedHexString - defined as "data
  encodedFunction: PrefixedHexString
  approvalData: PrefixedHexString
  signature: PrefixedHexString
  senderNonce: IntString
  relayMaxNonce: IntString
  baseRelayFee: IntString
  pctRelayFee: IntString
  relayHubAddress: Address
}

interface SendTransactionDetails {
  signerIndex: number
  method?: any
  destination: Address
  value: IntString
  gasLimit: IntString
  gasPrice: IntString
}

export class RelayServerParams {
  constructor (
    readonly txStoreManager: TxStoreManager,
    readonly web3provider: provider,
    readonly keyManager: KeyManager,
    readonly contractInteractor: ContractInteractor,
    readonly hubAddress: PrefixedHexString,
    readonly baseRelayFee: number | undefined,
    readonly pctRelayFee: number | undefined,
    readonly gasPriceFactor: number,
    readonly url?: string,
    readonly workerMinBalance = defaultWorkerMinBalance,
    readonly workerTargetBalance = defaultWorkerTargetBalance,
    readonly devMode = false,
    readonly Debug = false,
    readonly web3 = new Web3(web3provider)
  ) {}
}

export class RelayServer extends EventEmitter {
  private lastScannedBlock = 0
  private ready = false
  private removed = false
  private readonly nonceMutex = new Mutex()
  private readonly nonces: Record<number, number> = {}
  private readonly managerAddress: PrefixedHexString
  private gasPrice: number = 0
  private relayHubContract: IRelayHubInstance | undefined
  private paymasterContract: IPaymasterInstance | undefined
  private chainId: any
  private rawTxOptions: TransactionOptions | undefined
  private subscription: any
  private _workerSemaphoreOn = false
  private stakeManagerContract: IStakeManagerInstance | undefined
  private topics: string[][] | undefined
  private networkId: number | undefined
  private initialized = false
  private balance = toBN(0)
  private stake = toBN(0)
  private isAddressAdded = false
  private lastError: string | undefined
  private owner: PrefixedHexString | undefined
  private unstakeDelay: BN | undefined | string
  private withdrawBlock: BN | undefined | string
  private authorizedHub = false
  readonly txStoreManager: TxStoreManager
  private readonly web3provider: provider
  private readonly keyManager: KeyManager
  private readonly contractInteractor: ContractInteractor
  private readonly hubAddress: PrefixedHexString
  private readonly baseRelayFee: number
  private readonly pctRelayFee: number
  private readonly gasPriceFactor: number
  private readonly url: string
  private readonly workerMinBalance: number
  private readonly workerTargetBalance: number
  private readonly devMode: boolean
  private readonly web3: Web3

  constructor (params: RelayServerParams) {
    super()
    this.txStoreManager = params.txStoreManager
    this.web3provider = params.web3provider
    this.keyManager = params.keyManager
    this.hubAddress = params.hubAddress
    this.baseRelayFee = params.baseRelayFee ?? 0
    this.pctRelayFee = params.pctRelayFee ?? 0
    this.gasPriceFactor = params.gasPriceFactor
    this.url = params.url ?? 'http://localhost:8090'
    console.log('WTF workerMinBalance', params.workerMinBalance)
    this.workerMinBalance = params.workerMinBalance
    this.workerTargetBalance = params.workerTargetBalance
    this.devMode = params.devMode
    this.web3 = params.web3 ?? new Web3(this.web3provider)
    this.contractInteractor = params.contractInteractor ?? new ContractInteractor(this.web3provider,
      configureGSN({}))

    DEBUG = params.Debug

    // todo: initialize nonces for all signers (currently one manager, one worker)
    this.nonces = { 0: 0, 1: 0 }

    this.keyManager.generateKeys(2)
    this.managerAddress = this.keyManager.getAddress(0)

    debug('gasPriceFactor', this.gasPriceFactor)
  }

  getManagerAddress (): PrefixedHexString {
    return this.managerAddress
  }

  // index zero is not a worker, but the manager.
  getAddress (index: number): PrefixedHexString {
    ow(index, ow.number)
    return this.keyManager.getAddress(index)
  }

  getMinGasPrice (): number {
    return this.gasPrice
  }

  isReady (): boolean {
    return this.ready && !this.removed
  }

  pingHandler (): PingResponse {
    return {
      RelayServerAddress: this.getAddress(1),
      RelayManagerAddress: this.managerAddress,
      RelayHubAddress: this.relayHubContract?.address ?? '',
      MinGasPrice: this.getMinGasPrice().toString(),
      Ready: this.isReady(),
      Version: VERSION
    }
  }

  async createRelayTransaction (req: CreateTransactionDetails): Promise<any> {
    debug('dump request params', arguments[0])
    ow(req.approvalData, ow.string)
    ow(req.signature, ow.string)

    // Check that the relayHub is the correct one
    if (req.relayHubAddress !== this.relayHubContract?.address) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract?.address}, request's hub address: ${req.relayHubAddress}\n`)
    }

    // Check that the fee is acceptable
    if (isNaN(parseInt(req.pctRelayFee)) || parseInt(req.pctRelayFee) < this.pctRelayFee) {
      throw new Error(`Unacceptable pctRelayFee: ${req.pctRelayFee} relayServer's pctRelayFee: ${this.pctRelayFee}`)
    }
    if (isNaN(parseInt(req.baseRelayFee)) || parseInt(req.baseRelayFee) < this.baseRelayFee) {
      throw new Error(`Unacceptable baseRelayFee: ${req.baseRelayFee} relayServer's baseRelayFee: ${this.baseRelayFee}`)
    }

    // Check that the gasPrice is initialized & acceptable
    if (this.gasPrice === 0) {
      throw new Error('gasPrice not initialized')
    }
    if (this.gasPrice > parseInt(req.gasPrice ?? '0')) {
      throw new Error(
        `Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice} request's gasPrice: ${req.gasPrice}`)
    }

    // TODO: currently we hard-code a single worker. should find a "free" one to use from a pool
    const workerIndex = 1

    // TODO: should replenish earlier, so client can validate the worker has funds to pay for the tx
    await this.replenishWorker(1)

    // Check that max nonce is valid
    const nonce = await this._pollNonce(workerIndex)
    if (nonce > parseInt(req.relayMaxNonce)) {
      throw new Error(`Unacceptable relayMaxNonce: ${req.relayMaxNonce}. current nonce: ${nonce}`)
    }

    // Check canRelay view function to see if we'll get paid for relaying this tx
    const relayRequest = new RelayRequest({
      senderAddress: req.from,
      senderNonce: req.senderNonce,
      target: req.to,
      encodedFunction: req.data,
      baseRelayFee: req.baseRelayFee,
      pctRelayFee: req.pctRelayFee,
      gasPrice: req.gasPrice,
      gasLimit: req.gas,
      paymaster: req.paymaster,
      relayWorker: this.getAddress(1)
    })
    // TODO: should not use signedData at all. only the relayRequest.
    const signedData = getDataToSign({
      chainId: this.chainId,
      verifier: this.relayHubContract.address,
      relayRequest
    })
    const method = this.relayHubContract.contract.methods.relayCall(signedData.message, req.signature, req.approvalData)
    const calldataSize = method.encodeABI().length / 2
    debug('calldatasize', calldataSize)
    let gasLimits
    try {
      if (this.paymasterContract === undefined) {
        this.paymasterContract = await this.contractInteractor._createPaymaster(req.paymaster)
      }
      this.paymasterContract.contract.options.address = req.paymaster
      gasLimits = await this.paymasterContract.getGasLimits()
    } catch (e) {
      if (
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        e.message.includes(
          'Returned values aren\'t valid, did it run Out of Gas? You might also see this error if you are not using the correct ABI for the contract you are retrieving data from, requesting data from a block number that does not exist, or querying a node which is not fully synced.'
        )
      ) {
        throw new Error(`non-existent or incompatible paymaster contract: ${req.paymaster}`)
      }
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`unknown paymaster error: ${e.message}`)
    }

    const hubOverhead = (await this.relayHubContract.getHubOverhead()).toNumber()
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    const maxPossibleGas = GAS_RESERVE + utils.calculateTransactionMaxPossibleGas({
      gasLimits,
      hubOverhead,
      relayCallGasLimit: parseInt(req.gas ?? '0'),
      calldataSize,
      gtxdatanonzero: gtxdatanonzero
    })

    // @ts-ignore
    let canRelayRet: { success: boolean } = await this.relayHubContract.canRelay(
      signedData.message,
      maxPossibleGas,
      gasLimits.acceptRelayedCallGasLimit,
      req.signature,
      req.approvalData, { from: this.getAddress(workerIndex) })
    debug('canRelayRet', canRelayRet)
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (canRelayRet) {
      canRelayRet = { success: false }
    }
    if (!canRelayRet.success) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`canRelay failed in server: ${canRelayRet}`)
    }
    // Send relayed transaction
    debug('maxPossibleGas is', typeof maxPossibleGas, maxPossibleGas)

    const maxCharge = parseInt(
      // @ts-ignore
      await this.relayHubContract.calculateCharge(maxPossibleGas, {
        gasPrice: req.gasPrice?.toString() ?? '0',
        pctRelayFee: req.pctRelayFee.toString(),
        baseRelayFee: req.baseRelayFee.toString(),
        gasLimit: 0
      }))
    const paymasterBalance = (await this.relayHubContract.balanceOf(req.paymaster)).toNumber()
    if (paymasterBalance < maxCharge) {
      throw new Error(`paymaster balance too low: ${paymasterBalance}, maxCharge: ${maxCharge}`)
    }
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    debug(`Estimated max charge of relayed tx: ${maxCharge}, GasLimit of relayed tx: ${maxPossibleGas}`)
    const { signedTx } = await this._sendTransaction(
      {
        signerIndex: workerIndex,
        method,
        value: '0',
        destination: req.relayHubAddress,
        gasLimit: req.baseRelayFee,
        gasPrice: req.gasPrice as string
      })
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishWorker(1)
    return signedTx
  }

  start (): void {
    debug('Subscribing to new blocks')
    this.subscription = this.web3.eth.subscribe('newBlockHeaders', (error, result) => {
      if (error != null) {
        console.error('web3 subscription:', error)
      }
      console.log('successfully registered', result)
    }).on('data', this._workerSemaphore.bind(this)).on('error', (e) => {
      console.error('worker:', e)
    })

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      const blockNumber = await this.web3.eth.getBlockNumber()
      const blockHeader = { number: blockNumber }
      this._workerSemaphore.bind(this)(blockHeader as BlockHeader)
    }, 1)
  }

  async stop (): Promise<void> {
    // @ts-ignore
    await this.subscription.unsubscribe()
    console.log('Successfully unsubscribed!')
  }

  _workerSemaphore (blockHeader: BlockHeader): void {
    if (this._workerSemaphoreOn) {
      debug('Different worker is not finished yet')
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

  async _init (): Promise<void> {
    this.relayHubContract = await this.contractInteractor._createRelayHub(this.hubAddress)
    const relayHubAddress = this.relayHubContract.address
    console.log('Server address', this.managerAddress)
    const code = await this.web3.eth.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    } else {
      debug('code length', code.length)
    }
    const version = await this.relayHubContract.getVersion().catch(_ => 'no getVersion() method')
    if (version !== '1.0.0') {
      this.fatal(`Not a valid RelayHub at ${relayHubAddress}: version: ${version}`)
    }
    const stakeManagerAddress = await this.relayHubContract.getStakeManager()
    this.stakeManagerContract = await this.contractInteractor._createStakeManager(stakeManagerAddress)
    const stakeManagerTopics = [Object.keys(this.stakeManagerContract.contract.events).filter(x => (x.includes('0x')))]
    this.topics = stakeManagerTopics.concat([['0x' + '0'.repeat(24) + this.managerAddress.slice(2)]])

    this.chainId = await this.web3.eth.getChainId()
    this.networkId = await this.web3.eth.net.getId()
    if (this.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }

    // TODO: use ContractInteractor
    const chain = await this.web3.eth.net.getNetworkType()
    // @ts-ignore
    this.rawTxOptions = { chain: chain !== 'private' ? chain : null, hardfork: 'istanbul' }

    console.log('intialized', this.chainId, this.networkId, this.rawTxOptions)
    this.initialized = true
  }

  async replenishWorker (workerIndex: number): Promise<void> {
    const workerAddress = this.getAddress(workerIndex)
    const workerBalance = toBN(await this.web3.eth.getBalance(workerAddress))
    console.log('wtf workerMinBalance', this.workerMinBalance)
    if (workerBalance.lt(toBN(this.workerMinBalance))) {
      const refill = toBN(this.workerTargetBalance).sub(workerBalance)
      console.log(
        `== replenishWorker(${workerIndex}): mgr balance=${this.balance.toNumber() / 1e18} worker balance=${workerBalance.toNumber() / 1e18} refill=${refill.toNumber() / 1e18}`)
      if (refill.lt(this.balance.sub(toBN(minimumRelayBalance)))) {
        await this._sendTransaction({
          signerIndex: 0,
          destination: workerAddress,
          value: refill.toString(),
          gasLimit: '300000',
          gasPrice: this.gasPrice.toString()
        })
        await this.refreshBalance()
      } else {
        console.log(
          `== replenishWorker: can't replenish: mgr balance too low ${this.balance.toNumber() / 1e18} refill=${refill.toNumber() / 1e18}`)
      }
    }
  }

  async _worker (blockHeader: BlockHeader): Promise<TransactionReceipt | void> {
    if (!this.initialized) {
      await this._init()
    }
    const gasPriceString = await this.web3.eth.getGasPrice()
    this.gasPrice = Math.floor(parseInt(gasPriceString) * this.gasPriceFactor)
    if (this.gasPrice === 0) {
      throw new StateError('Could not get gasPrice from node')
    }
    await this.refreshBalance()
    console.log('wtf is balance?', this.balance.toString())
    if (this.balance.lt(toBN(minimumRelayBalance))) {
      throw new StateError(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Server's balance too low ( ${this.balance}, required ${minimumRelayBalance}). Waiting for funding...`)
    }
    console.log('wtf how?', minimumRelayBalance)
    const options = {
      fromBlock: this.lastScannedBlock + 1,
      toBlock: 'latest',
      address: this.stakeManagerContract?.address,
      topics: this.topics
    }
    const logs = await this.web3.eth.getPastLogs(options)
    spam('logs?', logs)
    spam('options? ', options)
    const decodedLogs = abiDecoder.decodeLogs(logs).map(this._parseEvent)
    let receipt
    // TODO: what about 'penalize' events? should send balance to owner, I assume
    // TODO TODO TODO 'StakeAdded' is not the event you want to cat upon if there was no 'HubAuthorized' event
    for (const dlog of decodedLogs) {
      switch (dlog.name) {
        case 'HubAuthorized':
          receipt = await this._handleHubAuthorizedEvent(dlog)
          break
        case 'StakeAdded':
          receipt = await this._handleStakedEvent(dlog)
          break
        // There is no such event now
        // case 'RelayRemoved':
        //   await this._handleRelayRemovedEvent(dlog)
        //   break
        case 'StakeUnlocked':
          receipt = await this._handleUnstakedEvent(dlog)
          break
      }
    }

    if (this.stake.eq(toBN(0))) {
      throw new StateError('Waiting for stake')
    }
    console.log('wtf is stake', this.stake.toString(), this.stake.eq(toBN(0)))
    // todo check if registered!!
    // TODO: now even more todo then before. This is a hotfix.
    if (!this.isAddressAdded) {
      throw new StateError('Not registered yet...')
    }
    this.lastScannedBlock = blockHeader.number
    if (!this.ready) {
      console.log('Relay is Ready.')
    }
    this.ready = true
    delete this.lastError
    await this._resendUnconfirmedTransactions(blockHeader)
    console.log('wtf is receipt', receipt)
    return receipt
  }

  async refreshBalance (): Promise<BN> {
    this.balance = toBN(await this.web3.eth.getBalance(this.managerAddress))
    return this.balance
  }

  async refreshStake (): Promise<BN> {
    if (!this.initialized) {
      await this._init()
    }
    const stakeInfo = await this.stakeManagerContract?.getStakeInfo(this.managerAddress)
    this.stake = toBN(stakeInfo?.stake ?? '0')
    if (this.stake.eq(toBN(0))) {
      return this.stake
    }

    // first time getting stake, setting owner
    if (this.owner != null) {
      this.owner = stakeInfo?.owner
      debug(`Got staked for the first time. Owner: ${this.owner}. Stake: ${this.stake.toString()}`)
    }
    this.unstakeDelay = stakeInfo?.unstakeDelay
    this.withdrawBlock = stakeInfo?.withdrawBlock
    return this.stake
  }

  // noinspection JSUnusedGlobalSymbols
  _handleRelayRemovedEvent (dlog: any): void {
    // todo
    console.log('handle RelayRemoved event')
    // sanity checks
    if (dlog.name !== 'RelayRemoved' || dlog.args.relay.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    this.removed = true
    this.emit('removed')
  }

  async _handleHubAuthorizedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt | undefined> {
    if (dlog.name !== 'HubAuthorized' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    if (dlog.args.relayHub.toLowerCase() === this.relayHubContract?.address.toLowerCase()) {
      this.authorizedHub = true
    }

    return this._registerIfNeeded()
  }

  async _handleStakedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt | undefined> {
    // todo
    // sanity checks
    if (dlog.name !== 'StakeAdded' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    await this.refreshStake()

    return this._registerIfNeeded()
  }

  async _registerIfNeeded (): Promise<TransactionReceipt | undefined> {
    if (!this.authorizedHub || this.stake.eq(toBN(0))) {
      debug(`can't register yet: auth=${this.authorizedHub} stake=${this.stake.toString()}`)
      return
    }
    const workersAddedEvents = await this.relayHubContract?.contract.getPastEvents('RelayWorkersAdded', {
      fromBlock: 1,
      filter: { relayManager: this.managerAddress }
    })

    // add worker only if not already added
    if (workersAddedEvents.find((e: any) => e.returnValues.newRelayWorkers
      .map((a: string) => a.toLowerCase()).includes(this.getAddress(1).toLowerCase())) == null) {
      // register on chain
      const addRelayWorkerMethod = this.relayHubContract?.contract.methods
        .addRelayWorkers([this.getAddress(1)])
      await this._sendTransaction({
        signerIndex: 0,
        method: addRelayWorkerMethod,
        destination: this.relayHubContract?.address as string,
        value: '0x',
        gasLimit: 2e6.toString(),
        gasPrice: await this.web3.eth.getGasPrice()
      })
    }
    console.log('wtf after add workers')
    const registerMethod = this.relayHubContract?.contract.methods
      .registerRelayServer(this.baseRelayFee, this.pctRelayFee,
        this.url)
    const { receipt } = await this._sendTransaction({
      signerIndex: 0,
      method: registerMethod,
      destination: this.relayHubContract?.address as string,
      value: '0x',
      gasLimit: 1e6.toString(),
      gasPrice: await this.web3.eth.getGasPrice()
    })
    console.log('wtf after registerMethod')
    debug(`Relay ${this.managerAddress} registered on hub ${this.relayHubContract?.address}. `)

    this.isAddressAdded = true
    return receipt
  }

  async _handleUnstakedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt> {
    // todo: send balance to owner
    console.log('handle Unstaked event', dlog)
    // sanity checks
    if (dlog.name !== 'StakeUnlocked' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    this.balance = toBN(await this.web3.eth.getBalance(this.managerAddress))
    const gasPrice = await this.web3.eth.getGasPrice()
    const gasLimit = 21000
    console.log(`Sending balance ${this.balance.div(toBN(1e18)).toString()} to owner`)
    if (this.balance.lt(toBN(gasLimit * parseInt(gasPrice)))) {
      throw new Error(`balance too low: ${this.balance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    const { receipt } = await this._sendTransaction({
      signerIndex: 0,
      destination: this.owner as string,
      gasLimit: gasLimit.toString(),
      gasPrice,
      value: this.balance.sub(toBN(gasLimit * parseInt(gasPrice))).toString()
    })
    this.emit('unstaked')
    return receipt
  }

  /**
   * resend Txs of all signers (manager, workers)
   * @return the receipt from the first request
   */
  async _resendUnconfirmedTransactions (blockHeader: BlockHeader): Promise<TransactionReceipt | undefined> {
    // repeat separately for each signer (manager, all workers)
    for (const signerIndex of [0, 1]) {
      const receipt = await this._resendUnconfirmedTransactionsForSigner(blockHeader, signerIndex)
      if (receipt != null) {
        return receipt // TODO: should we early-return ?
      }
    }
  }

  async _resendUnconfirmedTransactionsForSigner (blockHeader: BlockHeader, signerIndex: number): Promise<TransactionReceipt | null> {
    const signer = this.getAddress(signerIndex)
    // Load unconfirmed transactions from store, and bail if there are none
    let sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return null
    }
    debug('resending unconfirmed transactions')
    // Get nonce at confirmationsNeeded blocks ago
    const confirmedBlock = blockHeader.number - confirmationsNeeded
    debug('signer, blockHeader, confirmedBlock', signer, blockHeader, confirmedBlock)
    let nonce = await this.web3.eth.getTransactionCount(signer, confirmedBlock)
    debug('nonce', nonce, confirmedBlock)
    debug(
      `resend ${signerIndex}: Removing confirmed txs until nonce ${nonce - 1}. confirmedBlock: ${confirmedBlock}. block number: ${blockHeader.number}`)
    // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
    await this.txStoreManager.removeTxsUntilNonce(signer, nonce - 1)

    // Load unconfirmed transactions from store again
    sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return null
    }
    // Check if the tx was mined by comparing its nonce against the latest one
    nonce = await this.web3.eth.getTransactionCount(signer)
    if (sortedTxs[0].nonce < nonce) {
      debug('resend', signerIndex, ': awaiting confirmations for next mined transaction', nonce, sortedTxs[0].nonce,
        sortedTxs[0].txId)
      return null
    }

    // If the tx is still pending, check how long ago we sent it, and resend it if needed
    if (Date.now() - (new Date(sortedTxs[0].createdAt)).getTime() < pendingTransactionTimeout) {
      spam(Date.now(), (new Date()), (new Date()).getTime())
      spam(sortedTxs[0].createdAt, (new Date(sortedTxs[0].createdAt)), (new Date(sortedTxs[0].createdAt)).getTime())
      debug('resend', signerIndex, ': awaiting transaction', sortedTxs[0].txId, 'to be mined. nonce:', nonce)
      return null
    }
    const { receipt } = await this._resendTransaction(sortedTxs[0])
    debug('resent transaction', sortedTxs[0].nonce, sortedTxs[0].txId, 'as',
      receipt.transactionHash)
    if (sortedTxs[0].attempts > 2) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      debug(`resend ${signerIndex}: Sent tx ${sortedTxs[0].attempts} times already`)
    }
    return receipt
  }

  // signerIndex is the index into addresses array. zero is relayManager, the rest are workers
  async _sendTransaction ({ signerIndex, method, destination, value = '0', gasLimit, gasPrice }: SendTransactionDetails): Promise<SignedTransactionDetails> {
    console.log('wtf fuck this fucking shit')
    const encodedCall = method?.encodeABI() ?? '0x'
    const _gasPrice = parseInt(gasPrice ?? await this.web3.eth.getGasPrice())
    debug('gasPrice', _gasPrice)
    debug('encodedCall', encodedCall)
    const gas = parseInt(gasLimit ?? await method?.estimateGas({ from: this.managerAddress }))
    debug('gasLimit', gas)
    debug('nonceMutex locked?', this.nonceMutex.isLocked())
    const releaseMutex = await this.nonceMutex.acquire()
    let signedTx
    let storedTx: StoredTx
    try {
      const nonce = await this._pollNonce(signerIndex)
      debug('nonce', nonce)
      // TODO: change to eip155 chainID
      const signer = this.getAddress(signerIndex)
      console.log('wtf params', value, gas, _gasPrice, encodedCall)
      const txToSign = new Transaction({
        to: destination,
        value: value,
        gasLimit: gas,
        gasPrice: _gasPrice,
        data: Buffer.from(encodedCall.slice(2), 'hex'),
        nonce
      }, this.rawTxOptions)
      spam('txToSign', txToSign)
      signedTx = this.keyManager.signTransaction(signer, txToSign)
      storedTx = transactionToStoredTx(txToSign, signer, this.chainId, 1)
      this.nonces[signerIndex]++
      await this.txStoreManager.putTx(storedTx, false)
    } finally {
      releaseMutex()
    }
    console.log('wtf before sendsigned', signedTx)
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx)
    console.log('\ntxhash is', receipt.transactionHash)
    if (receipt.transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${receipt.transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      receipt,
      signedTx
    }
  }

  async _resendTransaction (tx: StoredTx): Promise<SignedTransactionDetails> {
    // Calculate new gas price as a % increase over the previous one
    let newGasPrice = tx.gasPrice * retryGasPriceFactor
    // Sanity check to ensure we are not burning all our balance in gas fees
    if (newGasPrice > maxGasPrice) {
      debug('Capping gas price to max value of', maxGasPrice)
      newGasPrice = maxGasPrice
    }
    // Resend transaction with exactly the same values except for gas price
    const txToSign = new Transaction(
      {
        to: tx.to,
        gasLimit: tx.gas,
        gasPrice: newGasPrice,
        data: tx.data,
        nonce: tx.nonce
      },
      this.rawTxOptions)

    debug('txToSign', txToSign)
    // TODO: change to eip155 chainID
    const signedTx = this.keyManager.signTransaction(tx.from, txToSign)
    const storedTx = transactionToStoredTx(txToSign, tx.from, this.chainId, tx.attempts + 1)
    await this.txStoreManager.putTx(storedTx, true)

    debug('resending tx with nonce', txToSign.nonce, 'from', tx.from)
    debug('account nonce', await this.web3.eth.getTransactionCount(tx.from))
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx)
    console.log('\ntxhash is', receipt.transactionHash)
    if (receipt.transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${receipt.transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      receipt,
      signedTx
    }
  }

  async _pollNonce (signerIndex: number): Promise<number> {
    const signer = this.getAddress(signerIndex)
    const nonce = await this.web3.eth.getTransactionCount(signer, 'pending')
    if (nonce > this.nonces[signerIndex]) {
      debug('NONCE FIX for index=', signerIndex, 'signer=', signer, ': nonce=', nonce, this.nonces[signerIndex])
      this.nonces[signerIndex] = nonce
    }
    return nonce
  }

  _parseEvent (event: { events: any[], name: string, address: string } | null): any {
    if (event?.events === undefined) {
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
      return 'not event: ' + event
    }
    const args: Record<string, any> = {}
    // event arguments is for some weird reason give as ".events"
    for (const eventArgument of event.events) {
      args[eventArgument.name] = eventArgument.value
    }
    return {
      name: event.name,
      address: event.address,
      args: args
    }
  }
}
