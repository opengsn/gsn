import { PrefixedHexString } from 'ethereumjs-tx'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import web3Utils from 'web3-utils'

import { WrapperProviderBase } from './WrapperProviderBase'
import { SendCallback } from './SendCallback'
import { HttpProvider } from 'web3-core'

export class NetworkSimulatingProvider extends WrapperProviderBase {
  private isDelayTransactionsOn = false

  mempool = new Map<PrefixedHexString, JsonRpcPayload>()

  public constructor (provider: HttpProvider) {
    super(provider)
  }

  setDelayTransactions (delayTransactions: boolean): void {
    this.isDelayTransactionsOn = delayTransactions
  }

  calculateTxHash (payload: JsonRpcPayload): PrefixedHexString {
    const txHash = web3Utils.sha3(payload.params[0])
    if (txHash == null) {
      throw new Error('Failed to hash transaction')
    }
    return txHash
  }

  send (payload: JsonRpcPayload, callback: SendCallback): void {
    let resp: JsonRpcResponse | undefined
    switch (payload.method) {
      case 'eth_sendRawTransaction':
        if (this.isDelayTransactionsOn) {
          const txHash = this.calculateTxHash(payload)
          resp = {
            jsonrpc: '2.0',
            id: castId(payload.id),
            result: txHash
          }
          this.mempool.set(txHash, payload)
        }
        break
    }
    if (resp != null) {
      callback(null, resp)
    } else {
      this.provider.send(payload, callback)
    }
  }

  supportsSubscriptions (): boolean {
    return false
  }

  async mineTransaction (txHash: PrefixedHexString): Promise<any> {
    const txPayload: JsonRpcPayload | undefined = this.mempool.get(txHash)
    this.mempool.delete(txHash)
    return await new Promise((resolve, reject) => {
      if (txPayload == null) {
        throw new Error('Transaction is not in simulated mempool. It must be already mined')
      }
      this.provider.send(txPayload, function (error: (Error | null), result?: JsonRpcResponse) {
        if (error != null || result == null) {
          reject(error)
        } else {
          resolve(result)
        }
      })
    })
  }
}

function castId (id: string | number | undefined): number {
  if (typeof id === 'string') {
    return parseInt(id)
  } else if (typeof id === 'number') {
    return id
  } else {
    return 0
  }
}
