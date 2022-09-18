import { Mutex } from 'async-mutex'
import { Address, LoggerInterface } from '@opengsn/common'

import { ReputationStoreManager } from './ReputationStoreManager'
import { ReputationChange } from './ReputationEntry'

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
  initialReputation: 6,
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
  reputationStoreManager: ReputationStoreManager
  logger: LoggerInterface
  mutex = new Mutex()

  constructor (reputationStoreManager: ReputationStoreManager, logger: LoggerInterface, partialConfig: Partial<ReputationManagerConfiguration>) {
    this.config = resolveReputationManagerConfiguration(partialConfig)
    this.reputationStoreManager = reputationStoreManager
    this.logger = logger
  }

  async getPaymasterStatus (paymaster: Address, currentBlockNumber: number): Promise<PaymasterStatus> {
    const releaseMutex = await this.mutex.acquire()
    try {
      const entry =
        await this.reputationStoreManager.getEntry(paymaster) ??
        await this.reputationStoreManager.createEntry(paymaster, this.config.initialReputation)
      if (entry.reputation <= this.config.blockReputation) {
        return PaymasterStatus.BLOCKED
      }
      if (entry.abuseStartedBlock !== 0) {
        if (currentBlockNumber - entry.abuseStartedBlock <= this.config.abuseTimeWindowBlocks) {
          return PaymasterStatus.ABUSED
        } else {
          await this.reputationStoreManager.clearAbuseFlag(paymaster, this.config.abuseTimeoutReputation)
        }
      }
      if (
        entry.reputation < this.config.throttleReputation &&
        Date.now() - entry.lastAcceptedRelayRequestTs <= this.config.throttleDelayMs) {
        return PaymasterStatus.THROTTLED
      }
      return PaymasterStatus.GOOD
    } finally {
      releaseMutex()
    }
  }

  async onRelayRequestAccepted (paymaster: Address): Promise<void> {
    await this.reputationStoreManager.updateLastAcceptedTimestamp(paymaster)
  }

  async updatePaymasterStatus (paymaster: Address, transactionSuccess: boolean, eventBlockNumber: number): Promise<void> {
    const change = transactionSuccess ? 1 : -1
    const entry =
      await this.reputationStoreManager.getEntry(paymaster) ??
      await this.reputationStoreManager.createEntry(paymaster, this.config.initialReputation)
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
      await this.reputationStoreManager.setAbuseFlag(paymaster, eventBlockNumber)
    }
    const oldChangesExpirationBlock = eventBlockNumber - this.config.abuseTimeWindowBlocks
    await this.reputationStoreManager.updatePaymasterReputation(paymaster, change, oldChangesExpirationBlock, eventBlockNumber)
  }
}
