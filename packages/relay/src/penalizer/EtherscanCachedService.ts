import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'

import { BlockExplorerInterface, EtherscanResponse, TransactionData } from './BlockExplorerInterface'
import { Address, isSameAddress, LoggerInterface } from '@opengsn/common'

import { TransactionDataCache } from './TransactionDataCache'

export class EtherscanCachedService implements BlockExplorerInterface {
  constructor (
    readonly url: string,
    readonly etherscanApiKey: string,
    readonly logger: LoggerInterface,
    readonly transactionDataCache: TransactionDataCache) {}

  async getTransactionByNonce (address: Address, nonce: number): Promise<TransactionData | undefined> {
    const { transaction, lastPageQueried } = await this.queryCachedTransactions(address, nonce)
    if (transaction != null) {
      return transaction
    }
    return await this.searchTransactionEtherscan(address, nonce, lastPageQueried)
  }

  async searchTransactionEtherscan (address: string, nonce: number, lastPageQueried: number): Promise<TransactionData | undefined> {
    const pageSize = 10
    let page = lastPageQueried + 1
    let response: AxiosResponse<EtherscanResponse>
    do {
      const params: AxiosRequestConfig = {
        params: {
          address,
          page,
          apikey: this.etherscanApiKey,
          offset: pageSize,
          action: 'txlist',
          module: 'account',
          sort: 'asc',
          startblock: 0,
          endblock: 99999999
        }
      }
      response = await axios.get(this.url, params)
      if (response.data.result == null || response.data.result.filter == null) {
        throw new Error(`Failed to query ${this.url}: returned ${response.data.status} ${response.data.message}`)
      } else if (response.data.status !== '0') {
        this.logger.warn(`Request to ${this.url} returned with ${response.data.status} ${response.data.message}`)
      }
      const outgoingTransactions = response.data.result.filter((it) => isSameAddress(it.from, address))
      await this.cacheResponse(outgoingTransactions, address, page)
      const transaction = outgoingTransactions.find((it) => parseInt(it.nonce) === nonce)
      if (transaction != null) {
        return transaction
      }
      page++
    } while (response.data.result.length >= pageSize)
    return undefined
  }

  async queryCachedTransactions (address: Address, nonce: number): Promise<{ transaction?: TransactionData, lastPageQueried: number }> {
    const transaction = await this.transactionDataCache.getTransactionByNonce(address, nonce)
    const lastPageQueried = await this.transactionDataCache.getLastPageQueried(address)
    return { transaction, lastPageQueried }
  }

  async cacheResponse (transactions: TransactionData[], sender: Address, page: number): Promise<void> {
    await this.transactionDataCache.putTransactions(transactions, sender, page)
  }
}
