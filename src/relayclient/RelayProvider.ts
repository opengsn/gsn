import Web3 from 'web3'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import RelayClient, { RelayingResult } from './RelayClient'
import { provider } from 'web3-core'
import relayHubAbi from '../common/interfaces/IRelayHub'
// @ts-ignore
import abiDecoder from 'abi-decoder'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { GSNConfig, RelayProviderConfig } from './GSNConfigurator'

abiDecoder.addABI(relayHubAbi)

export interface BaseTransactionReceipt {
  logs: any[]
  status: number
}

export default class RelayProvider {
  private readonly origProvider: provider
  private readonly origProviderSend: any
  private readonly relayClient: RelayClient
  private readonly config: RelayProviderConfig

  /**
   * create a proxy provider, to relay transaction
   * @param web3
   * @param origProvider - the underlying web3 provider
   * @param gsnConfig
   */
  constructor (web3: Web3, origProvider: provider | RelayProvider, gsnConfig: GSNConfig) {
    if (origProvider instanceof RelayProvider ||
      origProvider == null ||
      typeof origProvider === 'string') {
      throw new Error('Missing underlying provider')
    }
    this.origProvider = origProvider
    this.config = gsnConfig.relayProviderConfig
    this.origProviderSend = this.origProvider.send.bind(this.origProvider)
    this.relayClient = RelayClient.new(web3, gsnConfig)
  }

  send (payload: JsonRpcPayload, callback: any): void {
    if (this._useGSN(payload)) {
      if (payload.method === 'eth_sendTransaction') {
        this._ethSendTransaction(payload, callback)
        return
      }
      if (payload.method === 'eth_getTransactionReceipt') {
        this._ethGetTransactionReceipt(payload, callback)
        return
      }
    }

    this.origProviderSend(payload, (error: Error | null, result?: JsonRpcResponse) => {
      callback(error, result)
    })
  }

  _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: any): void {
    if (this.config.verbose) {
      console.log('calling sendAsync' + JSON.stringify(payload))
    }
    this.origProviderSend(payload, (error: Error | null, rpcResponse?: JsonRpcResponse): void => {
      if (error != null) {
        callback(error)
        return
      }
      if (rpcResponse == null || rpcResponse.result == null) {
        throw new Error('Empty JsonRpcResponse with no error message')
      }
      rpcResponse.result = this._getTranslatedGsnResponseResult(rpcResponse.result)
      callback(null, rpcResponse)
    })
  }

  _ethSendTransaction (payload: JsonRpcPayload, callback: any): void {
    if (this.config.verbose) {
      console.log('calling sendAsync' + JSON.stringify(payload))
    }
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    this.relayClient.relayTransaction(gsnTransactionDetails)
      .then((relayingResult) => {
        if (relayingResult.transaction != null) {
          const txHash: string = relayingResult.transaction.hash(true).toString('hex')
          const hash = `0x${txHash}`
          const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1
          callback(null, {
            jsonrpc: '2.0',
            id,
            result: hash
          })
        } else {
          console.log(`Failed to relay call. Results:\n${this._dumpRelayingResult(relayingResult)}`)
        }
      }, (reason: any) => {
        const reasonStr = reason instanceof Error ? reason.toString() : JSON.stringify(reason)
        throw new Error(`Rejected runRelay call - should not happen. Reason: ${reasonStr}`)
      })
  }

  _getTranslatedGsnResponseResult (respResult: BaseTransactionReceipt): BaseTransactionReceipt {
    const fixedTransactionReceipt = Object.assign({}, respResult)
    if (respResult.logs.length === 0) {
      return fixedTransactionReceipt
    }
    const logs = abiDecoder.decodeLogs(respResult.logs)
    const canRelayFailed = logs.find((e: any) => e != null && e.name === 'CanRelayFailed')

    if (canRelayFailed !== null && canRelayFailed !== undefined) {
      const canRelayFailedReason: { value: string } = canRelayFailed.events.find((e: any) => e.name === 'reason')
      if (canRelayFailedReason !== undefined) {
        console.log(`canRelay failed: ${canRelayFailedReason.value}. changing status to zero`)
        fixedTransactionReceipt.status = 0
      }
      return fixedTransactionReceipt
    }

    const transactionRelayed = logs.find((e: any) => e != null && e.name === 'TransactionRelayed')
    if (transactionRelayed != null) {
      const transactionRelayedStatus = transactionRelayed.events.find((e: any) => e.name === 'status')
      if (transactionRelayedStatus !== undefined) {
        const status: string = transactionRelayedStatus.value.toString()
        // 0 signifies success
        if (status !== '0') {
          console.log(`reverted relayed transaction, status code ${status}. changing status to zero`)
          fixedTransactionReceipt.status = 0
        }
      }
    }
    return fixedTransactionReceipt
  }

  _useGSN (payload: JsonRpcPayload): boolean {
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    return gsnTransactionDetails.useGSN ?? true
  }

  private _dumpRelayingResult (relayingResult: RelayingResult): string {
    let str = 'Ping errors:\n'
    Array.from(relayingResult.pingErrors.keys()).forEach(e => {
      const error = relayingResult.pingErrors.get(e)?.toString() ?? ''
      str += `${e}: ${error}\n`
    })
    str += '\nRelaying errors:\n'
    Array.from(relayingResult.relayingErrors.keys()).forEach(e => {
      const error = relayingResult.relayingErrors.get(e)?.toString() ?? ''
      str += `${e}: ${error}`
    })
    return str
  }
}
