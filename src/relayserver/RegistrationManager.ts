// @ts-ignore
import { TransactionReceipt } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import { EventEmitter } from 'events'

import { Address, IntString } from '../relayclient/types/Aliases'
import { address2topic, isSameAddress, reduceToLatestTx } from '../common/Utils'
import ContractInteractor, {
  HubAuthorized,
  HubUnauthorized,
  RelayServerRegistered,
  RelayWorkersAdded,
  StakeAdded,
  StakeUnlocked
} from '../relayclient/ContractInteractor'
import { SendTransactionDetails, TransactionManager } from './TransactionManager'
import { defaultEnvironment } from '../common/Environments'

import log from 'loglevel'
import { EventData } from 'web3-eth-contract'
import { ServerConfigParams } from './ServerConfigParams'

export class StateError extends Error {}

export interface RelayServerRegistryInfo {
  baseRelayFee: IntString
  pctRelayFee: number
  url: string
}

class AmountRequired {
  currentValue = toBN(0)
  requiredValue = toBN(0)

  constructor (requiredValue: BN) {
    this.requiredValue = requiredValue
  }

  get isSatisfied (): boolean {
    return this.currentValue.gte(this.requiredValue)
  }

  get description (): string {
    return `actual: ${this.currentValue.toString()} required: ${this.requiredValue.toString()}`
  }
}

const mintxgascost = defaultEnvironment.mintxgascost

// TODO: I am not a fan of this approach, yet server has to behave differently
export interface PastEventsHandled {
  receipts: TransactionReceipt[]
  unregistered: boolean
}

function isRegistrationValid (registerEvent: EventData | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
  return registerEvent != null &&
    isSameAddress(registerEvent.returnValues.relayManager, managerAddress) &&
    registerEvent.returnValues.baseRelayFee.toString() === config.baseRelayFee.toString() &&
    registerEvent.returnValues.pctRelayFee.toString() === config.pctRelayFee.toString() &&
    registerEvent.returnValues.relayUrl.toString() === config.url.toString()
}

export class RegistrationManager {
  balanceRequired: AmountRequired
  stakeRequired: AmountRequired
  isHubAuthorized = false
  isStakeLocked = false

  hubAddress: Address

  managerAddress: Address
  workerAddress: Address

  eventEmitter: EventEmitter

  contractInteractor: ContractInteractor
  ownerAddress?: Address
  transactionManager: TransactionManager
  config: ServerConfigParams

  lastMinedRegisterTransaction?: EventData
  lastWorkerAddedTransaction?: EventData

  constructor (
    contractInteractor: ContractInteractor,
    transactionManager: TransactionManager,
    eventEmitter: EventEmitter,
    config: ServerConfigParams,
    // exposed from key manager?
    managerAddress: Address,
    workerAddress: Address
  ) {
    this.balanceRequired = new AmountRequired(toBN(config.managerMinBalance))
    this.stakeRequired = new AmountRequired(toBN(config.managerMinStake))

    this.contractInteractor = contractInteractor
    this.hubAddress = config.relayHubAddress
    this.managerAddress = managerAddress
    this.workerAddress = workerAddress
    this.eventEmitter = eventEmitter
    this.transactionManager = transactionManager
    this.config = config
  }

  async handlePastEvents (hubEventsSinceLastScan: EventData[], lastScannedBlock: number, currentBlock: number, forceRegistration: boolean): Promise<PastEventsHandled> {
    const topics = [address2topic(this.managerAddress)]
    const options = {
      fromBlock: lastScannedBlock + 1,
      toBlock: 'latest'
    }
    const eventNames = [HubAuthorized, StakeAdded, HubUnauthorized, StakeUnlocked]
    const decodedEvents = await this.contractInteractor.getPastEventsForStakeManager(eventNames, topics, options)
    log.trace('logs?', decodedEvents)
    log.trace('options? ', options)
    let unregistered = false
    let receipts: TransactionReceipt[] = []
    // TODO: what about 'penalize' events? should send balance to owner, I assume
    // TODO TODO TODO 'StakeAdded' is not the event you want to cat upon if there was no 'HubAuthorized' event
    for (const eventData of decodedEvents) {
      switch (eventData.event) {
        case 'HubAuthorized':
          await this._handleHubAuthorizedEvent(eventData)
          break
        case 'StakeAdded':
          await this._handleStakedEvent()
          break
        case 'HubUnauthorized':
          unregistered = true
          receipts = receipts.concat(await this._handleHubUnauthorizedEvent(eventData, currentBlock))
          break
        case 'StakeUnlocked':
          unregistered = true
          receipts = receipts.concat(await this._handleUnstakedEvent(eventData, currentBlock))
          break
      }
    }
    const isRegistrationCorrect = await this._isRegistrationCorrect(hubEventsSinceLastScan)
    if (!isRegistrationCorrect || forceRegistration) {
      receipts = receipts.concat(await this.attemptRegistration(hubEventsSinceLastScan, currentBlock))
    }
    return {
      receipts,
      unregistered
    }
  }

  async _isRegistrationCorrect (hubEventsSinceLastScan: EventData[]): Promise<boolean> {
    const lastRegisteredTxSinceLastScan = reduceToLatestTx(hubEventsSinceLastScan.filter((it) => it.event === RelayServerRegistered))
    if (lastRegisteredTxSinceLastScan != null) {
      this.lastMinedRegisterTransaction = lastRegisteredTxSinceLastScan
    }
    if (this.lastMinedRegisterTransaction == null) {
      this.lastMinedRegisterTransaction = await this._queryLatestRegistrationEvent()
    }
    return isRegistrationValid(this.lastMinedRegisterTransaction, this.config, this.managerAddress)
  }

  async _queryLatestRegistrationEvent (): Promise<EventData | undefined> {
    const topics = address2topic(this.managerAddress)
    const relayRegisteredEvents = await this.contractInteractor.getPastEventsForHub([topics],
      {
        fromBlock: 1
      },
      [RelayServerRegistered])
    const registerEvents = relayRegisteredEvents.filter(
      (eventData: EventData) =>
        isRegistrationValid(eventData, this.config, this.managerAddress))
    return reduceToLatestTx(registerEvents)
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

  async _handleHubUnauthorizedEvent (dlog: EventData, currentBlock: number): Promise<TransactionReceipt[]> {
    if (dlog.returnValues.relayHub.toLowerCase() === this.hubAddress.toLowerCase()) {
      this.isHubAuthorized = false
    }
    return await this.withdrawAllFunds(false, currentBlock)
  }

  async _handleStakedEvent (): Promise<void> {
    await this.refreshStake()
  }

  async _handleUnstakedEvent (dlog: EventData, currentBlock: number): Promise<TransactionReceipt[]> {
    console.log('handle Unstaked event', dlog)
    await this.refreshStake()
    return await this.withdrawAllFunds(true, currentBlock)
  }

  /**
   * @param withdrawManager - whether to send the relay manager's balance to the owner.
   *        Note that more than one relay process could be using the same manager account.
   * @param currentBlock
   */
  async withdrawAllFunds (withdrawManager: boolean, currentBlock: number): Promise<TransactionReceipt[]> {
    let receipts: TransactionReceipt[] = []
    receipts = receipts.concat(await this._sendWorkersEthBalancesToOwner(currentBlock))
    if (withdrawManager) {
      receipts = receipts.concat(await this._sendManagerHubBalanceToOwner(currentBlock))
      receipts = receipts.concat(await this._sendManagerEthBalanceToOwner(currentBlock))
    }

    this.eventEmitter.emit('unstaked')
    return receipts
  }

  async refreshBalance (): Promise<void> {
    this.balanceRequired.currentValue = toBN(await this.contractInteractor.getBalance(this.managerAddress))
  }

  async refreshStake (): Promise<void> {
    const stakeInfo = await this.contractInteractor.getStakeInfo(this.managerAddress)
    const stake = toBN(stakeInfo.stake)
    if (stake.eq(toBN(0))) {
      return
    }

    // a locked stake does not have the 'withdrawBlock' field set
    this.isStakeLocked = stakeInfo.withdrawBlock === '0'
    this.stakeRequired.currentValue = stake

    // first time getting stake, setting owner
    if (this.ownerAddress == null) {
      this.ownerAddress = stakeInfo.owner
      console.log(`Got staked for the first time. Owner: ${this.ownerAddress}. Stake: ${this.stakeRequired.currentValue.toString()}`)
    }
  }

  isRegistrationAllowed (): boolean {
    if (!this.isHubAuthorized || this.stakeRequired.isSatisfied) {
      log.debug(`can't register yet: auth=${this.isHubAuthorized} stake=${this.stakeRequired.currentValue.toString()}`)
      return false
    }
    return true
  }

  async addRelayWorker (currentBlock: number): Promise<TransactionReceipt> {
    // register on chain
    const addRelayWorkerMethod = await this.contractInteractor.getAddRelayWorkersMethod([this.workerAddress])
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      method: addRelayWorkerMethod,
      destination: this.hubAddress,
      creationBlockNumber: currentBlock
    }
    const tx = await this.transactionManager.sendTransaction(details)
    return tx.receipt
  }

  // TODO: extract worker registration sub-flow
  async attemptRegistration (hubEventsSinceLastScan: EventData[], currentBlock: number): Promise<TransactionReceipt[]> {
    const allPrerequisitesOk =
      this.isHubAuthorized &&
      this.isStakeLocked &&
      this.stakeRequired.isSatisfied &&
      this.balanceRequired.isSatisfied
    if (!allPrerequisitesOk) {
      return []
    }

    let receipts: TransactionReceipt[] = []
    // add worker only if not already added
    const workersAdded = await this._areWorkersAdded(hubEventsSinceLastScan)
    if (!workersAdded) {
      receipts = receipts.concat(await this.addRelayWorker(currentBlock))
    }
    const registerMethod = await this.contractInteractor.getRegisterRelayMethod(this.config.baseRelayFee, this.config.pctRelayFee, this.config.url)
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      method: registerMethod,
      destination: this.hubAddress,
      creationBlockNumber: currentBlock
    }
    const tx = await this.transactionManager.sendTransaction(details)
    receipts = receipts.concat(tx.receipt)
    log.debug(`Relay ${this.managerAddress} registered on hub ${this.hubAddress}. `)
    return receipts
  }

  async _sendManagerEthBalanceToOwner (currentBlock: number): Promise<TransactionReceipt[]> {
    const gasPrice = await this.contractInteractor.getGasPrice()
    const receipts: TransactionReceipt[] = []
    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit).mul(toBN(gasPrice))

    const managerBalance = toBN(await this.contractInteractor.getBalance(this.managerAddress))
    // sending manager eth balance to owner
    if (managerBalance.gte(txCost)) {
      console.log(`Sending manager eth balance ${managerBalance.toString()} to owner`)
      const details: SendTransactionDetails = {
        signer: this.managerAddress,
        destination: this.ownerAddress as string,
        gasLimit: gasLimit.toString(),
        gasPrice,
        value: toHex(managerBalance.sub(txCost)),
        creationBlockNumber: currentBlock
      }
      const tx = await this.transactionManager.sendTransaction(details)
      receipts.push(tx.receipt)
    } else {
      console.log(`manager balance too low: ${managerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return receipts
  }

  async _sendWorkersEthBalancesToOwner (currentBlock: number): Promise<TransactionReceipt[]> {
    // sending workers' balance to owner (currently one worker, todo: extend to multiple)
    const receipts: TransactionReceipt[] = []
    const gasPrice = await this.contractInteractor.getGasPrice()
    const gasLimit = mintxgascost
    const txCost = toBN(gasLimit * parseInt(gasPrice))
    const workerBalance = toBN(await this.contractInteractor.getBalance(this.workerAddress))
    if (workerBalance.gte(txCost)) {
      console.log(`Sending workers' eth balance ${workerBalance.toString()} to owner`)
      const details = {
        signer: this.workerAddress,
        destination: this.ownerAddress as string,
        gasLimit: gasLimit.toString(),
        gasPrice,
        value: toHex(workerBalance.sub(txCost)),
        creationBlockNumber: currentBlock
      }
      const tx = await this.transactionManager.sendTransaction(details)
      receipts.push(tx.receipt)
    } else {
      console.log(`balance too low: ${workerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return receipts
  }

  async _sendManagerHubBalanceToOwner (currentBlock: number): Promise<TransactionReceipt[]> {
    if (this.ownerAddress == null) {
      throw new Error('Owner address not initialized')
    }
    const receipts: TransactionReceipt[] = []
    const gasPrice = await this.contractInteractor.getGasPrice()
    const managerHubBalance = await this.contractInteractor.hubBalanceOf(this.managerAddress)
    const { gasCost, method } = await this.contractInteractor.withdrawHubBalanceEstimateGas(managerHubBalance, this.ownerAddress, this.managerAddress, gasPrice)
    if (managerHubBalance.gte(gasCost)) {
      console.log(`Sending manager hub balance ${managerHubBalance.toString()} to owner`)
      const details: SendTransactionDetails = {
        signer: this.managerAddress,
        destination: this.hubAddress,
        creationBlockNumber: currentBlock,
        method
      }
      const tx = await this.transactionManager.sendTransaction(details)
      receipts.push(tx.receipt)
    } else {
      console.log(`manager hub balance too low: ${managerHubBalance.toString()}, tx cost: ${gasCost.toString()}`)
    }
    return receipts
  }

  async _areWorkersAdded (hubEventsSinceLastScan: EventData[]): Promise<boolean> {
    const lastWorkerAddedSinceLastScan = reduceToLatestTx(hubEventsSinceLastScan.filter((it) => it.event === RelayWorkersAdded))
    if (lastWorkerAddedSinceLastScan != null) {
      this.lastWorkerAddedTransaction = lastWorkerAddedSinceLastScan
    }
    if (this.lastWorkerAddedTransaction == null) {
      this.lastWorkerAddedTransaction = await this._queryLatestWorkerAddedEvent()
    }
    return this._isWorkerValid()
  }

  async _queryLatestWorkerAddedEvent (): Promise<EventData | undefined> {
    const workersAddedEvents = await this.contractInteractor.getPastEventsForHub([address2topic(this.managerAddress)],
      {
        fromBlock: 1
      },
      [RelayWorkersAdded])
    return reduceToLatestTx(workersAddedEvents)
  }

  _isWorkerValid (): boolean {
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
    return this.lastWorkerAddedTransaction != null && this.lastWorkerAddedTransaction.returnValues.newRelayWorkers
      .map((a: string) => a.toLowerCase()).includes(this.workerAddress.toLowerCase())
  }

  async assertManagerBalance (): Promise<void> {
    await this.refreshBalance()

    if (!this.balanceRequired.isSatisfied) {
      throw new StateError(
        `Balance too low - ${this.balanceRequired.description}`)
    }
  }

  // TODO: !!! !!! this is the original reason for this refactoring. It is not reasonable to throw exceptions to expose not registered state.
  async assertRegistered (): Promise<void> {
    if (!this.stakeRequired.isSatisfied) {
      throw new StateError(`Stake too low - ${this.stakeRequired.description}`)
    }

    // TODO: this check is new and is not covered by tests
    if (!this.isStakeLocked) {
      throw new StateError('Stake not locked')
    }

    if (!this.isHubAuthorized) {
      throw new StateError('Hub not authorized.')
    }
    const isRegistrationCorrect = await this._isRegistrationCorrect([])
    if (!isRegistrationCorrect) {
      throw new StateError('Not registered yet.')
    }
  }
}
