import { Address } from '../common/types/Aliases'
import { LoggerInterface } from '../common/LoggerInterface'
import { ReputationStoreManager } from './ReputationStoreManager'
import { ReputationChange, ReputationEntry } from './ReputationEntry'

export interface ReputationManagerConfiguration {
  /** All new Paymasters start with their reputation set to this value  */
  initialReputation: number
  /** No matter how good the Paymaster is, it's reputation cannot go above this value */
  maximumReputation: number
  /** If the reputation is below this value, transactions will only be allowed each {@link throttleDelayMs} */
  throttleReputation: number
  /** Minimum interval between transactions paid by a specific throttled Paymaster */
  throttleDelayMs: number
  /** Paymasters with reputation below this value will never be served */
  blockReputation: number
  /** If a paymaster loses this number of reputation points within {@link abuseTimeWindowBlocks}, it
   * will be blocked for {@link abuseBlacklistDurationBlocks}
   */
  abuseReputationChange: number
  abuseTimeWindowBlocks: number
  abuseBlacklistDurationBlocks: number
  /** After {@link abuseBlacklistDurationBlocks}, the Paymaster reputation will be reset to this value */
  abuseTimeoutReputation: number
}

const defaultReputationConfig: ReputationManagerConfiguration = {
  initialReputation: 3,
  maximumReputation: 100,
  throttleReputation: 5,
  throttleDelayMs: 60000,
  blockReputation: 0,
  abuseTimeoutReputation: 1,
  abuseReputationChange: 20,
  abuseTimeWindowBlocks: 240,
  abuseBlacklistDurationBlocks: 6000
}

/**
 * Only Paymaster marked as {@link GOOD} is to be allowed to proceed.
 * Note: {@link THROTTLED} value is returned only if subsequent transaction is requested too soon.
 */
export enum PaymasterStatus {
  GOOD,
  THROTTLED,
  ABUSED,
  BLOCKED
}

function resolveReputationManagerConfiguration (partialConfig: Partial<ReputationManagerConfiguration>): ReputationManagerConfiguration {
  return Object.assign({}, defaultReputationConfig, partialConfig)
}

export class ReputationManager {
  config: ReputationManagerConfiguration
  /*
  reputationStoreManager: ReputationStoreManager
   */
  localReputationEntries = new Map<Address, ReputationEntry>()
  logger: LoggerInterface

  constructor (reputationStoreManager: ReputationStoreManager, logger: LoggerInterface, partialConfig: Partial<ReputationManagerConfiguration>) {
    this.config = resolveReputationManagerConfiguration(partialConfig)
    /*
    this.reputationStoreManager = reputationStoreManager
     */
    this.logger = logger
  }

  async getPaymasterStatus (paymaster: Address, currentBlockNumber: number): Promise<PaymasterStatus> {
    /*
    const entry =
      await this.reputationStoreManager.getEntry(paymaster) ??
      await this.reputationStoreManager.createEntry(paymaster, this.config.initialReputation)
     */
    const entry = this.localReputationEntries.get(paymaster.toLowerCase()) ??
      this.createNewEntry(paymaster)
    if (entry.reputation <= this.config.blockReputation) {
      return PaymasterStatus.BLOCKED
    }
    if (entry.abuseStartedBlock !== 0) {
      if (currentBlockNumber - entry.abuseStartedBlock <= this.config.abuseTimeWindowBlocks) {
        return PaymasterStatus.ABUSED
      } else {
        /*
        await this.reputationStoreManager.clearAbuseFlag(paymaster, this.config.abuseTimeoutReputation)
         */
        entry.abuseStartedBlock = 0
      }
    }
    if (
      entry.reputation < this.config.throttleReputation &&
      Date.now() - entry.lastAcceptedRelayRequestTs <= this.config.throttleDelayMs) {
      return PaymasterStatus.THROTTLED
    }
    return PaymasterStatus.GOOD
  }

  createNewEntry (paymaster: string): ReputationEntry {
    const newEntry = {
      paymaster: paymaster.toLowerCase(),
      reputation: this.config.initialReputation,
      lastAcceptedRelayRequestTs: 0,
      abuseStartedBlock: 0,
      changes: []
    }
    this.localReputationEntries.set(paymaster.toLowerCase(), newEntry)
    return newEntry
  }

  async onRelayRequestAccepted (paymaster: Address): Promise<void> {
    /*
    await this.reputationStoreManager.updateLastAcceptedTimestamp(paymaster)
     */
    const lastAcceptedRelayRequestTs = Date.now()
    const entry = this.localReputationEntries.get(paymaster.toLowerCase()) ??
      this.createNewEntry(paymaster)
    entry.lastAcceptedRelayRequestTs = lastAcceptedRelayRequestTs
    this.logger.debug(`Paymaster ${paymaster} was last accepted at ${lastAcceptedRelayRequestTs}`)
  }

  async updatePaymasterStatus (paymaster: Address, transactionSuccess: boolean, eventBlockNumber: number): Promise<void> {
    const change = transactionSuccess ? 1 : -1
    /*
    const entry =
      await this.reputationStoreManager.getEntry(paymaster)
     */
    const entry = this.localReputationEntries.get(paymaster.toLowerCase()) ??
      this.createNewEntry(paymaster)
    if (entry == null) {
      throw new Error(`Could not query reputation for paymaster: ${paymaster}`)
    }
    if (entry.reputation + change > this.config.maximumReputation) {
      return
    }
    const changeInAbuseWindow = entry.changes
      .filter(it => eventBlockNumber - it.blockNumber < this.config.abuseTimeWindowBlocks)
      .reduce((previousValue: number, currentValue: ReputationChange) => previousValue + currentValue.change, 0)
    if (-changeInAbuseWindow >= this.config.abuseReputationChange) {
      /*
      await this.reputationStoreManager.setAbuseFlag(paymaster)
       */
      entry.abuseStartedBlock = eventBlockNumber
    }
    const oldChangesExpirationBlock = eventBlockNumber - this.config.abuseTimeWindowBlocks
    /*
    await this.reputationStoreManager.updatePaymasterReputation(paymaster, change, oldChangesExpirationTs)
     */
    this.updatePaymasterReputation(paymaster, change, oldChangesExpirationBlock, eventBlockNumber)
  }

  updatePaymasterReputation (
    paymaster: Address,
    change: number,
    oldChangesExpirationBlock: number,
    eventBlockNumber: number
  ): void {
    if (eventBlockNumber <= oldChangesExpirationBlock) {
      throw new Error(`Invalid change expiration parameter! Passed ${oldChangesExpirationBlock}, but event was emitted at block height ${eventBlockNumber}`)
    }

    const existing: ReputationEntry = this.localReputationEntries.get(paymaster.toLowerCase()) ??
      this.createNewEntry(paymaster)
    const reputationChange: ReputationChange = {
      blockNumber: eventBlockNumber,
      change
    }
    const reputation = existing.reputation + change
    const changes =
      [...existing.changes, reputationChange]
        .filter(it => it.blockNumber > oldChangesExpirationBlock)
    existing.reputation = reputation
    existing.changes = changes
    this.logger.info(`Paymaster ${paymaster} reputation changed from ${existing.reputation} to ${reputation}. Change is ${change}`)
  }
}
