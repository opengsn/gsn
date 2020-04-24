// @ts-ignore
import abiDecoder from 'abi-decoder'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { HttpProvider } from 'web3-core'

import relayHubAbi from '../common/interfaces/IRelayHub'
import RelayClient, { RelayingResult } from './RelayClient'
import GsnTransactionDetails from './types/GsnTransactionDetails'
import { configureGSN, GSNConfig, GSNDependencies } from './GSNConfigurator'
import { Transaction } from 'ethereumjs-tx'
import { AccountKeypair } from './AccountManager'

abiDecoder.addABI(relayHubAbi)

export interface BaseTransactionReceipt {
  logs: any[]
  status: boolean
}

export type JsonRpcCallback = (error: Error | null, result?: JsonRpcResponse) => void

export class RelayProvider implements HttpProvider {
  private readonly origProvider: HttpProvider
  private readonly origProviderSend: any
  private readonly relayClient: RelayClient
  private readonly config: GSNConfig

  /**
   * create a proxy provider, to relay transaction
   * @param overrideDependencies
   * @param relayClient
   * @param origProvider - the underlying web3 provider
   * @param gsnConfig
   */
  constructor (origProvider: HttpProvider, gsnConfig: Partial<GSNConfig>, overrideDependencies?: Partial<GSNDependencies>, relayClient?: RelayClient) {
    const config = configureGSN(gsnConfig)
    this.host = origProvider.host
    this.connected = origProvider.connected

    this.origProvider = origProvider
    this.config = config
    this.origProviderSend = this.origProvider.send.bind(this.origProvider)
    this.relayClient = relayClient ?? new RelayClient(origProvider, gsnConfig, overrideDependencies)

    this._delegateEventsApi(origProvider)
  }

  _delegateEventsApi (origProvider: HttpProvider): void {
    // If the subprovider is a ws or ipc provider, then register all its methods on this provider
    // and delegate calls to the subprovider. This allows subscriptions to work.
    ['on', 'removeListener', 'removeAllListeners', 'reset', 'disconnect', 'addDefaultEvents', 'once', 'reconnect'].forEach(func => {
      // @ts-ignore
      if (origProvider[func] !== undefined) {
        // @ts-ignore
        this[func] = origProvider[func].bind(origProvider)
      }
    })
  }

  send (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
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

  _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
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

  _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    if (this.config.verbose) {
      console.log('calling sendAsync' + JSON.stringify(payload))
    }
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    this.relayClient.relayTransaction(gsnTransactionDetails)
      .then((relayingResult) => {
        if (relayingResult.transaction != null) {
          const jsonRpcSendResult = this._convertTransactionToRpcSendResponse(relayingResult.transaction, payload)
          callback(null, jsonRpcSendResult)
        } else {
          const message = `Failed to relay call. Results:\n${this._dumpRelayingResult(relayingResult)}`
          if (this.config.verbose) {
            console.error(message)
          }
          callback(new Error(message))
        }
      }, (reason: any) => {
        const reasonStr = reason instanceof Error ? reason.toString() : JSON.stringify(reason)
        callback(new Error(`Rejected relayTransaction call - should not happen. Reason: ${reasonStr}`))
      })
  }

  _convertTransactionToRpcSendResponse (transaction: Transaction, request: JsonRpcPayload): JsonRpcResponse {
    const txHash: string = transaction.hash(true).toString('hex')
    const hash = `0x${txHash}`
    const id = (typeof request.id === 'string' ? parseInt(request.id) : request.id) ?? -1
    return {
      jsonrpc: '2.0',
      id,
      result: hash
    }
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
        if (this.config.verbose) {
          console.log(`canRelay failed: ${canRelayFailedReason.value}. changing status to zero`)
        }
        fixedTransactionReceipt.status = false
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
          if (this.config.verbose) {
            console.log(`reverted relayed transaction, status code ${status}. changing status to zero`)
          }
          fixedTransactionReceipt.status = false
        }
      }
    }
    return fixedTransactionReceipt
  }

  _useGSN (payload: JsonRpcPayload): boolean {
    if (payload.params[0] === undefined) {
      return false
    }
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    const ret = gsnTransactionDetails?.useGSN ?? true
    return ret
  }

  private _dumpRelayingResult (relayingResult: RelayingResult): string {
    let str = `Ping errors (${relayingResult.pingErrors.size}):`
    Array.from(relayingResult.pingErrors.keys()).forEach(e => {
      const error = relayingResult.pingErrors.get(e)?.toString() ?? ''
      str += `\n${e} => ${error}\n`
    })
    str += `Relaying errors (${relayingResult.relayingErrors.size}):\n`
    Array.from(relayingResult.relayingErrors.keys()).forEach(e => {
      const error = relayingResult.relayingErrors.get(e)?.toString() ?? ''
      str += `${e} => ${error}`
    })
    return str
  }

  /* wrapping HttpProvider interface */

  host: string
  connected: boolean

  supportsSubscriptions (): boolean {
    return this.origProvider.supportsSubscriptions()
  }

  disconnect (): boolean {
    return this.origProvider.disconnect()
  }

  newAccount (): AccountKeypair {
    return this.relayClient.accountManager.newAccount()
  }

  addAccount (keypair: AccountKeypair): void {
    this.relayClient.accountManager.addAccount(keypair)
  }
}
