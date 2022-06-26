import { Transaction } from '@ethereumjs/tx'

import { BlockExplorerInterface, TransactionData } from '@opengsn/relay/dist/penalizer/BlockExplorerInterface'
import { ContractInteractor, LoggerInterface, Address } from '@opengsn/common'

import { TransactionDataCache } from '@opengsn/relay/dist/penalizer/TransactionDataCache'

export class MockTxByNonceService implements BlockExplorerInterface {
  transactionDataCache: TransactionDataCache
  contractInteractor: ContractInteractor

  constructor (contractInteractor: ContractInteractor, logger: LoggerInterface) {
    this.transactionDataCache = new TransactionDataCache(logger, '/tmp/test')
    this.contractInteractor = contractInteractor
  }

  async getTransactionByNonce (account: Address, nonce: number): Promise<TransactionData | undefined> {
    return await this.transactionDataCache.getTransactionByNonce(account, nonce)
  }

  async setTransactionByNonce (tx: Transaction, from: Address): Promise<void> {
    const txData: TransactionData = {
      from,
      hash: '0x' + tx.hash().toString('hex'),
      nonce: tx.nonce.toString(),
      to: '',
      gas: '',
      gasPrice: '',
      value: '',
      blockNumber: '',
      timeStamp: '',
      blockHash: '',
      transactionIndex: '',
      isError: '',
      txreceipt_status: '',
      input: '',
      contractAddress: '',
      cumulativeGasUsed: '',
      gasUsed: '',
      confirmations: ''
    }
    await this.transactionDataCache.putTransactions([txData], txData.from, 0)
  }
}
