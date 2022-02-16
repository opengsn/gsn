import chalk from 'chalk'
import { EventData, PastEventOptions } from 'web3-eth-contract'
import { EventEmitter } from 'events'
import { PrefixedHexString } from 'ethereumjs-util'
import { toBN, toHex } from 'web3-utils'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { AmountRequired } from '@opengsn/common/dist/AmountRequired'
import {
  address2topic,
  getLatestEventData,
  isSameAddress,
  isSecondEventLater,
  boolString
} from '@opengsn/common/dist/Utils'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'

import { SendTransactionDetails, TransactionManager } from './TransactionManager'
import { ServerConfigParams } from './ServerConfigParams'
import { TxStoreManager } from './TxStoreManager'
import { ServerAction } from './StoredTransaction'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

import {
  HubAuthorized,
  HubUnauthorized,
  OwnerSet,
  RelayServerRegistered,
  RelayWorkersAdded,
  StakeAdded,
  StakeUnlocked,
  StakeWithdrawn
} from '@opengsn/common/dist/types/GSNContractsDataTypes'

import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { isRegistrationValid } from './Utils'
import { constants } from '@opengsn/common/dist/Constants'

const mintxgascost = defaultEnvironment.mintxgascost

export class RegistrationManager {
  balanceRequired?: AmountRequired
  stakeRequired?: AmountRequired
  _isSetOwnerCalled = false
  _isOwnerSetOnStakeManager = false
  _isHubAuthorized = false
  _isStakeLocked = false

  isInitialized = false
  hubAddress: Address

  managerAddress: Address
  workerAddress: Address

  eventEmitter: EventEmitter

  contractInteractor: ContractInteractor
  ownerAddress?: Address
  transactionManager: TransactionManager
  config: ServerConfigParams
  txStoreManager: TxStoreManager
  logger: LoggerInterface

  lastMinedRegisterTransaction?: EventData
  lastWorkerAddedTransaction?: EventData
  private delayedEvents: Array<{ time: number, eventData: EventData }> = []

  get isHubAuthorized (): boolean {
    return this._isHubAuthorized
  }

  set isHubAuthorized (newValue: boolean) {
    const oldValue = this._isHubAuthorized
    this._isHubAuthorized = newValue
    if (newValue !== oldValue) {
      this.logger.info(`Current RelayHub is ${newValue ? 'now' : 'no longer'} authorized`)
      this.printNotRegisteredMessage()
    }
  }

  get isStakeLocked (): boolean {
    return this._isStakeLocked
  }

  set isStakeLocked (newValue: boolean) {
    const oldValue = this._isStakeLocked
    this._isStakeLocked = newValue
    if (newValue !== oldValue) {
      this.logger.info(`Manager stake is ${newValue ? 'now' : 'no longer'} locked`)
      this.printNotRegisteredMessage()
    }
  }

  constructor (
    contractInteractor: ContractInteractor,
    transactionManager: TransactionManager,
    txStoreManager: TxStoreManager,
    eventEmitter: EventEmitter,
    logger: LoggerInterface,
    config: ServerConfigParams,
    // exposed from key manager?
    managerAddress: Address,
    workerAddress: Address
  ) {
    this.logger = logger

    this.contractInteractor = contractInteractor
    this.hubAddress = config.relayHubAddress
    this.managerAddress = managerAddress
    this.workerAddress = workerAddress
    this.eventEmitter = eventEmitter
    this.transactionManager = transactionManager
    this.txStoreManager = txStoreManager
    this.config = config
  }

  async init (): Promise<void> {
    if (this.lastWorkerAddedTransaction == null) {
      this.lastWorkerAddedTransaction = await this._queryLatestWorkerAddedEvent()
    }

    if (this.lastMinedRegisterTransaction == null) {
      this.lastMinedRegisterTransaction = await this._queryLatestRegistrationEvent()
    }

    const tokenMetadata = await this.contractInteractor.getErc20TokenMetadata()
    const listener = (): void => {
      this.printNotRegisteredMessage()
    }
    this.balanceRequired = new AmountRequired('Balance', toBN(this.config.managerMinBalance), this.logger, listener)
    this.stakeRequired = new AmountRequired('Stake', toBN(this.config.managerMinStake), this.logger, listener, tokenMetadata)
    await this.refreshBalance()
    await this.refreshStake()
    this.isInitialized = true
  }

  async updateLatestRegistrationTxs (hubEventsSinceLastScan: EventData[]): Promise<void> {
    for (const eventData of hubEventsSinceLastScan) {
      switch (eventData.event) {
        case RelayServerRegistered:
          if (this.lastMinedRegisterTransaction == null || isSecondEventLater(this.lastMinedRegisterTransaction, eventData)) {
            this.logger.debug('New lastMinedRegisterTransaction: ' + JSON.stringify(eventData))
            this.lastMinedRegisterTransaction = eventData
          }
          break
        case RelayWorkersAdded:
          if (this.lastWorkerAddedTransaction == null || isSecondEventLater(this.lastWorkerAddedTransaction, eventData)) {
            this.logger.debug('New lastWorkerAddedTransaction: ' + JSON.stringify(eventData))
            this.lastWorkerAddedTransaction = eventData
          }
          break
      }
    }
  }

  async handlePastEvents (hubEventsSinceLastScan: EventData[], lastScannedBlock: number, currentBlock: number, forceRegistration: boolean): Promise<PrefixedHexString[]> {
    if (!this.isInitialized || this.balanceRequired == null) {
      throw new Error('RegistrationManager not initialized')
    }
    const topics = [address2topic(this.managerAddress)]
    const options: PastEventOptions = {
      fromBlock: lastScannedBlock + 1,
      toBlock: 'latest'
    }
    const eventNames = [HubAuthorized, StakeAdded, HubUnauthorized, StakeUnlocked, StakeWithdrawn, OwnerSet]
    const decodedEvents = await this.contractInteractor.getPastEventsForStakeManager(eventNames, topics, options)
    this.printEvents(decodedEvents, options)
    let transactionHashes: PrefixedHexString[] = []
    if (!this._isOwnerSetOnStakeManager) {
      if (this.balanceRequired.isSatisfied) {
        // TODO: _isSetOwnerCalled is different from 'isActionPending' only cause we handle owner outside the event loop
        if (!this._isSetOwnerCalled) {
          this._isSetOwnerCalled = true
          transactionHashes = transactionHashes.concat(await this.setOwnerInStakeManager(currentBlock))
        }
      } else {
        this.logger.debug('owner is not set and balance requirement is not satisfied')
        // TODO: relay should stop handling events at this point as action by owner is required;
        //  current architecture does not allow to skip handling events; assume
      }
    }
    // TODO: what about 'penalize' events? should send balance to owner, I assume
    // TODO TODO TODO 'StakeAdded' is not the event you want to cat upon if there was no 'HubAuthorized' event
    for (const eventData of decodedEvents) {
      switch (eventData.event) {
        case HubAuthorized:
          this.logger.warn(`Handling HubAuthorized event: ${JSON.stringify(eventData)} in block ${currentBlock}`)
          await this._handleHubAuthorizedEvent(eventData)
          break
        case OwnerSet:
          await this.refreshStake()
          this.logger.warn(`Handling OwnerSet event: ${JSON.stringify(eventData)} in block ${currentBlock}`)
          break
        case StakeAdded:
          await this.refreshStake()
          this.logger.warn(`Handling StakeAdded event: ${JSON.stringify(eventData)} in block ${currentBlock}`)
          break
        case HubUnauthorized:
          this.logger.warn(`Handling HubUnauthorized event: ${JSON.stringify(eventData)} in block ${currentBlock}`)
          if (isSameAddress(eventData.returnValues.relayHub, this.hubAddress)) {
            this.isHubAuthorized = false
            this.delayedEvents.push({ time: eventData.returnValues.removalTime.toString(), eventData })
          }
          break
        case StakeUnlocked:
          this.logger.warn(`Handling StakeUnlocked event: ${JSON.stringify(eventData)} in block ${currentBlock}`)
          await this.refreshStake()
          break
        case StakeWithdrawn:
          this.logger.warn(`Handling StakeWithdrawn event: ${JSON.stringify(eventData)} in block ${currentBlock}`)
          await this.refreshStake()
          transactionHashes = transactionHashes.concat(await this._handleStakeWithdrawnEvent(eventData, currentBlock))
          break
      }
    }

    await this.updateLatestRegistrationTxs(hubEventsSinceLastScan)

    // handle HubUnauthorized only after the due time
    // TODO: avoid querying time from RPC; reorganize code
    const currentBlockObject = await this.contractInteractor.getBlock(currentBlock)
    // In case 'currentBlock' is not found on the node, nothing is due
    const currentBlockTime = currentBlockObject?.timestamp ?? 0
    for (const eventData of this._extractDuePendingEvents(currentBlockTime)) {
      switch (eventData.event) {
        case HubUnauthorized:
          transactionHashes = transactionHashes.concat(await this._handleHubUnauthorizedEvent(eventData, currentBlock))
          break
      }
    }
    const isRegistrationCorrect = await this._isRegistrationCorrect()
    const isRegistrationPending = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.REGISTER_SERVER, currentBlock, this.config.recentActionAvoidRepeatDistanceBlocks)
    if (!(isRegistrationPending || isRegistrationCorrect) || forceRegistration) {
      this.logger.debug(`will attempt registration: isRegistrationPending=${isRegistrationPending} isRegistrationCorrect=${isRegistrationCorrect} forceRegistration=${forceRegistration}`)
      transactionHashes = transactionHashes.concat(await this.attemptRegistration(currentBlock))
    }
    return transactionHashes
  }

  _extractDuePendingEvents (currentBlockTime: number | string): EventData[] {
    const currentBlockTimeNumber = parseInt(currentBlockTime.toString())
    const ret = this.delayedEvents.filter(event => event.time <= currentBlockTimeNumber).map(e => e.eventData)
    this.delayedEvents = [...this.delayedEvents.filter(event => event.time > currentBlockTimeNumber)]
    return ret
  }

  _isRegistrationCorrect (): boolean {
    return isRegistrationValid(this.lastMinedRegisterTransaction, this.config, this.managerAddress)
  }

  async _queryLatestRegistrationEvent (): Promise<EventData | undefined> {
    const topics = address2topic(this.managerAddress)
    const registerEvents = await this.contractInteractor.getPastEventsForRegistrar([topics],
      {
        fromBlock: this.config.coldRestartLogsFromBlock
      },
      [RelayServerRegistered])
    return getLatestEventData(registerEvents)
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

  async _handleHubAuthorizedEvent (dlog: EventData): Promise<void> {
    if (dlog.returnValues.relayHub.toLowerCase() === this.hubAddress.toLowerCase()) {
      this.isHubAuthorized = true
    }
  }

  async _handleHubUnauthorizedEvent (dlog: EventData, currentBlock: number): Promise<PrefixedHexString[]> {
    return await this.withdrawAllFunds(false, currentBlock)
  }

  async _handleStakeWithdrawnEvent (dlog: EventData, currentBlock: number): Promise<PrefixedHexString[]> {
    this.logger.warn(`Handling StakeWithdrawn event: ${JSON.stringify(dlog)}`)
    return await this.withdrawAllFunds(true, currentBlock)
  }

  /**
   * @param withdrawManager - whether to send the relay manager's balance to the owner.
   *        Note that more than one relay process could be using the same manager account.
   * @param currentBlock
   */
  async withdrawAllFunds (withdrawManager: boolean, currentBlock: number): Promise<PrefixedHexString[]> {
    let transactionHashes: PrefixedHexString[] = []
    transactionHashes = transactionHashes.concat(await this._sendManagerHubBalanceToOwner(currentBlock))
    transactionHashes = transactionHashes.concat(await this._sendWorkersEthBalancesToOwner(currentBlock))
    if (withdrawManager) {
      transactionHashes = transactionHashes.concat(await this._sendManagerEthBalanceToOwner(currentBlock))
    }

    this.eventEmitter.emit('unstaked')
    return transactionHashes
  }

  async refreshBalance (): Promise<void> {
    if (this.balanceRequired == null) {
      throw new Error('not initialized')
    }
    const currentBalance = await this.contractInteractor.getBalance(this.managerAddress)
    this.balanceRequired.currentValue = toBN(currentBalance)
  }

  async refreshStake (): Promise<void> {
    if (this.stakeRequired == null) {
      throw new Error('not initialized')
    }
    const stakeInfo = await this.contractInteractor.getStakeInfo(this.managerAddress)
    const stakedOnHubStatus = await this.contractInteractor.isRelayManagerStakedOnHub(this.managerAddress)
    if (stakedOnHubStatus.isStaked) {
      this.isHubAuthorized = true
    }
    const stake = stakeInfo.stake
    this._isOwnerSetOnStakeManager = stakeInfo.owner !== constants.ZERO_ADDRESS
    if (this._isOwnerSetOnStakeManager && !isSameAddress(stakeInfo.owner, this.config.ownerAddress)) {
      throw new Error(`This Relay Manager has set owner to already! On-chain: ${stakeInfo.owner}, in config: ${this.config.ownerAddress}`)
    }
    if (stake.eq(toBN(0))) {
      return
    }

    // a locked stake does not have the 'withdrawTime' field set
    this.isStakeLocked = stakeInfo.withdrawTime.toString() === '0'
    this.stakeRequired.currentValue = stake

    // first time getting stake, setting owner
    if (this.ownerAddress == null) {
      this.ownerAddress = stakeInfo.owner
      this.logger.info('Got staked for the first time')
      this.printNotRegisteredMessage()
    }
  }

  async addRelayWorker (currentBlock: number): Promise<PrefixedHexString> {
    // register on chain
    const addRelayWorkerMethod = await this.contractInteractor.getAddRelayWorkersMethod([this.workerAddress])
    const gasLimit = await this.transactionManager.attemptEstimateGas('AddRelayWorkers', addRelayWorkerMethod, this.managerAddress)
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      gasLimit,
      serverAction: ServerAction.ADD_WORKER,
      method: addRelayWorkerMethod,
      destination: this.hubAddress,
      creationBlockNumber: currentBlock
    }
    this.logger.info(`adding relay worker ${this.workerAddress}`)
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    return transactionHash
  }

  // TODO: extract worker registration sub-flow
  async attemptRegistration (currentBlock: number): Promise<PrefixedHexString[]> {
    if (this.balanceRequired == null || this.stakeRequired == null) {
      throw new Error('not initialized')
    }
    const stakeOnHubStatus = await this.contractInteractor.isRelayManagerStakedOnHub(this.managerAddress)
    if (!stakeOnHubStatus.isStaked && this.ownerAddress != null) {
      this.logger.error('Relay manager is staked on StakeManager but not on RelayHub.')
      this.logger.error('Minimum stake/minimum unstake delay/stake token misconfigured?')
    }
    const allPrerequisitesOk =
      this.isHubAuthorized &&
      this.isStakeLocked &&
      this.stakeRequired.isSatisfied &&
      this.balanceRequired.isSatisfied &&
      stakeOnHubStatus.isStaked
    if (!allPrerequisitesOk) {
      this.logger.debug('will not actually attempt registration - prerequisites not satisfied')
      return []
    }

    let transactions: PrefixedHexString[] = []
    // add worker only if not already added
    const workersAdded = await this._isWorkerValid()
    const addWorkersPending = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.ADD_WORKER, currentBlock, this.config.recentActionAvoidRepeatDistanceBlocks)
    if (!(workersAdded || addWorkersPending)) {
      const txHash = await this.addRelayWorker(currentBlock)
      transactions = transactions.concat(txHash)
    }
    const registerMethod = await this.contractInteractor.getRegisterRelayMethod(this.config.baseRelayFee, this.config.pctRelayFee, this.config.url)
    const gasLimit = await this.transactionManager.attemptEstimateGas('RegisterRelay', registerMethod, this.managerAddress)
    const details: SendTransactionDetails = {
      serverAction: ServerAction.REGISTER_SERVER,
      gasLimit,
      signer: this.managerAddress,
      method: registerMethod,
      destination: this.contractInteractor.relayRegistrar.address,
      creationBlockNumber: currentBlock
    }
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    transactions = transactions.concat(transactionHash)
    this.logger.debug(`Relay ${this.managerAddress} registered on hub ${this.hubAddress}. `)
    return transactions
  }

  async _sendManagerEthBalanceToOwner (currentBlock: number): Promise<PrefixedHexString[]> {
    // todo add better maxFeePerGas, maxPriorityFeePerGas
    const gasPrice = await this.contractInteractor.getGasPrice()
    const transactionHashes: PrefixedHexString[] = []
    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit).mul(toBN(gasPrice))

    const managerBalance = toBN(await this.contractInteractor.getBalance(this.managerAddress))
    // sending manager eth balance to owner
    if (managerBalance.gte(txCost)) {
      this.logger.info(`Sending manager eth balance ${managerBalance.toString()} to owner`)
      const details: SendTransactionDetails = {
        signer: this.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: this.ownerAddress as string,
        gasLimit,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        value: toHex(managerBalance.sub(txCost)),
        creationBlockNumber: currentBlock
      }
      const { transactionHash } = await this.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    } else {
      this.logger.error(`manager balance too low: ${managerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return transactionHashes
  }

  async _sendWorkersEthBalancesToOwner (currentBlock: number): Promise<PrefixedHexString[]> {
    // sending workers' balance to owner (currently one worker, todo: extend to multiple)
    const transactionHashes: PrefixedHexString[] = []
    // todo add better maxFeePerGas, maxPriorityFeePerGas
    const gasPrice = await this.contractInteractor.getGasPrice()
    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit * parseInt(gasPrice))
    const workerBalance = toBN(await this.contractInteractor.getBalance(this.workerAddress))
    if (workerBalance.gte(txCost)) {
      this.logger.info(`Sending workers' eth balance ${workerBalance.toString()} to owner`)
      const details: SendTransactionDetails = {
        signer: this.workerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: this.ownerAddress as string,
        gasLimit,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        value: toHex(workerBalance.sub(txCost)),
        creationBlockNumber: currentBlock
      }
      const { transactionHash } = await this.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    } else {
      this.logger.info(`balance too low: ${workerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return transactionHashes
  }

  async _sendManagerHubBalanceToOwner (currentBlock: number, amount?: BN): Promise<PrefixedHexString[]> {
    if (this.ownerAddress == null) {
      throw new Error('Owner address not initialized')
    }
    const transactionHashes: PrefixedHexString[] = []
    const gasPrice = await this.contractInteractor.getGasPrice()
    const managerHubBalance = await this.contractInteractor.hubBalanceOf(this.managerAddress)
    if (amount == null) {
      amount = managerHubBalance
    } else if (amount.gt(managerHubBalance)) {
      throw new Error(`Withdrawal amount ${amount.toString()} larger than manager hub balance ${managerHubBalance.toString()}`)
    }
    const {
      gasLimit,
      gasCost,
      method
    } = await this.contractInteractor.withdrawHubBalanceEstimateGas(amount, this.ownerAddress, this.managerAddress, gasPrice)
    if (amount.gte(gasCost)) {
      this.logger.info(`Sending manager hub balance ${amount.toString()} to owner`)
      const details: SendTransactionDetails = {
        gasLimit,
        signer: this.managerAddress,
        serverAction: ServerAction.DEPOSIT_WITHDRAWAL,
        destination: this.hubAddress,
        creationBlockNumber: currentBlock,
        method
      }
      const { transactionHash } = await this.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    } else {
      this.logger.error(`manager hub balance too low: ${managerHubBalance.toString()}, tx cost: ${gasCost.toString()}`)
    }
    return transactionHashes
  }

  async _queryLatestWorkerAddedEvent (): Promise<EventData | undefined> {
    const workersAddedEvents = await this.contractInteractor.getPastEventsForHub([address2topic(this.managerAddress)],
      {
        fromBlock: this.config.coldRestartLogsFromBlock
      },
      [RelayWorkersAdded])
    return getLatestEventData(workersAddedEvents)
  }

  async _isWorkerValid (): Promise<boolean> {
    const managerFromHub = await this.contractInteractor.workerToManager(this.workerAddress)
    if (managerFromHub.toLowerCase() === this.managerAddress.toLowerCase()) {
      return true
    }
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    return this.lastWorkerAddedTransaction != null && this.lastWorkerAddedTransaction.returnValues.newRelayWorkers
      .map((a: string) => a.toLowerCase()).includes(this.workerAddress.toLowerCase())
  }

  async isRegistered (): Promise<boolean> {
    if (this.stakeRequired == null) {
      throw new Error('not initialized')
    }
    const isRegistrationCorrect = await this._isRegistrationCorrect()
    return this.stakeRequired.isSatisfied &&
      this.isStakeLocked &&
      this.isHubAuthorized &&
      isRegistrationCorrect
  }

  printNotRegisteredMessage (): void {
    if (this.balanceRequired == null || this.stakeRequired == null) {
      throw new Error('not initialized')
    }
    if (this._isRegistrationCorrect()) {
      return
    }
    const message = `\nNot registered yet. Prerequisites:
${this.balanceRequired.description}
${this.stakeRequired.description}
Hub authorized | ${boolString(this.isHubAuthorized)}
Stake locked   | ${boolString(this.isStakeLocked)}
Manager        | ${this.managerAddress}
Worker         | ${this.workerAddress}
Owner          | ${this.ownerAddress ?? chalk.red('unknown')}
`
    this.logger.info(message)
  }

  printEvents (decodedEvents: EventData[], options: PastEventOptions): void {
    if (decodedEvents.length === 0) {
      return
    }
    this.logger.info(`Handling ${decodedEvents.length} events emitted since block: ${options.fromBlock?.toString()}`)
    for (const decodedEvent of decodedEvents) {
      this.logger.info(`
Name      | ${decodedEvent.event.padEnd(25)}
Block     | ${decodedEvent.blockNumber}
TxHash    | ${decodedEvent.transactionHash}
`)
    }
  }

  // TODO: duplicated code; another leaked web3 'method' abstraction
  async setOwnerInStakeManager (currentBlock: number): Promise<PrefixedHexString> {
    const setRelayManagerMethod = await this.contractInteractor.getSetRelayManagerMethod(this.config.ownerAddress)
    const gasLimit = await this.transactionManager.attemptEstimateGas('SetRelayManager', setRelayManagerMethod, this.managerAddress)
    const stakeManagerAddress = this.contractInteractor.stakeManagerAddress()
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      gasLimit,
      serverAction: ServerAction.SET_OWNER,
      method: setRelayManagerMethod,
      destination: stakeManagerAddress,
      creationBlockNumber: currentBlock
    }
    this.logger.info(`setting relay owner ${this.config.ownerAddress} at StakeManager ${stakeManagerAddress}`)
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    return transactionHash
  }
}
