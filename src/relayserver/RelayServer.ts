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
import TmpRelayTransactionJsonRequest from '../relayclient/types/TmpRelayTransactionJsonRequest'
import { IPaymasterInstance, IRelayHubInstance, IStakeManagerInstance } from '../../types/truffle-contracts'
import { BlockHeader } from 'web3-eth'
import { Log, TransactionReceipt } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import { defaultEnvironment } from '../common/Environments'
import VersionsManager from '../common/VersionsManager'
import { calculateTransactionMaxPossibleGas, decodeRevertReason, address2topic } from '../common/Utils'
import { constants } from '../common/Constants'

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const mintxgascost = defaultEnvironment.mintxgascost

const VERSION = '2.0.0-beta.1'
const defaultMinHubWithdrawalBalance = 0.1e18
const defaultManagerMinBalance = 0.1e18 // 0.1 eth
const defaultManagerTargetBalance = 0.3e18
const defaultWorkerMinBalance = 0.1e18
const defaultWorkerTargetBalance = 0.3e18
const defaultAlertedBlockDelay = 6000
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

export interface SignedTransactionDetails {
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

export type CreateTransactionDetails = TmpRelayTransactionJsonRequest

export interface SendTransactionDetails {
  signer: Address
  method?: any
  destination: Address
  value?: IntString
  gasLimit?: IntString
  gasPrice?: IntString
}

export interface RelayServerParams {
  readonly txStoreManager: TxStoreManager
  readonly workersKeyManager: KeyManager
  // TODO: rename as this name is terrible
  readonly managerKeyManager: KeyManager
  readonly contractInteractor: ContractInteractor
  readonly hubAddress: Address
  readonly trustedPaymasters?: Address[]
  readonly baseRelayFee: number | undefined
  readonly pctRelayFee: number | undefined
  readonly gasPriceFactor: number
  readonly registrationBlockRate?: number
  readonly url?: string
  readonly workerMinBalance: number | undefined // = defaultWorkerMinBalance,
  readonly workerTargetBalance: number | undefined // = defaultWorkerTargetBalance,
  readonly managerMinBalance: number | undefined // = defaultManagerMinBalance,
  readonly managerTargetBalance: number | undefined // = defaultManagerTargetBalance,
  readonly minHubWithdrawalBalance: number | undefined // = defaultMinHubWithdrawalBalance,
  readonly devMode: boolean // = false,
  readonly debug: boolean // = false,
}

export class RelayServer extends EventEmitter {
  lastScannedBlock = 0
  ready = false
  alerted = false
  alertedBlock: number = 0
  nonceMutex = new Mutex()
  readonly nonces: Record<Address, number> = {}
  private readonly managerAddress: PrefixedHexString
  gasPrice: number = 0
  private relayHubContract: IRelayHubInstance | undefined
  private paymasterContract: IPaymasterInstance | undefined
  chainId!: number
  rawTxOptions: TransactionOptions | undefined
  private _workerSemaphoreOn = false
  private stakeManagerContract: IStakeManagerInstance | undefined
  private smTopics: string[][] | undefined
  private rhTopics: string[][] | undefined
  networkId: number | undefined
  private initialized = false
  stake = toBN(0)
  lastError: string | undefined
  owner: Address | undefined
  unstakeDelay: BN | undefined
  withdrawBlock: BN | undefined
  authorizedHub = false
  readonly txStoreManager: TxStoreManager
  readonly managerKeyManager: KeyManager
  readonly workersKeyManager: KeyManager
  private readonly contractInteractor: ContractInteractor
  private readonly versionManager: VersionsManager
  readonly hubAddress: Address
  readonly trustedPaymasters: Address[]
  readonly baseRelayFee: number
  readonly pctRelayFee: number
  readonly gasPriceFactor: number
  readonly registrationBlockRate?: number
  readonly url: string
  readonly workerMinBalance: number
  readonly workerTargetBalance: number
  readonly managerMinBalance: number
  readonly managerTargetBalance: number
  readonly minHubWithdrawalBalance: number
  private readonly devMode: boolean
  private workerTask: any

  constructor (params: RelayServerParams) {
    super()
    this.versionManager = new VersionsManager(VERSION)
    this.txStoreManager = params.txStoreManager
    this.workersKeyManager = params.workersKeyManager
    this.managerKeyManager = params.managerKeyManager
    this.hubAddress = params.hubAddress
    this.trustedPaymasters = params.trustedPaymasters?.map(e => e.toLowerCase()) ?? []
    this.baseRelayFee = params.baseRelayFee ?? 0
    this.pctRelayFee = params.pctRelayFee ?? 0
    this.gasPriceFactor = params.gasPriceFactor
    this.registrationBlockRate = params.registrationBlockRate
    this.url = params.url ?? 'http://localhost:8090'
    this.workerMinBalance = params.workerMinBalance ?? defaultWorkerMinBalance
    this.workerTargetBalance = params.workerTargetBalance ?? defaultWorkerTargetBalance
    this.managerMinBalance = params.managerMinBalance ?? defaultManagerMinBalance
    this.managerTargetBalance = params.managerTargetBalance ?? defaultManagerTargetBalance
    this.minHubWithdrawalBalance = params.minHubWithdrawalBalance ?? defaultMinHubWithdrawalBalance
    this.devMode = params.devMode
    this.contractInteractor = params.contractInteractor

    DEBUG = params.debug

    this.managerAddress = this.managerKeyManager.getAddress(0)

    // todo: initialize nonces for all signers (currently one manager, one worker)
    this.nonces = {}
    this.nonces[this.managerKeyManager.getAddress(0)] = 0
    this.nonces[this.workersKeyManager.getAddress(0)] = 0

    debug('gasPriceFactor', this.gasPriceFactor)
  }

  getManagerAddress (): PrefixedHexString {
    return this.managerAddress
  }

  getWorkerAddress (index: number): PrefixedHexString {
    ow(index, ow.number)
    return this.workersKeyManager.getAddress(index)
  }

  getMinGasPrice (): number {
    return this.gasPrice
  }

  isReady (): boolean {
    return this.ready
  }

  pingHandler (): PingResponse {
    return {
      RelayServerAddress: this.getWorkerAddress(0),
      RelayManagerAddress: this.managerAddress,
      RelayHubAddress: this.relayHubContract?.address ?? '',
      MinGasPrice: this.getMinGasPrice().toString(),
      Ready: this.isReady(),
      Version: VERSION
    }
  }

  async createRelayTransaction (req: CreateTransactionDetails): Promise<PrefixedHexString | undefined> {
    debug('dump request params', arguments[0])
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
    if (req.relayWorker.toLowerCase() !== this.getWorkerAddress(workerIndex).toLowerCase()) {
      throw new Error(
        `Wrong worker address: ${req.relayWorker}\n`)
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

    // Check that max nonce is valid
    const nonce = await this._pollNonce(this.getWorkerAddress(workerIndex))
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
        relayWorker: this.getWorkerAddress(workerIndex)
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
    const method = this.relayHubContract.contract.methods.relayCall(
      relayRequest, req.signature, req.approvalData, maxPossibleGas)
    let viewRelayCallRet: { paymasterAccepted: boolean, returnValue: string }
    try {
      viewRelayCallRet = await method.call({
        from: this.getWorkerAddress(workerIndex),
        gasPrice: relayRequest.relayData.gasPrice,
        gasLimit: maxPossibleGas
      })
    } catch (e) {
      throw new Error(`relayCall reverted in server: ${(e as Error).message}`)
    }
    debug('viewRelayCallRet', viewRelayCallRet)
    if (!viewRelayCallRet.paymasterAccepted) {
      throw new Error(
        `Paymaster rejected in server: ${decodeRevertReason(viewRelayCallRet.returnValue)} req=${JSON.stringify(relayRequest, null, 2)}`)
    }
    // Send relayed transaction
    debug('maxPossibleGas is', typeof maxPossibleGas, maxPossibleGas)

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
    const { signedTx } = await this._sendTransaction(
      {
        signer: this.getWorkerAddress(workerIndex),
        method,
        destination: req.relayHubAddress,
        gasLimit: maxPossibleGas.toString(),
        gasPrice: req.gasPrice
      })
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishServer(workerIndex)
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
    if (!this.versionManager.isMinorSameOrNewer(version)) {
      this.fatal(`Not a valid RelayHub at ${relayHubAddress}: version: ${version}`)
    }
    const stakeManagerAddress = await this.relayHubContract.stakeManager()
    this.stakeManagerContract = await this.contractInteractor._createStakeManager(stakeManagerAddress)
    const stakeManagerTopics = [Object.keys(this.stakeManagerContract.contract.events).filter(x => (x.includes('0x')))]
    this.smTopics = stakeManagerTopics.concat([[address2topic(this.managerAddress)]])
    const relayHubTopics = [Object.keys(this.relayHubContract.contract.events).filter(x => (x.includes('0x')))]
    this.rhTopics = relayHubTopics.concat([[address2topic(this.managerAddress)]])
    this.chainId = await this.contractInteractor.getChainId()
    this.networkId = await this.contractInteractor.getNetworkId()
    if (this.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }
    this.rawTxOptions = this.contractInteractor.getRawTxOptions()

    debug('initialized', this.chainId, this.networkId, this.rawTxOptions)
    this.initialized = true
  }

  async replenishServer (workerIndex: number): Promise<TransactionReceipt[]> {
    const receipts: TransactionReceipt[] = []
    let managerEthBalance = await this.getManagerBalance()
    const managerHubBalance = await this.relayHubContract?.balanceOf(this.managerAddress) ?? toBN(0)
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (managerEthBalance.gte(toBN(this.managerTargetBalance.toString())) && workerBalance.gte(toBN(this.workerMinBalance.toString()))) {
      // all filled, nothing to do
      return receipts
    }
    if (managerEthBalance.lt(toBN(this.managerTargetBalance.toString())) && managerHubBalance.gte(toBN(this.minHubWithdrawalBalance))) {
      console.log(`withdrawing manager hub balance (${managerHubBalance.toString()}) to manager`)
      // Refill manager eth balance from hub balance
      const method = this.relayHubContract?.contract.methods.withdraw(toHex(managerHubBalance), this.getManagerAddress())
      receipts.push((await this._sendTransaction({
        signer: this.getManagerAddress(),
        destination: this.relayHubContract?.address as string,
        method
      })).receipt)
    }
    managerEthBalance = await this.getManagerBalance()
    const workerAddress = this.getWorkerAddress(workerIndex)
    if (workerBalance.lt(toBN(this.workerMinBalance.toString()))) {
      const refill = toBN(this.workerTargetBalance.toString()).sub(workerBalance)
      console.log(
        `== replenishServer: mgr balance=${managerEthBalance.toString()}  manager hub balance=${managerHubBalance.toString()} 
          worker balance=${workerBalance.toString()} refill=${refill.toString()}`)
      if (refill.lt(managerEthBalance.sub(toBN(this.managerMinBalance)))) {
        console.log('Replenishing worker balance by manager eth balance')
        receipts.push((await this._sendTransaction({
          signer: this.getManagerAddress(),
          destination: workerAddress,
          value: toHex(refill),
          gasLimit: mintxgascost.toString()
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
      await this._init()
    }
    const gasPriceString = await this.contractInteractor.getGasPrice()
    this.gasPrice = Math.floor(parseInt(gasPriceString) * this.gasPriceFactor)
    if (this.gasPrice === 0) {
      throw new StateError('Could not get gasPrice from node')
    }
    const balance = await this.getManagerBalance()
    if (balance.lt(toBN(this.managerMinBalance))) {
      throw new StateError(
        `Server's balance too low ( ${balance.toString()}, required ${this.managerMinBalance}). Waiting for funding...`)
    }
    let receipts = await this._handlePastEvents(blockHeader)
    await this._resendUnconfirmedTransactions(blockHeader)
    if (this.stake.eq(toBN(0))) {
      throw new StateError('Waiting for stake')
    }

    const registeredBlock = await this._getRegistrationBlock()
    if (registeredBlock === 0) {
      throw new StateError('Not registered yet...')
    }
    if (!this.authorizedHub) {
      this.emit('error', new Error('Hub not authorized...'))
      this.ready = false
      return receipts
    }
    const workerIndex = 0
    receipts = receipts.concat(await this.replenishServer(workerIndex))
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (workerBalance.lt(toBN(this.workerMinBalance))) {
      this.emit('error', new Error('workers not funded...'))
      this.ready = false
      return receipts
    }
    if (!this.ready) {
      console.log('Relay is Ready.')
    }
    this.ready = true
    if (this.alerted && this.alertedBlock + defaultAlertedBlockDelay < blockHeader.number) {
      console.log('Relay exited alerted state')
      this.alerted = false
    }
    delete this.lastError
    receipts = receipts.concat(await this._registerIfNeeded())
    return receipts
  }

  async getManagerBalance (): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.managerAddress))
  }

  async getWorkerBalance (workerIndex: number): Promise<BN> {
    return toBN(await this.contractInteractor.getBalance(this.getWorkerAddress(workerIndex)))
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
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      debug(`Got staked for the first time. Owner: ${this.owner}. Stake: ${this.stake.toString()}`)
    }
    this.unstakeDelay = toBN(stakeInfo?.unstakeDelay ?? '0')
    this.withdrawBlock = toBN(stakeInfo?.withdrawBlock ?? '0')
    return this.stake
  }

  async _getContractLogs (address: string | undefined, topics: string[][] | undefined): Promise<Log[]> {
    const options = {
      fromBlock: this.lastScannedBlock,
      toBlock: 'latest',
      address: address,
      topics: topics
    }
    spam('options? ', options)
    return await this.contractInteractor.getPastLogs(options)
  }

  async _handlePastEvents (blockHeader: BlockHeader): Promise<TransactionReceipt[]> {
    const smLogs = await this._getContractLogs(this.stakeManagerContract?.address, this.smTopics)
    const rhLogs = await this._getContractLogs(this.relayHubContract?.address, this.rhTopics)
    spam('logs?', smLogs, rhLogs)
    let decodedLogs = abiDecoder.decodeLogs(smLogs).map(this._parseEvent)
    decodedLogs = decodedLogs.concat(abiDecoder.decodeLogs(rhLogs).map(this._parseEvent))
    spam('decodedLogs?', decodedLogs, this.lastScannedBlock)
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
        case 'HubUnauthorized':
          receipts = receipts.concat(await this._handleHubUnauthorizedEvent(dlog))
          break
        case 'StakeUnlocked':
          receipts = receipts.concat(await this._handleUnstakedEvent(dlog))
          break
        case 'TransactionRejectedByPaymaster':
          console.log('wtf fuccccccck')
          await this._handleTransactionRejectedByPaymasterEvent(dlog, blockHeader.number)
          break
      }
    }
    this.lastScannedBlock = blockHeader.number
    return receipts
  }

  async _handleHubAuthorizedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt[]> {
    if (dlog.name !== 'HubAuthorized' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relayManager}`)
    }
    if (dlog.args.relayHub.toLowerCase() === this.relayHubContract?.address.toLowerCase()) {
      this.authorizedHub = true
    }

    return await this._registerIfNeeded()
  }

  async _handleHubUnauthorizedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt[]> {
    if (dlog.name !== 'HubUnauthorized' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relayManager}`)
    }
    if (dlog.args.relayHub.toLowerCase() === this.relayHubContract?.address.toLowerCase()) {
      this.authorizedHub = false
    }
    const gasPrice = await this.contractInteractor.getGasPrice()
    let receipts: TransactionReceipt[] = []
    receipts = receipts.concat(await this._sendWorkersEthBalancesToOwner(gasPrice)).concat(
      await this._sendManagerHubBalanceToOwner(gasPrice))
    return receipts
  }

  async _handleStakedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt[]> {
    // sanity checks
    if (dlog.name !== 'StakeAdded' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relayManager}`)
    }
    await this.refreshStake()

    return await this._registerIfNeeded()
  }

  async _registerIfNeeded (): Promise<TransactionReceipt[]> {
    let receipts: TransactionReceipt[] = []
    if (!this.authorizedHub || this.stake.eq(toBN(0))) {
      debug(`can't register yet: auth=${this.authorizedHub} stake=${this.stake.toString()}`)
      return receipts
    }

    // add worker only if not already added
    const workersAdded = await this._areWorkersAdded()
    if (!workersAdded) {
      // register on chain
      const addRelayWorkerMethod = this.relayHubContract?.contract.methods
        .addRelayWorkers([this.getWorkerAddress(0)])
      receipts = receipts.concat((await this._sendTransaction({
        signer: this.getManagerAddress(),
        method: addRelayWorkerMethod,
        destination: this.relayHubContract?.address as string
      })).receipt)
    }
    const registrationBlock = await this._getRegistrationBlock()
    const currentBlock = await this.contractInteractor.getBlockNumber()
    const latestTxBlockNumber = await this._getLatestTxBlockNumber()
    const shouldRegisterAgain = this.registrationBlockRate == null ? false : currentBlock - latestTxBlockNumber >= this.registrationBlockRate
    if (registrationBlock === 0 || shouldRegisterAgain) {
      const registerMethod = this.relayHubContract?.contract.methods
        .registerRelayServer(this.baseRelayFee, this.pctRelayFee,
          this.url)
      receipts = receipts.concat((await this._sendTransaction({
        signer: this.getManagerAddress(),
        method: registerMethod,
        destination: this.relayHubContract?.address as string
      })).receipt)
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      debug(`Relay ${this.managerAddress} registered on hub ${this.relayHubContract?.address}. `)
    }
    return receipts
  }

  async _getRegistrationBlock (): Promise<number> {
    const relayRegisteredEvents = await this.relayHubContract?.contract.getPastEvents('RelayServerRegistered', {
      fromBlock: 1,
      filter: { relayManager: this.managerAddress }
    })
    const event = relayRegisteredEvents.find(
      (e: any) =>
        e.returnValues.relayManager.toLowerCase() === this.managerAddress.toLowerCase() &&
        e.returnValues.baseRelayFee.toString() === this.baseRelayFee.toString() &&
        e.returnValues.pctRelayFee.toString() === this.pctRelayFee.toString() &&
        e.returnValues.relayUrl.toString() === this.url.toString())
    return (event == null ? 0 : event.blockNumber)
  }

  async _getLatestTxBlockNumber (): Promise<number> {
    const events: any[] = await this.contractInteractor.getPastEventsForHub(constants.activeManagerEvents,
      [address2topic(this.managerAddress)], {
        fromBlock: 1
      })
    const latestBlock = events.filter(
      (e: any) => /* e.returnValues.relayManager != null && */
        e.returnValues.relayManager.toLowerCase() === this.managerAddress.toLowerCase()).map((e: any) => e.blockNumber).reduce(
      (b1: any, b2: any) => Math.max(b1, b2))
    return latestBlock
  }

  async _areWorkersAdded (): Promise<boolean> {
    const workersAddedEvents = await this.relayHubContract?.contract.getPastEvents('RelayWorkersAdded', {
      fromBlock: 1,
      filter: { relayManager: this.managerAddress }
    })
    return (workersAddedEvents.find((e: any) => e.returnValues.newRelayWorkers
      .map((a: string) => a.toLowerCase()).includes(this.getWorkerAddress(0).toLowerCase())) != null)
  }

  async _handleUnstakedEvent (dlog: DecodeLogsEvent): Promise<TransactionReceipt[]> {
    console.log('handle Unstaked event', dlog)
    // sanity checks
    if (dlog.name !== 'StakeUnlocked' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relayManager}`)
    }
    await this.refreshStake()
    let receipts: TransactionReceipt[] = []
    const gasPrice = await this.contractInteractor.getGasPrice()
    receipts = receipts.concat(await this._sendManagerHubBalanceToOwner(gasPrice))
    receipts = receipts.concat(await this._sendMangerEthBalanceToOwner(gasPrice))
    receipts = receipts.concat(await this._sendWorkersEthBalancesToOwner(gasPrice))

    this.emit('unstaked')
    return receipts
  }

  async _handleTransactionRejectedByPaymasterEvent (dlog: DecodeLogsEvent, blockNumber: number): Promise<void> {
    console.log('handle TransactionRejectedByPaymaster event', dlog)
    // sanity checks
    if (dlog.name !== 'TransactionRejectedByPaymaster' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relayManager}`)
    }
    console.log('Relay entered alerted state')
    this.alerted = true
    this.alertedBlock = blockNumber
  }

  async _sendMangerEthBalanceToOwner (gasPrice: string): Promise<TransactionReceipt[]> {
    const receipts: TransactionReceipt[] = []
    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit * parseInt(gasPrice))

    const managerBalance = await this.getManagerBalance()
    // sending manager eth balance to owner
    if (managerBalance.gte(txCost)) {
      console.log(`Sending manager eth balance ${managerBalance.toString()} to owner`)
      receipts.push((await this._sendTransaction({
        signer: this.getManagerAddress(),
        destination: this.owner as string,
        gasLimit: gasLimit.toString(),
        gasPrice,
        value: toHex(managerBalance.sub(txCost))
      })).receipt)
    } else {
      console.log(`manager balance too low: ${managerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return receipts
  }

  async _sendWorkersEthBalancesToOwner (gasPrice: string): Promise<TransactionReceipt[]> {
    // sending workers' balance to owner (currently one worker, todo: extend to multiple)
    const receipts: TransactionReceipt[] = []
    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit * parseInt(gasPrice))
    const workerIndex = 0
    const workerBalance = await this.getWorkerBalance(workerIndex)
    if (workerBalance.gte(txCost)) {
      console.log(`Sending workers' eth balance ${workerBalance.toString()} to owner`)
      receipts.push((await this._sendTransaction({
        signer: this.getWorkerAddress(workerIndex),
        destination: this.owner as string,
        gasLimit: gasLimit.toString(),
        gasPrice,
        value: toHex(workerBalance.sub(txCost))
      })).receipt)
    } else {
      console.log(`balance too low: ${workerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return receipts
  }

  async _sendManagerHubBalanceToOwner (gasPrice: string): Promise<TransactionReceipt[]> {
    const receipts: TransactionReceipt[] = []
    const managerHubBalance = await this.relayHubContract?.balanceOf(this.managerAddress) ?? toBN(0)
    const method = this.relayHubContract?.contract.methods.withdraw(toHex(managerHubBalance), this.owner)
    const withdrawTxGasLimit = await method.estimateGas(
      { from: this.getManagerAddress() })
    const withdrawTxCost = toBN(withdrawTxGasLimit * parseInt(gasPrice))
    if (managerHubBalance.gte(withdrawTxCost)) {
      console.log(`Sending manager hub balance ${managerHubBalance.toString()} to owner`)
      receipts.push((await this._sendTransaction({
        signer: this.getManagerAddress(),
        destination: this.relayHubContract?.address as string,
        method
      })).receipt)
    } else {
      console.log(`manager hub balance too low: ${managerHubBalance.toString()}, tx cost: ${withdrawTxCost.toString()}`)
    }
    return receipts
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
    const signer = this.getManagerAddress()
    return await this._resendUnconfirmedTransactionsForSigner(blockHeader, signer)
  }

  async _resendUnconfirmedTransactionsForWorker (blockHeader: BlockHeader, workerIndex: number): Promise<PrefixedHexString | null> {
    const signer = this.getWorkerAddress(workerIndex)
    return await this._resendUnconfirmedTransactionsForSigner(blockHeader, signer)
  }

  async _resendUnconfirmedTransactionsForSigner (blockHeader: BlockHeader, signer: string): Promise<PrefixedHexString | null> {
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
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
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
      debug('resend', signer, ': awaiting confirmations for next mined transaction', nonce, sortedTxs[0].nonce,
        sortedTxs[0].txId)
      return null
    }

    // If the tx is still pending, check how long ago we sent it, and resend it if needed
    if (Date.now() - (new Date(sortedTxs[0].createdAt)).getTime() < pendingTransactionTimeout) {
      spam(Date.now(), (new Date()), (new Date()).getTime())
      spam(sortedTxs[0].createdAt, (new Date(sortedTxs[0].createdAt)), (new Date(sortedTxs[0].createdAt)).getTime())
      debug('resend', signer, ': awaiting transaction', sortedTxs[0].txId, 'to be mined. nonce:', nonce)
      return null
    }
    const { receipt, signedTx } = await this._resendTransaction(sortedTxs[0])
    debug('resent transaction', sortedTxs[0].nonce, sortedTxs[0].txId, 'as',
      receipt.transactionHash)
    if (sortedTxs[0].attempts > 2) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      debug(`resend ${signer}: Sent tx ${sortedTxs[0].attempts} times already`)
    }
    return signedTx
  }

  // signerIndex is the index into addresses array. zero is relayManager, the rest are workers
  async _sendTransaction ({ signer, method, destination, value = '0x', gasLimit, gasPrice }: SendTransactionDetails): Promise<SignedTransactionDetails> {
    const encodedCall = method?.encodeABI() ?? '0x'
    const _gasPrice = parseInt(gasPrice ?? await this.contractInteractor.getGasPrice())
    debug('gasPrice', _gasPrice)
    debug('encodedCall', encodedCall)
    const gas = parseInt(gasLimit ?? await method?.estimateGas({ from: signer }))
    debug('gasLimit', gas)
    debug('nonceMutex locked?', this.nonceMutex.isLocked())
    const releaseMutex = await this.nonceMutex.acquire()
    let signedTx
    let storedTx: StoredTx
    try {
      const nonce = await this._pollNonce(signer)
      debug('nonce', nonce)
      const txToSign = new Transaction({
        to: destination,
        value: value,
        gasLimit: gas,
        gasPrice: _gasPrice,
        data: Buffer.from(encodedCall.slice(2), 'hex'),
        nonce
      }, this.rawTxOptions)
      spam('txToSign', txToSign)
      const keyManager = this.managerKeyManager.isSigner(signer) ? this.managerKeyManager : this.workersKeyManager
      signedTx = keyManager.signTransaction(signer, txToSign)
      storedTx = transactionToStoredTx(txToSign, signer, this.chainId, 1)
      this.nonces[signer]++
      await this.txStoreManager.putTx(storedTx, false)
    } finally {
      releaseMutex()
    }
    const receipt = await this.contractInteractor.sendSignedTransaction(signedTx)
    debug('\ntxhash is', receipt.transactionHash)
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
    const keyManager = this.managerKeyManager.isSigner(tx.from) ? this.managerKeyManager : this.workersKeyManager
    const signedTx = keyManager.signTransaction(tx.from, txToSign)
    const storedTx = transactionToStoredTx(txToSign, tx.from, this.chainId, tx.attempts + 1)
    await this.txStoreManager.putTx(storedTx, true)

    debug('resending tx with nonce', txToSign.nonce, 'from', tx.from)
    debug('account nonce', await this.contractInteractor.getTransactionCount(tx.from))
    const receipt = await this.contractInteractor.sendSignedTransaction(signedTx)
    debug('\ntxhash is', receipt.transactionHash)
    if (receipt.transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${receipt.transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      receipt,
      signedTx
    }
  }

  async _pollNonce (signer: Address): Promise<number> {
    const nonce = await this.contractInteractor.getTransactionCount(signer, 'pending')
    if (nonce > this.nonces[signer]) {
      debug('NONCE FIX for signer=', signer, ': nonce=', nonce, this.nonces[signer])
      this.nonces[signer] = nonce
    }
    return nonce
  }

  _parseEvent (event: { events: any[], name: string, address: string } | null): any {
    if (event?.events === undefined) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
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
