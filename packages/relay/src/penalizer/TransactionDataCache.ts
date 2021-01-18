import AsyncNedb from 'nedb-async'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { TransactionData } from './BlockExplorerInterface'

export const TX_STORE_FILENAME = 'penalizetxcache.db'
export const TX_PAGES_FILENAME = 'penalizetxpages.db'

export interface PagesQueried {
  sender: Address
  page: number
}

export class TransactionDataCache {
  private readonly txstore: AsyncNedb<TransactionData>
  private readonly pagesStore: AsyncNedb<PagesQueried>
  private readonly logger: LoggerInterface

  constructor (logger: LoggerInterface, workdir: string) {
    const filename = `${workdir}/${TX_STORE_FILENAME}`
    this.logger = logger
    this.txstore = new AsyncNedb({
      filename,
      autoload: true,
      timestampData: true
    })
    this.pagesStore = new AsyncNedb({
      filename: `${workdir}/${TX_PAGES_FILENAME}`,
      autoload: true,
      timestampData: true
    })
    this.txstore.ensureIndex({ fieldName: 'hash', unique: true })
    this.pagesStore.ensureIndex({ fieldName: 'sender', unique: true })
    this.logger.info(`Penalizer cache database location: ${filename}`)
  }

  async putTransactions (transactions: TransactionData[], sender: Address, page: number): Promise<void> {
    const existing = await this.pagesStore.asyncFindOne({ sender })
    if (existing == null) {
      await this.pagesStore.asyncInsert({ sender, page })
    } else if (existing.page >= page) {
      throw new Error(`Trying to cache page ${page} when already have ${existing.page} pages for sender ${sender}`)
    }
    for (const transaction of transactions) {
      transaction.from = transaction.from.toLowerCase()
      await this.txstore.asyncInsert(transaction)
    }
  }

  async getLastPageQueried (sender: Address): Promise<number> {
    const lastPageQueried = await this.pagesStore.asyncFindOne({ sender: sender.toLowerCase() })
    if (lastPageQueried == null) {
      return 0
    }
    return lastPageQueried.page
  }

  async getTransactionByNonce (address: Address, nonce: number): Promise<TransactionData> {
    return await this.txstore.asyncFindOne({
      from: address.toLowerCase(),
      nonce: nonce.toString()
    })
  }

  async clearAll (): Promise<void> {
    await this.txstore.asyncRemove({}, { multi: true })
    await this.pagesStore.asyncRemove({}, { multi: true })
  }
}
