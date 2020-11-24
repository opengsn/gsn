import AsyncNedb from 'nedb-async'

import { LoggerInterface } from '../common/LoggerInterface'
import { ReputationChange, ReputationEntry } from './ReputationEntry'
import { Address } from '../relayclient/types/Aliases'

export const REPUTATION_STORE_FILENAME = 'reputation_store.db'

export class ReputationStoreManager {
  private readonly txstore: AsyncNedb<any>
  private readonly logger: LoggerInterface

  constructor ({ workdir = '/tmp/test/' }, logger: LoggerInterface) {
    this.logger = logger
    const filename = `${workdir}/${REPUTATION_STORE_FILENAME}`
    this.txstore = new AsyncNedb({
      filename,
      autoload: true,
      timestampData: true
    })
    this.txstore.ensureIndex({ fieldName: 'paymaster', unique: true })
    this.logger.info(`Reputation system database location: ${filename}`)
  }

  async createEntry (paymaster: Address, reputation: number): Promise<ReputationEntry> {
    const entry: ReputationEntry = {
      paymaster: paymaster.toLowerCase(),
      reputation,
      lastAcceptedRelayRequestTs: 0,
      abuseStartedTs: 0,
      changes: []
    }
    return await this.txstore.asyncInsert(entry)
  }

  async clearAbuseFlag (paymaster: Address, reputation: number): Promise<void> {
    const update: Partial<ReputationEntry> = {
      reputation,
      abuseStartedTs: 0
    }
    await this.updateEntry(paymaster, update)
  }

  async setAbuseFlag (paymaster: Address): Promise<void> {
    const update: Partial<ReputationEntry> = {
      abuseStartedTs: Date.now()
    }
    this.logger.warn(`Paymaster ${paymaster} was flagged as abused`)
    await this.updateEntry(paymaster, update)
  }

  async updateLastAcceptedTimestamp (paymaster: Address): Promise<void> {
    const lastAcceptedRelayRequestTs = Date.now()
    const update: Partial<ReputationEntry> = {
      lastAcceptedRelayRequestTs
    }
    this.logger.debug(`Paymaster ${paymaster} was last accepted at ${lastAcceptedRelayRequestTs}`)
    await this.updateEntry(paymaster, update)
  }

  async updatePaymasterReputation (paymaster: Address, change: number, oldChangesExpirationTs: number): Promise<void> {
    const now = Date.now()
    if (now <= oldChangesExpirationTs) {
      throw new Error(`Invalid change expiration parameter! Passed ${oldChangesExpirationTs}, but current clock is at ${now}`)
    }
    const existing: ReputationEntry = await this.txstore.asyncFindOne({ paymaster: paymaster.toLowerCase() })
    const reputationChange: ReputationChange = {
      timestamp: now,
      change
    }
    const reputation = existing.reputation + change
    const changes =
      [...existing.changes, reputationChange]
        .filter(it => it.timestamp > oldChangesExpirationTs)
    const update: Partial<ReputationEntry> = {
      reputation,
      changes
    }
    this.logger.info(`Paymaster ${paymaster} reputation changed from ${existing.reputation} to ${reputation}. Change is ${change}`)
    await this.updateEntry(paymaster, update)
  }

  private async updateEntry (paymaster: Address, update: Partial<ReputationEntry>): Promise<void> {
    const existing: ReputationEntry = await this.txstore.asyncFindOne({ paymaster: paymaster.toLowerCase() })
    const entry = Object.assign({}, existing, update)
    await this.txstore.asyncUpdate({ paymaster: existing.paymaster }, { $set: entry })
  }

  async getEntry (paymaster: Address): Promise<ReputationEntry | undefined> {
    return await this.txstore.asyncFindOne({ paymaster: paymaster.toLowerCase() })
  }

  async clearAll (): Promise<void> {
    await this.txstore.asyncRemove({}, { multi: true })
  }
}
