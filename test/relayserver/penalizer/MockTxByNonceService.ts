import { Transaction } from 'ethereumjs-tx'

import { BlockExplorerInterface, TransactionData } from '../../../src/relayserver/penalizer/BlockExplorerInterface'
import ContractInteractor from '../../../src/common/ContractInteractor'
import { LoggerInterface } from '../../../src/common/LoggerInterface'
import { Address } from '../../../src/common/types/Aliases'
import { TransactionDataCache } from '../../../src/relayserver/penalizer/TransactionDataCache'
import * as ethUtils from 'ethereumjs-util'

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
      hash: '0x' + tx.hash(true).toString('hex'),
      nonce: ethUtils.bufferToInt(tx.nonce).toString(),
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
