// @ts-ignore
import abiDecoder from 'abi-decoder'
import { HttpProvider } from 'web3-core'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'

import { LoggerInterface } from '../common/LoggerInterface'
import relayHubAbi from '../common/interfaces/IRelayHub.json'

import GsnTransactionDetails from './types/GsnTransactionDetails'
import { AccountKeypair } from './AccountManager'
import { GsnEvent } from './GsnEvents'
import { _dumpRelayingResult, RelayClient } from './RelayClient'
import { configureGSN, GSNConfig, GSNDependencies } from './GSNConfigurator'

abiDecoder.addABI(relayHubAbi)

export interface BaseTransactionReceipt {
  logs: any[]
  status: string | boolean
}

export type JsonRpcCallback = (error: Error | null, result?: JsonRpcResponse) => void

interface ISendAsync {
  sendAsync?: any
}

export class RelayProvider implements HttpProvider {
  protected readonly origProvider: HttpProvider & ISendAsync
  private readonly origProviderSend: any
  protected readonly config: GSNConfig

  readonly relayClient: RelayClient
  readonly logger: LoggerInterface

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
    if (typeof this.origProvider.sendAsync === 'function') {
      this.origProviderSend = this.origProvider.sendAsync.bind(this.origProvider)
    } else {
      this.origProviderSend = this.origProvider.send.bind(this.origProvider)
    }
    this.relayClient = relayClient ?? new RelayClient(origProvider, gsnConfig, overrideDependencies)
    this.logger = this.relayClient.logger
    this._delegateEventsApi(origProvider)
  }

  async init (): Promise<this> {
    await this.relayClient.init()
    return this
  }

  registerEventListener (handler: (event: GsnEvent) => void): void {
    this.relayClient.registerEventListener(handler)
  }

  unregisterEventListener (handler: (event: GsnEvent) => void): void {
    this.relayClient.unregisterEventListener(handler)
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
        if (payload.params[0].to === undefined) {
          throw new Error('GSN cannot relay contract deployment transactions. Add {from: accountWithEther, useGSN: false}.')
        }
        this._ethSendTransaction(payload, callback)
        return
      }
      if (payload.method === 'eth_getTransactionReceipt') {
        this._ethGetTransactionReceipt(payload, callback)
        return
      }
      if (payload.method === 'eth_accounts') {
        this._getAccounts(payload, callback)
      }
    }

    this.origProviderSend(payload, (error: Error | null, result?: JsonRpcResponse) => {
      callback(error, result)
    })
  }

  _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    this.logger.info('calling sendAsync' + JSON.stringify(payload))
    this.origProviderSend(payload, (error: Error | null, rpcResponse?: JsonRpcResponse): void => {
      // Sometimes, ganache seems to return 'false' for 'no error' (breaking TypeScript declarations)
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (error) {
        callback(error, rpcResponse)
        return
      }
      if (rpcResponse == null || rpcResponse.result == null) {
        callback(error, rpcResponse)
        return
      }
      rpcResponse.result = this._getTranslatedGsnResponseResult(rpcResponse.result)
      callback(error, rpcResponse)
    })
  }

  _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    this.logger.info('calling sendAsync' + JSON.stringify(payload))
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    this.relayClient.relayTransaction(gsnTransactionDetails)
      .then((relayingResult) => {
        if (relayingResult.transaction != null) {
          const jsonRpcSendResult = this._convertTransactionToRpcSendResponse(relayingResult.transaction, payload)
          callback(null, jsonRpcSendResult)
        } else {
          const message = `Failed to relay call. Results:\n${_dumpRelayingResult(relayingResult)}`
          this.logger.error(message)
          callback(new Error(message))
        }
      }, (reason: any) => {
        const reasonStr = reason instanceof Error ? reason.message : JSON.stringify(reason)
        const msg = `Rejected relayTransaction call with reason: ${reasonStr}`
        this.logger.info(msg)
        callback(new Error(msg))
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
    const paymasterRejectedEvents = logs.find((e: any) => e != null && e.name === 'TransactionRejectedByPaymaster')

    if (paymasterRejectedEvents !== null && paymasterRejectedEvents !== undefined) {
      const paymasterRejectionReason: { value: string } = paymasterRejectedEvents.events.find((e: any) => e.name === 'reason')
      if (paymasterRejectionReason !== undefined) {
        this.logger.info(`Paymaster rejected on-chain: ${paymasterRejectionReason.value}. changing status to zero`)
        fixedTransactionReceipt.status = '0'
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
          this.logger.info(`reverted relayed transaction, status code ${status}. changing status to zero`)
          fixedTransactionReceipt.status = '0'
        }
      }
    }
    return fixedTransactionReceipt
  }

  _useGSN (payload: JsonRpcPayload): boolean {
    if (payload.method === 'eth_accounts') {
      return true
    }
    if (payload.params[0] === undefined) {
      return false
    }
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    return gsnTransactionDetails?.useGSN ?? true
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

  addAccount (privateKey: PrefixedHexString): void {
    this.relayClient.accountManager.addAccount(privateKey)
  }

  _getAccounts (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    this.origProviderSend(payload, (error: Error | null, rpcResponse?: JsonRpcResponse): void => {
      if (rpcResponse != null && Array.isArray(rpcResponse.result)) {
        const ephemeralAccounts = this.relayClient.accountManager.getAccounts()
        rpcResponse.result = rpcResponse.result.concat(ephemeralAccounts)
      }
      callback(error, rpcResponse)
    })
  }
}
