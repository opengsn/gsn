import { Address } from '../../relayclient/types/Aliases'
// import { provider } from 'web3-core'
import { Transaction } from 'ethereumjs-tx'
import Web3 from 'web3'
import { toBN } from 'web3-utils'
import { bufferToHex, bufferToInt } from 'ethereumjs-util'

export interface TxByNonceService {
  getTransactionByNonce: (account: Address, nonce: number) => Promise<Transaction | undefined>
}

export class StupidTxByNonceService implements TxByNonceService {
  web3: Web3

  constructor (provider: provider) {
    this.web3 = new Web3(provider)
  }

  async getTransactionByNonce (account: Address, nonce: number): Promise<Transaction| undefined> {
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
export class mockTxByNonceService implements TxByNonceService {
  web3: Web3
  transactionsByNonces = new Map<{ account: Address, nonce: number }, Transaction>()

  constructor (provider: provider) {
    this.web3 = new Web3(provider)
  }

  async getTransactionByNonce (account: Address, nonce: number): Promise<Transaction | undefined> {
    return this.transactionsByNonces.get({ account, nonce })
  }

  setTransactionByNonce (tx: Transaction): void {
    this.transactionsByNonces.set({ account: bufferToHex(tx.getSenderAddress()), nonce: bufferToInt(tx.nonce) }, tx)
  }
}
