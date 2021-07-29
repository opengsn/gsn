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
  balanceRequired: AmountRequired
  stakeRequired: AmountRequired
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
  private delayedEvents: Array<{ block: number, eventData: EventData }> = []

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
    const listener = (): void => {
      this.printNotRegisteredMessage()
    }
    this.logger = logger
    this.balanceRequired = new AmountRequired('Balance', toBN(config.managerMinBalance), logger, listener)
    this.stakeRequired = new AmountRequired('Stake', toBN(config.managerMinStake), logger, listener)

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
    await this.refreshBalance()
    await this.refreshStake()
    this.isInitialized = true
  }

  async updateLatestRegistrationTxs (hubEventsSinceLastScan: EventData[]): Promise<void> {
    for (const eventData of hubEventsSinceLastScan) {
      switch (eventData.event) {
        case RelayServerRegistered:
          if (this.lastMinedRegisterTransaction == null || isSecondEventLater(this.lastMinedRegisterTransaction, eventData)) {
            this.lastMinedRegisterTransaction = eventData
          }
          break
        case RelayWorkersAdded:
          if (this.lastWorkerAddedTransaction == null || isSecondEventLater(this.lastWorkerAddedTransaction, eventData)) {
            this.lastWorkerAddedTransaction = eventData
          }
          break
      }
    }
  }

  async handlePastEvents (hubEventsSinceLastScan: EventData[], lastScannedBlock: number, currentBlock: number, forceRegistration: boolean): Promise<PrefixedHexString[]> {
    if (!this.isInitialized) {
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
            this.delayedEvents.push({ block: eventData.returnValues.removalBlock.toString(), eventData })
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
    for (const eventData of this._extractDuePendingEvents(currentBlock)) {
      switch (eventData.event) {
        case HubUnauthorized:
          transactionHashes = transactionHashes.concat(await this._handleHubUnauthorizedEvent(eventData, currentBlock))
          break
      }
    }
    const isRegistrationCorrect = await this._isRegistrationCorrect()
    const isRegistrationPending = await this.txStoreManager.isActionPending(ServerAction.REGISTER_SERVER)
    if (!(isRegistrationPending || isRegistrationCorrect) || forceRegistration) {
      this.logger.debug(`will attempt registration: isRegistrationPending=${isRegistrationPending} isRegistrationCorrect=${isRegistrationCorrect} forceRegistration=${forceRegistration}`)
      transactionHashes = transactionHashes.concat(await this.attemptRegistration(currentBlock))
    }
    return transactionHashes
  }

  _extractDuePendingEvents (currentBlock: number): EventData[] {
    const ret = this.delayedEvents.filter(event => event.block <= currentBlock).map(e => e.eventData)
    this.delayedEvents = [...this.delayedEvents.filter(event => event.block > currentBlock)]
    return ret
  }

  _isRegistrationCorrect (): boolean {
    return isRegistrationValid(this.lastMinedRegisterTransaction, this.config, this.managerAddress)
  }

  async _queryLatestRegistrationEvent (): Promise<EventData | undefined> {
    const topics = address2topic(this.managerAddress)
    const registerEvents = await this.contractInteractor.getPastEventsForHub([topics],
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
    const currentBalance = await this.contractInteractor.getBalance(this.managerAddress)
    this.balanceRequired.currentValue = toBN(currentBalance)
  }

  async refreshStake (): Promise<void> {
    const stakeInfo = await this.contractInteractor.getStakeInfo(this.managerAddress)
    const isStakedOnHub = await this.contractInteractor.isRelayManagerStakedOnHub(this.managerAddress)
    if (isStakedOnHub) {
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

    // a locked stake does not have the 'withdrawBlock' field set
    this.isStakeLocked = stakeInfo.withdrawBlock.toString() === '0'
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
    const isStakedOnHub = await this.contractInteractor.isRelayManagerStakedOnHub(this.managerAddress)
    if (!isStakedOnHub && this.ownerAddress != null) {
      this.logger.error('Relay manager is staked on StakeManager but not on RelayHub.\n' +
        'Minimum stake/minimum unstake delay misconfigured?')
    }
    const allPrerequisitesOk =
      this.isHubAuthorized &&
      this.isStakeLocked &&
      this.stakeRequired.isSatisfied &&
      this.balanceRequired.isSatisfied &&
      isStakedOnHub
    if (!allPrerequisitesOk) {
      this.logger.debug('will not actually attempt registration - prerequisites not satisfied')
      return []
    }

    let transactions: PrefixedHexString[] = []
    // add worker only if not already added
    const workersAdded = await this._isWorkerValid()
    const addWorkersPending = await this.txStoreManager.isActionPending(ServerAction.ADD_WORKER)
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
      destination: this.hubAddress,
      creationBlockNumber: currentBlock
    }
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    transactions = transactions.concat(transactionHash)
    this.logger.debug(`Relay ${this.managerAddress} registered on hub ${this.hubAddress}. `)
    return transactions
  }

  async _sendManagerEthBalanceToOwner (currentBlock: number): Promise<PrefixedHexString[]> {
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
        gasPrice,
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
    const gasPrice = await this.contractInteractor.getGasPrice()
    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit * parseInt(gasPrice))
    const workerBalance = toBN(await this.contractInteractor.getBalance(this.workerAddress))
    if (workerBalance.gte(txCost)) {
      this.logger.info(`Sending workers' eth balance ${workerBalance.toString()} to owner`)
      const details = {
        signer: this.workerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: this.ownerAddress as string,
        gasLimit,
        gasPrice,
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

  async _sendManagerHubBalanceToOwner (currentBlock: number): Promise<PrefixedHexString[]> {
    if (this.ownerAddress == null) {
      throw new Error('Owner address not initialized')
    }
    const transactionHashes: PrefixedHexString[] = []
    const gasPrice = await this.contractInteractor.getGasPrice()
    const managerHubBalance = await this.contractInteractor.hubBalanceOf(this.managerAddress)
    const {
      gasLimit,
      gasCost,
      method
    } = await this.contractInteractor.withdrawHubBalanceEstimateGas(managerHubBalance, this.ownerAddress, this.managerAddress, gasPrice)
    if (managerHubBalance.gte(gasCost)) {
      this.logger.info(`Sending manager hub balance ${managerHubBalance.toString()} to owner`)
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
    const isRegistrationCorrect = await this._isRegistrationCorrect()
    return this.stakeRequired.isSatisfied &&
      this.isStakeLocked &&
      this.isHubAuthorized &&
      isRegistrationCorrect
  }

  printNotRegisteredMessage (): void {
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
