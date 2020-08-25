import { Address } from '../../relayclient/types/Aliases'
import { provider, Transaction } from 'web3-core'
import Web3 from 'web3'

export class TxByNonceService {
  web3: Web3

  constructor (provider: provider) {
    this.web3 = new Web3(provider)
  }

  async getTransactionByNonce (account: Address, nonce: number): Promise<Transaction> {
    // todo
    return await web3.eth.getTransaction('')
  }
}