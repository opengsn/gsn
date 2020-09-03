import { Address } from '../../relayclient/types/Aliases'
// import { provider } from 'web3-core'
import { Transaction } from 'ethereumjs-tx'
import Web3 from 'web3'
import { toBN } from 'web3-utils'
import { bufferToHex, bufferToInt } from 'ethereumjs-util'
import { transactionToStoredTx, TxStoreManager } from '../TxStoreManager'
import ContractInteractor from '../../relayclient/ContractInteractor'

export interface TxByNonceService {
  getTransactionByNonce: (account: Address, nonce: number) => Promise<Transaction | undefined>
}

export class StupidTxByNonceService implements TxByNonceService {
  web3: Web3
  contractInteractor: ContractInteractor

  constructor (provider: provider, contractInteractor: ContractInteractor) {
    this.web3 = new Web3(provider)
    this.contractInteractor = contractInteractor
  }

  async getTransactionByNonce (account: Address, nonce: number): Promise<Transaction | undefined> {
    // todo
    const rpcTx = await web3.eth.getTransaction('')
    // @ts-ignore
    const tx = new Transaction({
      nonce: toBN(rpcTx.nonce),
      gasPrice: toBN(rpcTx.gasPrice),
      gasLimit: toBN(rpcTx.gas),
      to: rpcTx.to,
      value: toBN(rpcTx.value),
      data: rpcTx.input,
      // @ts-ignore
      v: rpcTx.v,
      // @ts-ignore
      r: rpcTx.r,
      // @ts-ignore
      s: rpcTx.s
    })

    return tx
  }
}

// Only for testing purposes
export class MockTxByNonceService implements TxByNonceService {
  web3: Web3
  // transactionsByNonces = new Map<{ account: Address, nonce: number }, Transaction>()
  txStoreManager: TxStoreManager
  contractInteractor: ContractInteractor

  constructor (provider: provider, contractInteractor: ContractInteractor) {
    this.web3 = new Web3(provider)
    this.txStoreManager = new TxStoreManager({ inMemory: true })
    this.contractInteractor = contractInteractor
  }

  async getTransactionByNonce (account: Address, nonce: number): Promise<Transaction | undefined> {
    const tx = await this.txStoreManager.getTxByNonce(account, nonce)
    // console.log('wtf is tx in getTransactionByNonce', new Transaction(tx, this.contractInteractor.getRawTxOptions()))
    return new Transaction(tx, this.contractInteractor.getRawTxOptions())
    // return this.transactionsByNonces.get({ account, nonce })
  }

  async setTransactionByNonce (tx: Transaction): Promise<void> {
    await this.txStoreManager.putTx(transactionToStoredTx(tx, bufferToHex(tx.getSenderAddress()), 1))
    // this.transactionsByNonces.set({ account: bufferToHex(tx.getSenderAddress()), nonce: bufferToInt(tx.nonce) }, tx)
  }
}
