import chalk from 'chalk'
import { PastEventOptions } from 'web3-eth-contract'
import { EventEmitter } from 'events'
import { PrefixedHexString } from 'ethereumjs-util'
import { Block } from '@ethersproject/providers'
import { toBN, toHex } from 'web3-utils'

import {
  Address,
  AmountRequired,
  ContractInteractor,
  EventData,
  EventFilterBlocks,
  LoggerInterface,
  RegistrarRelayInfo,
  constants,
  toNumber
} from '@opengsn/common'

import {
  address2topic,
  isSameAddress,
  boolString
} from '@opengsn/common/dist/Utils'

import { SendTransactionDetails, TransactionManager } from './TransactionManager'
import { ServerConfigParams } from './ServerConfigParams'
import { TxStoreManager } from './TxStoreManager'
import { ServerAction } from './StoredTransaction'

import {
  HubAuthorized,
  HubUnauthorized,
  OwnerSet,
  StakeAdded,
  StakeUnlocked,
  StakeWithdrawn
} from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { Web3MethodsBuilder } from './Web3MethodsBuilder'

export class RegistrationManager {
  balanceRequired!: AmountRequired
  stakeRequired!: AmountRequired
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
  web3MethodsBuilder: Web3MethodsBuilder
  ownerAddress?: Address
  transactionManager: TransactionManager
  config: ServerConfigParams
  txStoreManager: TxStoreManager
  logger: LoggerInterface

  currentRelayInfo?: RegistrarRelayInfo
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
    web3methodsBuilder: Web3MethodsBuilder,
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
    this.web3MethodsBuilder = web3methodsBuilder
    this.hubAddress = config.relayHubAddress
    this.managerAddress = managerAddress
    this.workerAddress = workerAddress
    this.eventEmitter = eventEmitter
    this.transactionManager = transactionManager
    this.txStoreManager = txStoreManager
    this.config = config
  }

  async init (lastScannedBlock: number, latestBlock: Block): Promise<PrefixedHexString[]> {
    let transactionHashes: PrefixedHexString[] = []
    const tokenMetadata = await this.contractInteractor.getErc20TokenMetadata()
    const listener = (): void => {
      this.printNotRegisteredMessage()
    }
    const minimumStakePerToken = await this.contractInteractor.getMinimumStakePerToken(this.config.managerStakeTokenAddress)
    this.balanceRequired = new AmountRequired('Balance', toBN(this.config.managerMinBalance), constants.ZERO_ADDRESS, this.logger, listener)
    this.stakeRequired = new AmountRequired('Stake', minimumStakePerToken, constants.ZERO_ADDRESS, this.logger, listener, tokenMetadata)
    await this.refreshBalance()
    const latestBlockTimestamp = toNumber(latestBlock.timestamp)
    transactionHashes = transactionHashes.concat(await this.refreshStake(latestBlock.number, latestBlock.hash, latestBlockTimestamp))
    this.isInitialized = true
    return transactionHashes
  }

  async handlePastEvents (
    hubEventsSinceLastScan: EventData[],
    lastScannedBlock: number,
    currentBlock: Block,
    currentBlockTimestamp: number,
    forceRegistration: boolean): Promise<PrefixedHexString[]> {
    if (!this.isInitialized) {
      throw new Error('RegistrationManager not initialized')
    }
    const topics = [address2topic(this.managerAddress)]
    const options: EventFilterBlocks = {
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
          transactionHashes = transactionHashes.concat(await this.setOwnerInStakeManager(currentBlock.number, currentBlock.hash, currentBlockTimestamp))
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
      switch (eventData.name) {
        case HubAuthorized:
          this.logger.warn(`Handling HubAuthorized event: ${JSON.stringify(eventData)} in block ${currentBlock.number}`)
          await this._handleHubAuthorizedEvent(eventData)
          break
        case OwnerSet:
          transactionHashes = transactionHashes.concat(await this.refreshStake(currentBlock.number, currentBlock.hash, currentBlockTimestamp))
          this.logger.warn(`Handling OwnerSet event: ${JSON.stringify(eventData)} in block ${currentBlock.number}`)
          break
        case StakeAdded:
          transactionHashes = transactionHashes.concat(await this.refreshStake(currentBlock.number, currentBlock.hash, currentBlockTimestamp))
          this.logger.warn(`Handling StakeAdded event: ${JSON.stringify(eventData)} in block ${currentBlock.number}`)
          break
        case HubUnauthorized:
          this.logger.warn(`Handling HubUnauthorized event: ${JSON.stringify(eventData)} in block ${currentBlock.number}`)
          if (isSameAddress(eventData.args.relayHub, this.hubAddress)) {
            this.isHubAuthorized = false
            this.delayedEvents.push({ time: eventData.args.removalTime.toString(), eventData })
          }
          break
        case StakeUnlocked:
          this.logger.warn(`Handling StakeUnlocked event: ${JSON.stringify(eventData)} in block ${currentBlock.number}`)
          transactionHashes = transactionHashes.concat(await this.refreshStake(currentBlock.number, currentBlock.hash, currentBlockTimestamp))
          break
        case StakeWithdrawn:
          this.logger.warn(`Handling StakeWithdrawn event: ${JSON.stringify(eventData)} in block ${currentBlock.number}`)
          transactionHashes = transactionHashes.concat(await this.refreshStake(currentBlock.number, currentBlock.hash, currentBlockTimestamp))
          transactionHashes = transactionHashes.concat(await this._handleStakeWithdrawnEvent(eventData, currentBlock.number, currentBlock.hash, currentBlockTimestamp))
          break
      }
    }

    // handle HubUnauthorized only after the due time
    const currentBlockTime = currentBlock.timestamp
    for (const eventData of this._extractDuePendingEvents(currentBlockTime)) {
      switch (eventData.name) {
        case HubUnauthorized:
          transactionHashes = transactionHashes.concat(await this._handleHubUnauthorizedEvent(eventData, currentBlock.number, currentBlock.hash, currentBlockTimestamp))
          break
      }
    }
    await this.refreshRegistrarRelayInfo()
    const isRegistrationCorrect = this._isRegistrationCorrect()
    const isRegistrationPending = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.REGISTER_SERVER, currentBlock.number, this.config.recentActionAvoidRepeatDistanceBlocks)
    if (!(isRegistrationPending || isRegistrationCorrect) || forceRegistration) {
      this.logger.debug(`will attempt registration: isRegistrationPending=${isRegistrationPending} isRegistrationCorrect=${isRegistrationCorrect} forceRegistration=${forceRegistration}`)
      transactionHashes = transactionHashes.concat(await this.attemptRegistration(currentBlock.number, currentBlock.hash, currentBlockTimestamp))
    }
    return transactionHashes
  }

  _extractDuePendingEvents (currentBlockTime: number | string): EventData[] {
    const currentBlockTimeNumber = toNumber(currentBlockTime)
    const ret = this.delayedEvents.filter(event => event.time <= currentBlockTimeNumber).map(e => e.eventData)
    this.delayedEvents = [...this.delayedEvents.filter(event => event.time > currentBlockTimeNumber)]
    return ret
  }

  async refreshRegistrarRelayInfo (): Promise<void> {
    try {
      this.currentRelayInfo = await this.contractInteractor.getRelayInfo(this.managerAddress)
    } catch (error: any) {
      this.logger.info(error)
      this.currentRelayInfo = undefined
    }
  }

  _isRegistrationCorrect (): boolean {
    return this.currentRelayInfo != null && this.currentRelayInfo.relayUrl === this.config.url
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
    if (dlog.args.relayHub.toLowerCase() === this.hubAddress.toLowerCase()) {
      this.isHubAuthorized = true
    }
  }

  async _handleHubUnauthorizedEvent (dlog: EventData, currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString[]> {
    return await this.withdrawAllFunds(false, currentBlockNumber, currentBlockHash, currentBlockTimestamp)
  }

  async _handleStakeWithdrawnEvent (dlog: EventData, currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString[]> {
    this.logger.warn(`Handling StakeWithdrawn event: ${JSON.stringify(dlog)}`)
    return await this.withdrawAllFunds(true, currentBlockNumber, currentBlockHash, currentBlockTimestamp)
  }

  /**
   * @param withdrawManager - whether to send the relay manager's balance to the owner.
   *        Note that more than one relay process could be using the same manager account.
   * @param currentBlock
   */
  async withdrawAllFunds (withdrawManager: boolean, currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString[]> {
    let transactionHashes: PrefixedHexString[] = []
    transactionHashes = transactionHashes.concat(await this._sendManagerHubBalanceToOwner(currentBlockNumber, currentBlockHash, currentBlockTimestamp))
    transactionHashes = transactionHashes.concat(await this._sendWorkersEthBalancesToOwner(currentBlockNumber, currentBlockHash, currentBlockTimestamp))
    if (withdrawManager) {
      transactionHashes = transactionHashes.concat(await this._sendManagerEthBalanceToOwner(currentBlockNumber, currentBlockHash, currentBlockTimestamp))
    }

    this.eventEmitter.emit('unstaked')
    return transactionHashes
  }

  async refreshBalance (): Promise<void> {
    const currentBalance = await this.contractInteractor.getBalance(this.managerAddress)
    this.balanceRequired.currentValue = toBN(currentBalance)
  }

  async refreshStake (currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString[]> {
    const transactionHashes: string[] = []
    const stakeInfo = await this.contractInteractor.getStakeInfo(this.managerAddress)
    const stakedOnHubStatus = await this.contractInteractor.isRelayManagerStakedOnHub(this.managerAddress)
    if (stakedOnHubStatus.isStaked) {
      this.isHubAuthorized = true
    } else if (stakedOnHubStatus.errorMessage === 'this hub is not authorized by SM') {
      const isAuthorizePending =
        await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.AUTHORIZE_HUB, currentBlockNumber, this.config.recentActionAvoidRepeatDistanceBlocks)
      if (!isAuthorizePending) {
        const authorizeHubByManagerMethod = await this.web3MethodsBuilder.getAuthorizeHubByManagerMethod(this.hubAddress)
        const details: SendTransactionDetails = {
          signer: this.managerAddress,
          serverAction: ServerAction.AUTHORIZE_HUB,
          method: authorizeHubByManagerMethod,
          destination: this.contractInteractor.stakeManagerAddress(),
          creationBlockNumber: currentBlockNumber,
          creationBlockHash: currentBlockHash,
          creationBlockTimestamp: currentBlockTimestamp
        }
        this.logger.warn(`Currently configured RelayHub is not authorized! Authorizing new RelayHub: ${this.hubAddress}`)
        const { transactionHash } = await this.transactionManager.sendTransaction(details)
        transactionHashes.push(transactionHash)
      }
    }
    const stake = stakeInfo.stake
    this._isOwnerSetOnStakeManager = stakeInfo.owner !== constants.ZERO_ADDRESS
    if (this._isOwnerSetOnStakeManager && !isSameAddress(stakeInfo.owner, this.config.ownerAddress)) {
      throw new Error(`This Relay Manager has set owner to already! On-chain: ${stakeInfo.owner}, in config: ${this.config.ownerAddress}`)
    }
    if (stake.eq(toBN(0))) {
      return transactionHashes
    }

    // a locked stake does not have the 'withdrawTime' field set
    this.isStakeLocked = stakeInfo.withdrawTime.toString() === '0'
    this.stakeRequired.currentValue = stake
    this.stakeRequired.currentTokenAddress = stakeInfo.token

    // first time getting stake, setting owner
    if (this.ownerAddress == null) {
      this.ownerAddress = stakeInfo.owner
      this.logger.info('Got staked for the first time')
      this.printNotRegisteredMessage()
    }

    return transactionHashes
  }

  async addRelayWorker (currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString> {
    // register on chain
    const addRelayWorkerMethod = await this.web3MethodsBuilder.getAddRelayWorkersMethod([this.workerAddress])
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      serverAction: ServerAction.ADD_WORKER,
      method: addRelayWorkerMethod,
      destination: this.hubAddress,
      creationBlockNumber: currentBlockNumber,
      creationBlockHash: currentBlockHash,
      creationBlockTimestamp: currentBlockTimestamp
    }
    this.logger.info(`adding relay worker ${this.workerAddress}`)
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    return transactionHash
  }

  // TODO: extract worker registration sub-flow
  async attemptRegistration (
    currentBlockNumber: number,
    currentBlockHash: string,
    currentBlockTimestamp: number
  ): Promise<PrefixedHexString[]> {
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
      await this.refreshStake(currentBlockNumber, currentBlockHash, currentBlockTimestamp)
      await this.refreshBalance()
      return []
    }

    let transactions: PrefixedHexString[] = []
    // add worker only if not already added
    const workersAdded = await this._isWorkerValid()
    const addWorkersPending = await this.txStoreManager.isActionPendingOrRecentlyMined(ServerAction.ADD_WORKER, currentBlockNumber, this.config.recentActionAvoidRepeatDistanceBlocks)
    let skipGasEstimationForRegisterRelay = false
    if (!(workersAdded || addWorkersPending)) {
      const txHash = await this.addRelayWorker(currentBlockNumber, currentBlockHash, currentBlockTimestamp)
      transactions = transactions.concat(txHash)
      skipGasEstimationForRegisterRelay = true
    }
    const registerMethod = await this.web3MethodsBuilder.getRegisterRelayMethod(this.hubAddress, this.config.url)
    let gasLimit: number | undefined
    if (skipGasEstimationForRegisterRelay) {
      gasLimit = this.config.defaultGasLimit
    }
    const registrarAddress = this.contractInteractor.relayRegistrar.address
    const details: SendTransactionDetails = {
      serverAction: ServerAction.REGISTER_SERVER,
      gasLimit,
      signer: this.managerAddress,
      method: registerMethod,
      destination: registrarAddress,
      creationBlockNumber: currentBlockNumber,
      creationBlockHash: currentBlockHash,
      creationBlockTimestamp: currentBlockTimestamp
    }
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    transactions = transactions.concat(transactionHash)
    this.logger.debug(`Relay ${this.managerAddress} registered on hub ${this.hubAddress} via registrar ${registrarAddress}. `)
    return transactions
  }

  async _sendManagerEthBalanceToOwner (currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString[]> {
    // todo add better maxFeePerGas, maxPriorityFeePerGas
    const gasPrice = await this.contractInteractor.getGasPrice()
    const transactionHashes: PrefixedHexString[] = []
    const managerBalance = toBN(await this.contractInteractor.getBalance(this.managerAddress))
    const gasLimit = await this.contractInteractor.estimateGas({
      from: this.managerAddress,
      to: this.ownerAddress as string,
      value: managerBalance.toString()
    })
    const txCost = toBN(gasLimit).mul(toBN(gasPrice))

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
        creationBlockNumber: currentBlockNumber,
        creationBlockHash: currentBlockHash,
        creationBlockTimestamp: currentBlockTimestamp
      }
      const { transactionHash } = await this.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    } else {
      this.logger.error(`manager balance too low: ${managerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return transactionHashes
  }

  async _sendWorkersEthBalancesToOwner (currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString[]> {
    // sending workers' balance to owner (currently one worker, todo: extend to multiple)
    const transactionHashes: PrefixedHexString[] = []
    // todo add better maxFeePerGas, maxPriorityFeePerGas
    const gasPrice = await this.contractInteractor.getGasPrice()
    const workerBalance = toBN(await this.contractInteractor.getBalance(this.workerAddress))
    const gasLimit = await this.contractInteractor.estimateGas({
      from: this.managerAddress,
      to: this.ownerAddress as string,
      value: workerBalance.toString()
    })
    const txCost = toBN(gasLimit * parseInt(gasPrice))

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
        creationBlockNumber: currentBlockNumber,
        creationBlockHash: currentBlockHash,
        creationBlockTimestamp: currentBlockTimestamp
      }
      const { transactionHash } = await this.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    } else {
      this.logger.info(`balance too low: ${workerBalance.toString()}, tx cost: ${gasLimit * parseInt(gasPrice)}`)
    }
    return transactionHashes
  }

  async _sendManagerHubBalanceToOwner (
    currentBlockNumber: number,
    currentBlockHash: string,
    currentBlockTimestamp: number,
    amount?: BN): Promise<PrefixedHexString[]> {
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
    } = await this.web3MethodsBuilder.withdrawHubBalanceEstimateGas(this.ownerAddress, amount, this.managerAddress, gasPrice)
    if (amount.gte(gasCost)) {
      this.logger.info(`Sending manager hub balance ${amount.toString()} to owner`)
      const details: SendTransactionDetails = {
        gasLimit,
        signer: this.managerAddress,
        serverAction: ServerAction.DEPOSIT_WITHDRAWAL,
        destination: this.hubAddress,
        creationBlockNumber: currentBlockNumber,
        creationBlockHash: currentBlockHash,
        creationBlockTimestamp: currentBlockTimestamp,
        method
      }
      const { transactionHash } = await this.transactionManager.sendTransaction(details)
      transactionHashes.push(transactionHash)
    } else {
      this.logger.error(`manager hub balance too low: ${managerHubBalance.toString()}, tx cost: ${gasCost.toString()}`)
    }
    return transactionHashes
  }

  async _isWorkerValid (): Promise<boolean> {
    const managerFromHub = await this.contractInteractor.workerToManager(this.workerAddress)
    if (managerFromHub.toLowerCase() === this.managerAddress.toLowerCase()) {
      return true
    }
    return false
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
Stake Owner    | ${this.ownerAddress ?? chalk.yellow('not set yet')}
Config Owner   | ${this.config.ownerAddress} ${this.ownerAddress != null && !isSameAddress(this.ownerAddress, this.config.ownerAddress) ? chalk.red('MISMATCH') : ''}
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
Name      | ${decodedEvent.name.padEnd(25)}
Block     | ${decodedEvent.blockNumber}
TxHash    | ${decodedEvent.transactionHash}
`)
    }
  }

  // TODO: duplicated code; another leaked web3 'method' abstraction
  async setOwnerInStakeManager (currentBlockNumber: number, currentBlockHash: string, currentBlockTimestamp: number): Promise<PrefixedHexString> {
    const setRelayManagerMethod = await this.web3MethodsBuilder.getSetRelayManagerMethod(this.config.ownerAddress)
    const stakeManagerAddress = this.contractInteractor.stakeManagerAddress()
    const details: SendTransactionDetails = {
      signer: this.managerAddress,
      serverAction: ServerAction.SET_OWNER,
      method: setRelayManagerMethod,
      destination: stakeManagerAddress,
      creationBlockNumber: currentBlockNumber,
      creationBlockHash: currentBlockHash,
      creationBlockTimestamp: currentBlockTimestamp
    }
    this.logger.info(`setting relay owner ${this.config.ownerAddress} at StakeManager ${stakeManagerAddress}`)
    const { transactionHash } = await this.transactionManager.sendTransaction(details)
    return transactionHash
  }
}
