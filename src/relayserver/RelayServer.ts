import { EventEmitter } from 'events'
import ow from 'ow'
// @ts-ignore
import abiDecoder from 'abi-decoder'

import { PrefixedHexString, Transaction, TransactionOptions } from 'ethereumjs-tx'

import RelayHubABI from '../common/interfaces/IRelayHub.json'
import PayMasterABI from '../common/interfaces/IPaymaster.json'
import StakeManagerABI from '../common/interfaces/IStakeManager.json'
import RelayRequest from '../common/EIP712/RelayRequest'
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
import { toBN, toHex } from 'web3-utils'
import { configureGSN } from '../relayclient/GSNConfigurator'
import { defaultEnvironment } from '../relayclient/types/Environments'
import VersionsManager from '../common/VersionsManager'
import { calculateTransactionMaxPossibleGas } from '../common/Utils'

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const mintxgascost = defaultEnvironment.mintxgascost

const VERSION = '0.9.2'
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
  // todo: gasLimit defined as "gas"
  gasLimit: PrefixedHexString
  gasPrice: PrefixedHexString
  // todo: encodedFunction defined as "data"
  approvalData: PrefixedHexString
  signature: PrefixedHexString
  senderNonce: IntString
  relayMaxNonce: IntString
  baseRelayFee: IntString
  pctRelayFee: IntString
  relayHubAddress: Address
  paymaster: Address
  forwarder: Address
}

interface SendTransactionDetails {
  signerIndex: number
  method?: any
  destination: Address
  value?: IntString
  gasLimit?: IntString
  gasPrice?: IntString
}

export interface RelayServerParams {
  readonly txStoreManager: TxStoreManager
  readonly web3provider: provider
  readonly keyManager: KeyManager
  readonly contractInteractor: ContractInteractor
  readonly hubAddress: Address
  readonly trustedPaymasters?: Address[]
  readonly baseRelayFee: number | undefined
  readonly pctRelayFee: number | undefined
  readonly gasPriceFactor: number
  readonly url?: string
  readonly workerMinBalance: number | undefined // = defaultWorkerMinBalance,
  readonly workerTargetBalance: number | undefined // = defaultWorkerTargetBalance,
  readonly devMode: boolean // = false,
  readonly debug: boolean // = false,
}

export class RelayServer extends EventEmitter {
  lastScannedBlock = 0
  ready = false
  removed = false
  nonceMutex = new Mutex()
  readonly nonces: Record<number, number> = {}
  private readonly managerAddress: PrefixedHexString
  gasPrice: number = 0
  private relayHubContract: IRelayHubInstance | undefined
  private paymasterContract: IPaymasterInstance | undefined
  chainId!: number
  rawTxOptions: TransactionOptions | undefined
  private _workerSemaphoreOn = false
  private stakeManagerContract: IStakeManagerInstance | undefined
  private topics: string[][] | undefined
  networkId: number | undefined
  private initialized = false
  stake = toBN(0)
  private isAddressAdded = false
  lastError: string | undefined
  owner: Address | undefined
  private unstakeDelay: BN | undefined | string
  private withdrawBlock: BN | undefined | string
  private authorizedHub = false
  readonly txStoreManager: TxStoreManager
  private readonly web3provider: provider
  readonly keyManager: KeyManager
  private readonly contractInteractor: ContractInteractor
  private readonly versionManager: VersionsManager
  readonly hubAddress: Address
  readonly trustedPaymasters: Address[]
  readonly baseRelayFee: number
  readonly pctRelayFee: number
  readonly gasPriceFactor: number
  readonly url: string
  readonly workerMinBalance: number
  readonly workerTargetBalance: number
  private readonly devMode: boolean
  private workerTask: any

  constructor (params: RelayServerParams) {
    super()
    this.versionManager = new VersionsManager()
    this.txStoreManager = params.txStoreManager
    this.web3provider = params.web3provider
    this.keyManager = params.keyManager
    this.hubAddress = params.hubAddress
    this.trustedPaymasters = params.trustedPaymasters?.map(e => e.toLowerCase()) ?? []
    this.baseRelayFee = params.baseRelayFee ?? 0
    this.pctRelayFee = params.pctRelayFee ?? 0
    this.gasPriceFactor = params.gasPriceFactor
    this.url = params.url ?? 'http://localhost:8090'
    this.workerMinBalance = params.workerMinBalance ?? defaultWorkerMinBalance
    this.workerTargetBalance = params.workerTargetBalance ?? defaultWorkerTargetBalance
    this.devMode = params.devMode
    this.contractInteractor = params.contractInteractor ?? new ContractInteractor(this.web3provider,
      configureGSN({}))

    DEBUG = params.debug

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

  async createRelayTransaction (req: CreateTransactionDetails): Promise<PrefixedHexString> {
    debug('dump request params', arguments[0])
    ow(req.data, ow.string)
    ow(req.approvalData, ow.string)
    ow(req.signature, ow.string)

    // Check that the relayHub is the correct one
    if (req.relayHubAddress !== this.relayHubContract?.address) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract?.address}, request's hub address: ${req.relayHubAddress}\n`)
    }

    // if trusted paymaster, we trust it to handle fees
    if (!this.trustedPaymasters.includes(req.paymaster.toLowerCase())) {
      // Check that the fee is acceptable
      if (isNaN(parseInt(req.pctRelayFee)) || parseInt(req.pctRelayFee) < this.pctRelayFee) {
        throw new Error(`Unacceptable pctRelayFee: ${req.pctRelayFee} relayServer's pctRelayFee: ${this.pctRelayFee}`)
      }
      if (isNaN(parseInt(req.baseRelayFee)) || parseInt(req.baseRelayFee) < this.baseRelayFee) {
        throw new Error(`Unacceptable baseRelayFee: ${req.baseRelayFee} relayServer's baseRelayFee: ${this.baseRelayFee}`)
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
    // TODO: currently we hard-code a single worker. should find a "free" one to use from a pool
    const workerIndex = 1

    // TODO: should replenish earlier, so client can validate the worker has funds to pay for the tx
    await this.replenishWorker(1)

    // Check that max nonce is valid
    const nonce = await this._pollNonce(workerIndex)
    if (nonce > parseInt(req.relayMaxNonce)) {
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
        value: '0'
      },
      relayData: {
        baseRelayFee: req.baseRelayFee,
        pctRelayFee: req.pctRelayFee,
        gasPrice: req.gasPrice,
        paymaster: req.paymaster,
        forwarder: req.forwarder,
        relayWorker: this.getAddress(1)
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
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        e.message.includes(
          'Returned values aren\'t valid, did it run Out of Gas?'
        )
      ) {
        throw new Error(`non-existent or incompatible paymaster contract: ${req.paymaster}`)
      }
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`unknown paymaster error: ${e.message}`)
    }

    const hubOverhead = (await this.relayHubContract.getHubOverhead()).toNumber()
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    const maxPossibleGas = GAS_RESERVE + calculateTransactionMaxPossibleGas({
      gasLimits,
      hubOverhead,
      relayCallGasLimit: req.gasLimit
    })
    const method = this.relayHubContract.contract.methods.relayCall(relayRequest, req.signature, req.approvalData, maxPossibleGas)
    let viewRelayCallRet: { paymasterAccepted: boolean, returnValue: string }
    try {
      viewRelayCallRet = await this.relayHubContract.contract.methods.relayCall(
        relayRequest,
        req.signature,
        req.approvalData,
        maxPossibleGas)
        .call({
          from: this.getAddress(workerIndex),
          gasPrice: relayRequest.relayData.gasPrice,
          gasLimit: maxPossibleGas
        })
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`relayCall reverted in server: ${e.message}`)
    }
    debug('viewRelayCallRet', viewRelayCallRet)
    if (!viewRelayCallRet.paymasterAccepted) {
      throw new Error(`Paymaster rejected in server: ${viewRelayCallRet.returnValue}`)
    }
    // Send relayed transaction
    debug('maxPossibleGas is', typeof maxPossibleGas, maxPossibleGas)

    const maxCharge =
      // @ts-ignore
      await this.relayHubContract.calculateCharge(maxPossibleGas, {
        gasPrice: req.gasPrice?.toString() ?? '0',
        pctRelayFee: req.pctRelayFee.toString(),
        baseRelayFee: req.baseRelayFee.toString(),
        relayWorker: this.getAddress(1), // TODO: use relayWorker from clietn's request..
        forwarder: req.forwarder,
        paymaster: req.paymaster
      })
    const paymasterBalance = await this.relayHubContract.balanceOf(req.paymaster)
    if (paymasterBalance.lt(maxCharge)) {
      throw new Error(`paymaster balance too low: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    }
    console.log(`paymaster balance: ${paymasterBalance.toString()}, maxCharge: ${maxCharge.toString()}`)
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    console.log(`Estimated max charge of relayed tx: ${maxCharge.toString()}, GasLimit of relayed tx: ${maxPossibleGas}`)
    const { signedTx } = await this._sendTransaction(
      {
        signerIndex: workerIndex,
        method,
        destination: req.relayHubAddress,
        gasLimit: maxPossibleGas.toString(),
        gasPrice: req.gasPrice
      })
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishWorker(1)
    return signedTx
  }

  start (): void {
    debug('Polling new blocks')

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
    clearInterval(this.workerTask)
    console.log('Successfully stopped polling!!')
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
    await this.contractInteractor._init()
    this.relayHubContract = await this.contractInteractor._createRelayHub(this.hubAddress)
    const relayHubAddress = this.relayHubContract.address
    console.log('Server address', this.managerAddress)
    const code = await this.contractInteractor.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    } else {
      debug('code length', code.length)
    }
    const version = await this.relayHubContract.versionHub().catch(_ => 'no getVersion() method')
    if (!this.versionManager.isHubVersionSupported(version)) {
      this.fatal(`Not a valid RelayHub at ${relayHubAddress}: version: ${version}`)
    }
    const stakeManagerAddress = await this.relayHubContract.getStakeManager()
    this.stakeManagerContract = await this.contractInteractor._createStakeManager(stakeManagerAddress)
    const stakeManagerTopics = [Object.keys(this.stakeManagerContract.contract.events).filter(x => (x.includes('0x')))]
    this.topics = stakeManagerTopics.concat([['0x' + '0'.repeat(24) + this.managerAddress.slice(2)]])

    this.chainId = await this.contractInteractor.getChainId()
    this.networkId = await this.contractInteractor.getNetworkId()
    if (this.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }
    this.rawTxOptions = this.contractInteractor.getRawTxOptions()

    // todo: fix typo AND fix metacoin
    // console.log('intialized', this.chainId, this.networkId, this.rawTxOptions)
    this.initialized = true
  }

  async replenishWorker (workerIndex: number): Promise<void> {
    const workerAddress = this.getAddress(workerIndex)
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (workerBalance.lt(toBN(this.workerMinBalance))) {
      const refill = toBN(this.workerTargetBalance).sub(workerBalance)
      const balance = await this.getManagerBalance()
      const managerHubBalance = await this.relayHubContract?.balanceOf(this.managerAddress) ?? toBN(0)
      console.log(
        `== replenishWorker(${workerIndex}): mgr balance=${balance.div(
          toBN(1e18)).toString()}  manager hub balance=${managerHubBalance.div(toBN(1e18)).toString()} 
          worker balance=${workerBalance.div(
          toBN(1e18)).toString()} refill=${refill.div(toBN(1e18)).toString()}`)
      if (refill.lt(managerHubBalance.sub(toBN(minimumRelayBalance)))) {
        const method = this.relayHubContract?.contract.methods.withdraw(toHex(refill), workerAddress)
        await this._sendTransaction({
          signerIndex: 0,
          destination: this.relayHubContract?.address as string,
          method
        })
      } else if (refill.lt(balance.sub(toBN(minimumRelayBalance)))) {
        await this._sendTransaction({
          signerIndex: 0,
          destination: workerAddress,
          value: toHex(refill),
          gasLimit: mintxgascost.toString()
        })
      } else {
        const message = `== replenishWorker: can't replenish: mgr balance too low ${balance.div(toBN(1e18)).toString()} refill=${refill.div(
          toBN(1e18)).toString()}`
        this.emit('fundingNeeded', message)
        console.log(message)
      }
    }
  }

  async _worker (blockHeader: BlockHeader): Promise<TransactionReceipt[]> {
    if (!this.initialized) {
      await this._init()
    }
    const gasPriceString = await this.contractInteractor.getGasPrice()
    this.gasPrice = Math.floor(parseInt(gasPriceString) * this.gasPriceFactor)
    if (this.gasPrice === 0) {
      throw new StateError('Could not get gasPrice from node')
    }
    const balance = await this.getManagerBalance()
    if (balance.lt(toBN(minimumRelayBalance))) {
      throw new StateError(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Server's balance too low ( ${balance}, required ${minimumRelayBalance}). Waiting for funding...`)
    }
    const options = {
      fromBlock: this.lastScannedBlock + 1,
      toBlock: 'latest',
      address: this.stakeManagerContract?.address,
      topics: this.topics
    }
    const logs = await this.contractInteractor.getPastLogs(options)
    spam('logs?', logs)
    spam('options? ', options)
    const decodedLogs = abiDecoder.decodeLogs(logs).map(this._parseEvent)
    let receipts: TransactionReceipt[] = []
    // TODO: what about 'penalize' events? should send balance to owner, I assume
    // TODO TODO TODO 'StakeAdded' is not the event you want to cat upon if there was no 'HubAuthorized' event
    for (const dlog of decodedLogs) {
      switch (dlog.name) {
        case 'HubAuthorized':
          receipts = receipts.concat(await this._handleHubAuthorizedEvent(dlog))
          break
        case 'StakeAdded':
          receipts = receipts.concat(await this._handleStakedEvent(dlog))
          break
        // There is no such event now
        // case 'RelayRemoved':
        //   await this._handleRelayRemovedEvent(dlog)
        //   break
        case 'StakeUnlocked':
          receipts = receipts.concat(await this._handleUnstakedEvent(dlog))
          break
      }
    }

    if (this.stake.eq(toBN(0))) {
      throw new StateError('Waiting for stake')
    }
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
    return receipts
  }

  async getManagerBalance (): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.managerAddress))
  }

  async getWorkerBalance (workerIndex: number): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.getAddress(workerIndex)))
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
    if (this.owner == null) {
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

  async _handleHubAuthorizedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt[]> {
    if (dlog.name !== 'HubAuthorized' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    if (dlog.args.relayHub.toLowerCase() === this.relayHubContract?.address.toLowerCase()) {
      this.authorizedHub = true
    }

    return this._registerIfNeeded()
  }

  async _handleStakedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt[]> {
    // todo
    // sanity checks
    if (dlog.name !== 'StakeAdded' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    await this.refreshStake()

    return this._registerIfNeeded()
  }

  async _registerIfNeeded (): Promise<TransactionReceipt[]> {
    let receipts: TransactionReceipt[] = []
    if (!this.authorizedHub || this.stake.eq(toBN(0))) {
      debug(`can't register yet: auth=${this.authorizedHub} stake=${this.stake.toString()}`)
      return receipts
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
      receipts = receipts.concat((await this._sendTransaction({
        signerIndex: 0,
        method: addRelayWorkerMethod,
        destination: this.relayHubContract?.address as string
      })).receipt)
    }
    const relayRegisteredEvents = await this.relayHubContract?.contract.getPastEvents('RelayServerRegistered', {
      fromBlock: 1,
      filter: { relayManager: this.managerAddress }
    })
    if (relayRegisteredEvents.find(
      (e: any) =>
        e.returnValues.relayManager.toLowerCase() === this.managerAddress.toLowerCase() &&
        e.returnValues.baseRelayFee.toString() === this.baseRelayFee.toString() &&
        e.returnValues.pctRelayFee.toString() === this.pctRelayFee.toString() &&
        e.returnValues.relayUrl.toString() === this.url.toString()) == null) {
      const registerMethod = this.relayHubContract?.contract.methods
        .registerRelayServer(this.baseRelayFee, this.pctRelayFee,
          this.url)
      receipts = receipts.concat((await this._sendTransaction({
        signerIndex: 0,
        method: registerMethod,
        destination: this.relayHubContract?.address as string
      })).receipt)
      debug(`Relay ${this.managerAddress} registered on hub ${this.relayHubContract?.address}. `)
    }
    this.isAddressAdded = true
    return receipts
  }

  async _handleUnstakedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt[]> {
    console.log('handle Unstaked event', dlog)
    // sanity checks
    if (dlog.name !== 'StakeUnlocked' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    const receipts: TransactionReceipt[] = []
    const managerHubBalance = await this.relayHubContract?.balanceOf(this.managerAddress) ?? toBN(0)
    const gasPrice = await this.contractInteractor.getGasPrice()
    const method = this.relayHubContract?.contract.methods.withdraw(toHex(managerHubBalance), this.owner)
    const withdrawTxGasLimit = await method.estimateGas(
      { from: this.getManagerAddress() })
    const withdrawTxCost = toBN(withdrawTxGasLimit * parseInt(gasPrice))
    // sending manager hub balance to owner
    if (managerHubBalance.gte(withdrawTxCost)) {
      console.log(`Sending manager hub balance ${managerHubBalance.toString()} to owner`)
      receipts.push((await this._sendTransaction({
        signerIndex: 0,
        destination: this.relayHubContract?.address as string,
        method
      })).receipt)
    } else {
      console.log(`manager hub balance too low: ${managerHubBalance.toString()}, tx cost: ${withdrawTxCost.toString()}`)
    }

    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit * parseInt(gasPrice))

    const managerBalance = await this.getManagerBalance()
    // sending manager eth balance to owner
    if (managerBalance.gte(txCost)) {
      console.log(`Sending manager eth balance ${managerBalance.toString()} to owner`)
      receipts.push((await this._sendTransaction({
        signerIndex: 0,
        destination: this.owner as string,
        gasLimit: gasLimit.toString(),
        gasPrice,
        value: toHex(managerBalance.sub(txCost))
      })).receipt)
    } else {
      console.log(`manager balance too low: ${managerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }

    // sending workers' balance to owner (currently one worker, todo: extend to multiple)
    const workerBalance = await this.getWorkerBalance(1)
    if (workerBalance.gte(txCost)) {
      console.log(`Sending workers' eth balance ${workerBalance.toString()} to owner`)
      receipts.push((await this._sendTransaction({
        signerIndex: 1,
        destination: this.owner as string,
        gasLimit: gasLimit.toString(),
        gasPrice,
        value: toHex(workerBalance.sub(txCost))
      })).receipt)
    } else {
      console.log(`balance too low: ${workerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }

    this.emit('unstaked')
    return receipts
  }

  /**
   * resend Txs of all signers (manager, workers)
   * @return the receipt from the first request
   */
  async _resendUnconfirmedTransactions (blockHeader: BlockHeader): Promise<PrefixedHexString | undefined> {
    // repeat separately for each signer (manager, all workers)
    for (const signerIndex of [0, 1]) {
      const receipt = await this._resendUnconfirmedTransactionsForSigner(blockHeader, signerIndex)
      if (receipt != null) {
        return receipt // TODO: should we early-return ?
      }
    }
  }

  async _resendUnconfirmedTransactionsForSigner (blockHeader: BlockHeader, signerIndex: number): Promise<PrefixedHexString | null> {
    const signer = this.getAddress(signerIndex)
    // Load unconfirmed transactions from store, and bail if there are none
    let sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return null
    }
    debug('resending unconfirmed transactions')
    // Get nonce at confirmationsNeeded blocks ago
    for (const transaction of sortedTxs) {
      const receipt = await this.contractInteractor.getTransaction(transaction.txId)
      if (receipt == null) {
        // I believe this means this transaction was not confirmed
        continue
      }
      if (receipt.blockNumber == null) {
        throw new Error(`invalid block number in receipt ${receipt.toString()}`)
      }
      const txBlockNumber = receipt.blockNumber
      const confirmations = blockHeader.number - txBlockNumber
      if (confirmations >= confirmationsNeeded) {
        // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
        debug(`removing tx number ${receipt.nonce} sent by ${receipt.from} with ${confirmations} confirmations`)
        await this.txStoreManager.removeTxsUntilNonce(
          receipt.from,
          receipt.nonce
        )
      }
    }

    // Load unconfirmed transactions from store again
    sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return null
    }
    // Check if the tx was mined by comparing its nonce against the latest one
    const nonce = await this.contractInteractor.getTransactionCount(signer)
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
    const { receipt, signedTx } = await this._resendTransaction(sortedTxs[0])
    debug('resent transaction', sortedTxs[0].nonce, sortedTxs[0].txId, 'as',
      receipt.transactionHash)
    if (sortedTxs[0].attempts > 2) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      debug(`resend ${signerIndex}: Sent tx ${sortedTxs[0].attempts} times already`)
    }
    return signedTx
  }

  // signerIndex is the index into addresses array. zero is relayManager, the rest are workers
  async _sendTransaction ({ signerIndex, method, destination, value = '0x', gasLimit, gasPrice }: SendTransactionDetails): Promise<SignedTransactionDetails> {
    const encodedCall = method?.encodeABI() ?? '0x'
    const _gasPrice = parseInt(gasPrice ?? await this.contractInteractor.getGasPrice())
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
      const signer = this.getAddress(signerIndex)
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
    const receipt = await this.contractInteractor.sendSignedTransaction(signedTx)
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
    debug('account nonce', await this.contractInteractor.getTransactionCount(tx.from))
    const receipt = await this.contractInteractor.sendSignedTransaction(signedTx)
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
    const nonce = await this.contractInteractor.getTransactionCount(signer, 'pending')
    if (nonce > this.nonces[signerIndex]) {
      debug('NONCE FIX for index=', signerIndex, 'signer=', signer, ': nonce=', nonce, this.nonces[signerIndex])
      this.nonces[signerIndex] = nonce
    }
    return nonce
  }

  _parseEvent (event: { events: any[], name: string, address: string } | null): any {
    if (event?.events === undefined) {
      return `not event: ${event?.toString()}`
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

  timeUnit (): number {
    if (this.devMode) {
      return 10
    }
    return 1000
  }
}
