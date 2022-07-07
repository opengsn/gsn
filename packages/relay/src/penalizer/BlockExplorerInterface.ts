import { Address } from '@opengsn/common'

export interface BlockExplorerInterface {
  getTransactionByNonce: (account: Address, nonce: number) => Promise<TransactionData | undefined>
}

export interface TransactionData {
  blockNumber: string
  timeStamp: string
  hash: string
  nonce: string
  blockHash: string
  transactionIndex: string
  from: string
  to: string
  value: string
  gas: string
  gasPrice: string
  isError: string
  txreceipt_status: string
  input: string
  contractAddress: string
  cumulativeGasUsed: string
  gasUsed: string
  confirmations: string
}

export interface EtherscanResponse {
  status: string
  message?: string
  result?: TransactionData[]
}
