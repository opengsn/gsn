import AsyncNedb from 'nedb-async'

import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { ReputationChange, ReputationEntry } from './ReputationEntry'
import { Address } from '@opengsn/common/dist/types/Aliases'

export const REPUTATION_STORE_FILENAME = 'reputation_store.db'

export class ReputationStoreManager {
  private readonly txstore: AsyncNedb<any>
  private readonly logger: LoggerInterface

  constructor ({ workdir = '/tmp/test/', inMemory = false }, logger: LoggerInterface) {
    this.logger = logger
    const filename = inMemory ? undefined : `${workdir}/${REPUTATION_STORE_FILENAME}`
    this.txstore = new AsyncNedb({
      filename,
      autoload: true,
      timestampData: true
    })
    this.txstore.ensureIndex({ fieldName: 'paymaster', unique: true })

    const dbLocationStr = inMemory ? 'memory' : `${workdir}/${REPUTATION_STORE_FILENAME}`
    this.logger.info(`Reputation system database location: ${dbLocationStr}`)
  }

  async createEntry (paymaster: Address, reputation: number): Promise<ReputationEntry> {
    const entry: ReputationEntry = {
      paymaster: paymaster.toLowerCase(),
      reputation,
      lastAcceptedRelayRequestTs: 0,
      abuseStartedBlock: 0,
      changes: []
    }
    return await this.txstore.asyncInsert(entry)
  }

  async clearAbuseFlag (paymaster: Address, reputation: number): Promise<void> {
    const update: Partial<ReputationEntry> = {
      reputation,
      abuseStartedBlock: 0
    }
    await this.updateEntry(paymaster, update)
  }

  async setAbuseFlag (paymaster: Address, eventBlockNumber: number): Promise<void> {
    const update: Partial<ReputationEntry> = {
      abuseStartedBlock: eventBlockNumber
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

  async updatePaymasterReputation (paymaster: Address, change: number, oldChangesExpirationBlock: number, eventBlockNumber: number): Promise<void> {
    if (eventBlockNumber <= oldChangesExpirationBlock) {
      throw new Error(`Invalid change expiration parameter! Passed ${oldChangesExpirationBlock}, but event was emitted at block height ${eventBlockNumber}`)
    }
    const existing: ReputationEntry = await this.txstore.asyncFindOne({ paymaster: paymaster.toLowerCase() })
    const reputationChange: ReputationChange = {
      blockNumber: eventBlockNumber,
      change
    }
    const reputation = existing.reputation + change
    const changes =
      [...existing.changes, reputationChange]
        .filter(it => it.blockNumber > oldChangesExpirationBlock)
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
