import { PrefixedHexString } from 'ethereumjs-util'
import { JsonRpcProvider } from '@ethersproject/providers'
import { utils } from 'ethers'

import { WrapperProviderBase } from './WrapperProviderBase'

interface DelayedSend {
  method: string
  params: any
}

export class NetworkSimulatingProvider extends WrapperProviderBase {
  private isDelayTransactionsOn = false

  mempool = new Map<PrefixedHexString, DelayedSend>()

  public constructor (provider: JsonRpcProvider) {
    super(provider)
  }

  setDelayTransactions (delayTransactions: boolean): void {
    this.isDelayTransactionsOn = delayTransactions
  }

  calculateTxHash (params?: any[]): PrefixedHexString {
    const txHash = utils.keccak256(params?.[0])
    if (txHash == null) {
      throw new Error('Failed to hash transaction')
    }
    return txHash
  }

  async send (method: string, params: any[]): Promise<any> {
    let txHash
    switch (method) {
      case 'eth_sendRawTransaction':
        if (this.isDelayTransactionsOn) {
          txHash = this.calculateTxHash(params)
          this.mempool.set(txHash, { method, params })
        }
        break
    }
    if (txHash != null) {
      return txHash
    } else {
      return await this.provider.send(method, params)
    }
  }

  supportsSubscriptions (): boolean {
    return false
  }

  async mineTransaction (txHash: PrefixedHexString): Promise<any> {
    const txPayload: DelayedSend | undefined = this.mempool.get(txHash)
    this.mempool.delete(txHash)
    if (txPayload == null) {
      throw new Error(`Transaction ${txHash} is not in simulated mempool. It must be already mined`)
    }
    return await this.provider.send(txPayload.method, txPayload.params)
  }
}
