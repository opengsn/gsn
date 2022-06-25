/* eslint-disable no-void */
// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import { HttpProvider } from 'web3-core'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString } from 'ethereumjs-util'
import { EventData } from 'web3-eth-contract'
import { TypedMessage } from 'eth-sig-util'

import {
  Address,
  GsnTransactionDetails,
  LoggerInterface,
  TransactionRejectedByPaymaster,
  TransactionRelayed,
  Web3ProviderBaseInterface,
  gsnRuntimeVersion,
  isSameAddress
} from '@opengsn/common'

import relayHubAbi from '@opengsn/common/dist/interfaces/IRelayHub.json'

import { AccountKeypair } from './AccountManager'
import { GsnEvent } from './GsnEvents'
import { _dumpRelayingResult, GSNUnresolvedConstructorInput, RelayClient, RelayingResult } from './RelayClient'
import { GSNConfig } from './GSNConfigurator'

abiDecoder.addABI(relayHubAbi)

export type JsonRpcCallback = (error: Error | null, result?: JsonRpcResponse) => void

interface ISendAsync {
  sendAsync?: any
}

/**
 * This data can later be used to optimize creation of Transaction Receipts
 */
interface SubmittedRelayRequestInfo {
  submissionBlock: number
  validUntilTime: string
}

const TX_FUTURE = 'tx-future'
const TX_NOTFOUND = 'tx-notfound'

const BLOCKS_FOR_LOOKUP = 5000

// TODO: stop faking the HttpProvider implementation -  it won't work for any other 'origProvider' type
export class RelayProvider implements HttpProvider, Web3ProviderBaseInterface {
  protected readonly origProvider: HttpProvider & ISendAsync
  private readonly origProviderSend: any
  protected readonly web3: Web3
  protected readonly submittedRelayRequests = new Map<string, SubmittedRelayRequestInfo>()
  protected config!: GSNConfig

  readonly relayClient: RelayClient
  logger!: LoggerInterface

  static newProvider (input: GSNUnresolvedConstructorInput): RelayProvider {
    return new RelayProvider(new RelayClient(input))
  }

  constructor (
    relayClient: RelayClient
  ) {
    if ((relayClient as any).send != null) {
      throw new Error('Using new RelayProvider() constructor directly is deprecated.\nPlease create provider using RelayProvider.newProvider({})')
    }
    this.relayClient = relayClient
    this.web3 = new Web3(relayClient.getUnderlyingProvider() as HttpProvider)
    // TODO: stop faking the HttpProvider implementation
    this.origProvider = this.relayClient.getUnderlyingProvider() as HttpProvider
    this.host = this.origProvider.host
    this.connected = this.origProvider.connected
    this.logger = this.relayClient.logger

    if (typeof this.origProvider.sendAsync === 'function') {
      this.origProviderSend = this.origProvider.sendAsync.bind(this.origProvider)
    } else {
      this.origProviderSend = this.origProvider.send.bind(this.origProvider)
    }
    this._delegateEventsApi()
  }

  sendId = 1000

  // async wrapper for calling origSend
  async origSend (method: string, params: any[]): Promise<any> {
    return await new Promise((resolve, reject) => {
      this.origProviderSend({
        id: this.sendId++,
        jsonrpc: '2.0',
        method,
        params
      }, (error: Error | null, result?: JsonRpcResponse) => {
        if (error != null) {
          reject(error)
        } else {
          resolve(result?.result)
        }
      })
    })
  }

  async init (): Promise<this> {
    await this.relayClient.init()
    this.config = this.relayClient.config
    this.logger.info(`Created new RelayProvider ver.${gsnRuntimeVersion}`)
    return this
  }

  registerEventListener (handler: (event: GsnEvent) => void): void {
    this.relayClient.registerEventListener(handler)
  }

  unregisterEventListener (handler: (event: GsnEvent) => void): void {
    this.relayClient.unregisterEventListener(handler)
  }

  _delegateEventsApi (): void {
    // If the subprovider is a ws or ipc provider, then register all its methods on this provider
    // and delegate calls to the subprovider. This allows subscriptions to work.
    ['on', 'removeListener', 'removeAllListeners', 'reset', 'disconnect', 'addDefaultEvents', 'once', 'reconnect'].forEach(func => {
      // @ts-ignore
      if (this.origProvider[func] !== undefined) {
        // @ts-ignore
        this[func] = this.origProvider[func].bind(this.origProvider)
      }
    })
  }

  send (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    if (this._useGSN(payload)) {
      if (payload.method === 'eth_sendTransaction') {
        // @ts-ignore
        if (payload.params[0].to === undefined) {
          callback(new Error('GSN cannot relay contract deployment transactions. Add {from: accountWithEther, useGSN: false}.'))
          return
        }
        void this._ethSendTransaction(payload, callback)
        return
      }
      if (payload.method === 'eth_getTransactionReceipt') {
        void this._ethGetTransactionReceipt(payload, callback)
        return
      }
      if (payload.method === 'eth_getTransactionByHash') {
        void this._ethGetTransactionByHash(payload, callback)
        return
      }
      if (payload.method === 'eth_accounts') {
        this._getAccounts(payload, callback)
        return
      }
      if (payload.method === 'eth_sign') {
        this._sign(payload, callback)
        return
      }
      if (payload.method === 'eth_signTransaction') {
        this._signTransaction(payload, callback)
        return
      }
      if (payload.method === 'eth_signTypedData') {
        this._signTypedData(payload, callback)
        return
      }
    }

    this.origProviderSend(payload, (error: Error | null, result?: JsonRpcResponse) => {
      callback(error, result)
    })
  }

  _ethGetTransactionReceiptWithTransactionHash (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
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

  /**
   * pack promise call as a jsonrpc callback
   * @param promise the promise request. return value is "result" for the callback
   * @param payload original payload. used to copy rpc param (jsonrpc, id)
   * @param callback callback to call result or error (for exception)
   */
  asCallback (promise: Promise<any>, payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    promise
      .then(result => {
        callback(null, {
          result,
          // @ts-ignore
          id: payload.id,
          jsonrpc: payload.jsonrpc
        })
      })
      .catch(error => {
        const err: any = {
          error,
          // @ts-ignore
          id: payload.id,
          jsonrpc: payload.jsonrpc
        }
        callback(err)
      })
  }

  async _getSubmissionDetailsForRelayRequestId (relayRequestID: PrefixedHexString): Promise<SubmittedRelayRequestInfo> {
    const submissionDetails = this.submittedRelayRequests.get(relayRequestID)
    if (submissionDetails != null) {
      return submissionDetails
    }
    const blockNumber = await this.web3.eth.getBlockNumber()
    const manyBlocksAgo = Math.max(1, blockNumber - BLOCKS_FOR_LOOKUP)
    this.logger.warn(`Looking up relayed transaction by its RelayRequestID(${relayRequestID}) from block ${manyBlocksAgo}`)
    return {
      submissionBlock: manyBlocksAgo,
      validUntilTime: Number.MAX_SAFE_INTEGER.toString()
    }
  }

  async _ethGetTransactionByHash (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    // @ts-ignore
    const relayRequestID = payload.params[0]
    const submissionDetails = await this._getSubmissionDetailsForRelayRequestId(relayRequestID)
    let txHash = await this._getTransactionIdFromRequestId(relayRequestID, submissionDetails)
    if (!txHash.startsWith('0x')) {
      txHash = relayRequestID
    }
    const tx = await this.origSend('eth_getTransactionByHash', [txHash])
    if (tx != null) {
      // must return exactly what was requested...
      tx.hash = relayRequestID
      tx.actualTransactionHash = tx.hash
    }
    this.asCallback(Promise.resolve(tx), payload, callback)
  }

  /**
   * The ID can be either a RelayRequestID which requires event-based lookup or Transaction Hash that goes through
   * @param payload
   * @param callback
   */
  async _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1
    const relayRequestID = payload.params?.[0] as string
    const hasPrefix = relayRequestID.includes('0x00000000')
    if (!hasPrefix) {
      this._ethGetTransactionReceiptWithTransactionHash(payload, callback)
      return
    }
    try {
      const result = await this._createTransactionReceiptForRelayRequestID(relayRequestID)
      const rpcResponse = {
        id,
        result,
        jsonrpc: '2.0'
      }
      callback(null, rpcResponse)
    } catch (error: any) {
      callback(error, undefined)
    }
  }

  async _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    this.logger.info('calling sendAsync' + JSON.stringify(payload))
    let gsnTransactionDetails: GsnTransactionDetails
    try {
      gsnTransactionDetails = await this._fixGasFees(payload.params?.[0])
    } catch (e: any) {
      this.logger.error(e)
      callback(e)
      return
    }
    try {
      const r = await this.relayClient.relayTransaction(gsnTransactionDetails)
      void this._onRelayTransactionFulfilled(r, payload, callback)
    } catch (reason) {
      void this._onRelayTransactionRejected(reason, callback)
    }
  }

  _onRelayTransactionFulfilled (relayingResult: RelayingResult, payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    if (relayingResult.relayRequestID != null) {
      const jsonRpcSendResult = this._convertRelayRequestIdToRpcSendResponse(relayingResult.relayRequestID, payload)
      this.cacheSubmittedTransactionDetails(relayingResult)
      callback(null, jsonRpcSendResult)
    } else {
      const message = `Failed to relay call. Results:\n${_dumpRelayingResult(relayingResult)}`
      this.logger.error(message)
      callback(new Error(message))
    }
  }

  _onRelayTransactionRejected (reason: any, callback: JsonRpcCallback): void {
    const reasonStr = reason instanceof Error ? reason.message : JSON.stringify(reason)
    const msg = `Rejected relayTransaction call with reason: ${reasonStr}`
    this.logger.info(msg)
    callback(new Error(msg))
  }

  _convertRelayRequestIdToRpcSendResponse (relayRequestID: PrefixedHexString, request: JsonRpcPayload): JsonRpcResponse {
    const id = (typeof request.id === 'string' ? parseInt(request.id) : request.id) ?? -1
    return {
      jsonrpc: '2.0',
      id,
      result: relayRequestID
    }
  }

  /**
   * convert relayRequestId (which is a "synthethic" transaction ID) into the actual transaction Id.
   * This is done by parsing RelayHub event, and can only be done after mining.
   * @param relayRequestID
   * @param submissionDetails
   * @return transactionId or marker:
   * If the transaction is already mined, return a real transactionId
   * If the transaction is no longer valid, return TX_NOTFOUND
   * If the transaction can still be mined, returns TX_FUTURE
   */
  async _getTransactionIdFromRequestId (
    relayRequestID: string,
    submissionDetails: SubmittedRelayRequestInfo
  ): Promise<string> {
    const extraTopics = [undefined, undefined, [relayRequestID]]
    const events = await this.relayClient.dependencies.contractInteractor.getPastEventsForHub(
      extraTopics,
      { fromBlock: submissionDetails.submissionBlock },
      [TransactionRelayed, TransactionRejectedByPaymaster])
    if (events.length === 0) {
      if (parseInt(submissionDetails.validUntilTime) > Date.now()) {
        return TX_FUTURE
      }
      return TX_NOTFOUND
    }
    return this._pickSingleEvent(events, relayRequestID).transactionHash
  }

  /**
   * If the transaction is already mined, return a simulated successful transaction receipt
   * If the transaction is no longer valid, return a simulated reverted transaction receipt
   * If the transaction can still be mined, returns "null" like a regular RPC call would do
   */
  async _createTransactionReceiptForRelayRequestID (
    relayRequestID: string): Promise<TransactionReceipt | null> {
    const submissionDetails = await this._getSubmissionDetailsForRelayRequestId(relayRequestID)
    const transactionHash = await this._getTransactionIdFromRequestId(relayRequestID, submissionDetails)
    if (transactionHash === TX_FUTURE) {
      return null
    }
    if (transactionHash === TX_NOTFOUND) {
      return this._createTransactionRevertedReceipt()
    }
    const originalTransactionReceipt = await this.web3.eth.getTransactionReceipt(transactionHash)
    return this._getTranslatedGsnResponseResult(originalTransactionReceipt, relayRequestID)
  }

  _getTranslatedGsnResponseResult (respResult: TransactionReceipt, relayRequestID?: string): TransactionReceipt {
    const fixedTransactionReceipt = Object.assign({}, respResult)
    // adding non declared field to receipt object - can be used in tests
    // @ts-ignore
    fixedTransactionReceipt.actualTransactionHash = fixedTransactionReceipt.transactionHash
    fixedTransactionReceipt.transactionHash = relayRequestID ?? fixedTransactionReceipt.transactionHash

    // older Web3.js versions require 'status' to be an integer. Will be set to '0' if needed later in this method.
    // @ts-ignore
    fixedTransactionReceipt.status = '1'
    if (respResult.logs.length === 0) {
      return fixedTransactionReceipt
    }
    const logs = abiDecoder.decodeLogs(respResult.logs)
    const paymasterRejectedEvents = logs.find((e: any) => e != null && e.name === 'TransactionRejectedByPaymaster')

    if (paymasterRejectedEvents !== null && paymasterRejectedEvents !== undefined) {
      const paymasterRejectionReason: { value: string } = paymasterRejectedEvents.events.find((e: any) => e.name === 'reason')
      if (paymasterRejectionReason !== undefined) {
        this.logger.info(`Paymaster rejected on-chain: ${paymasterRejectionReason.value}. changing status to zero`)
        // @ts-ignore
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
          // @ts-ignore
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
    if (payload.params?.[0] === undefined) {
      return false
    }
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    return gsnTransactionDetails?.useGSN ?? true
  }

  async _fixGasFees (_txDetails: any): Promise<GsnTransactionDetails> {
    const txDetails = { ..._txDetails }
    if (txDetails.maxFeePerGas != null && txDetails.maxPriorityFeePerGas != null) {
      delete txDetails.gasPrice
      return txDetails
    }
    if (txDetails.gasPrice != null && txDetails.maxFeePerGas == null && txDetails.maxPriorityFeePerGas == null) {
      txDetails.maxFeePerGas = txDetails.gasPrice
      txDetails.maxPriorityFeePerGas = txDetails.gasPrice
      delete txDetails.gasPrice
      return txDetails
    }
    if (txDetails.gasPrice == null && txDetails.maxFeePerGas == null && txDetails.maxPriorityFeePerGas == null) {
      const gasFees = await this.calculateGasFees()
      txDetails.maxPriorityFeePerGas = gasFees.maxPriorityFeePerGas
      txDetails.maxFeePerGas = gasFees.maxFeePerGas
      return txDetails
    }
    throw new Error('Relay Provider: cannot provide only one of maxFeePerGas and maxPriorityFeePerGas')
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
    return this.relayClient.newAccount()
  }

  async calculateGasFees (): Promise<{ maxFeePerGas: PrefixedHexString, maxPriorityFeePerGas: PrefixedHexString }> {
    return await this.relayClient.calculateGasFees()
  }

  addAccount (privateKey: PrefixedHexString): AccountKeypair {
    return this.relayClient.addAccount(privateKey)
  }

  isEphemeralAccount (account: Address): boolean {
    const ephemeralAccounts = this.relayClient.dependencies.accountManager.getAccounts()
    return ephemeralAccounts.find(it => isSameAddress(account, it)) != null
  }

  _sign (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1
    const from = payload.params?.[0]
    if (from != null && this.isEphemeralAccount(from)) {
      const result = this.relayClient.dependencies.accountManager.signMessage(payload.params?.[1], from)
      const rpcResponse = {
        id,
        result,
        jsonrpc: '2.0'
      }
      callback(null, rpcResponse)
      return
    }
    this.origProviderSend(payload, callback)
  }

  _signTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1
    const transactionConfig: TransactionConfig = payload.params?.[0]
    const from = transactionConfig?.from as string
    if (from != null && this.isEphemeralAccount(from)) {
      const result = this.relayClient.dependencies.accountManager.signTransaction(transactionConfig, from)
      const rpcResponse = {
        id,
        result,
        jsonrpc: '2.0'
      }
      callback(null, rpcResponse)
      return
    }
    this.origProviderSend(payload, callback)
  }

  _signTypedData (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1
    const from = payload.params?.[0]
    if (from != null && this.isEphemeralAccount(from)) {
      const typedData: TypedMessage<any> = payload.params?.[1]
      const result = this.relayClient.dependencies.accountManager.signTypedData(typedData, from)
      const rpcResponse = {
        id,
        result,
        jsonrpc: '2.0'
      }
      callback(null, rpcResponse)
      return
    }
    this.origProviderSend(payload, callback)
  }

  _getAccounts (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    this.origProviderSend(payload, (error: Error | null, rpcResponse?: JsonRpcResponse): void => {
      if (rpcResponse != null && Array.isArray(rpcResponse.result)) {
        const ephemeralAccounts = this.relayClient.dependencies.accountManager.getAccounts()
        rpcResponse.result = rpcResponse.result.concat(ephemeralAccounts)
      }
      callback(error, rpcResponse)
    })
  }

  /**
   * In an edge case many events with the same ID may be mined.
   * If there is a successful {@link TransactionRelayed} event, it will be returned.
   * If all events are {@link TransactionRejectedByPaymaster}, return the last one.
   * If there is more than one successful {@link TransactionRelayed} throws as this is impossible for current Forwarder
   */
  _pickSingleEvent (events: EventData[], relayRequestID: string): EventData {
    const successes = events.filter(it => it.event === TransactionRelayed)
    if (successes.length === 0) {
      const sorted = events.sort((a: EventData, b: EventData) => b.blockNumber - a.blockNumber)
      return sorted[0]
    } else if (successes.length === 1) {
      return successes[0]
    } else {
      throw new Error(`Multiple TransactionRelayed events with the same ${relayRequestID} found!`)
    }
  }

  cacheSubmittedTransactionDetails (
    relayingResult: RelayingResult
    // relayRequestID: string,
    // submissionBlock: number,
    // validUntil: string
  ): void {
    if (relayingResult.relayRequestID == null ||
      relayingResult.submissionBlock == null ||
      relayingResult.validUntilTime == null) {
      throw new Error('Missing info in RelayingResult - internal GSN error, should not happen')
    }
    this.submittedRelayRequests.set(relayingResult.relayRequestID, {
      validUntilTime: relayingResult.validUntilTime,
      submissionBlock: relayingResult.submissionBlock
    })
  }

  _createTransactionRevertedReceipt (): TransactionReceipt {
    return {
      to: '',
      from: '',
      contractAddress: '',
      logsBloom: '',
      blockHash: '',
      transactionHash: '',
      transactionIndex: 0,
      gasUsed: 0,
      logs: [],
      blockNumber: 0,
      cumulativeGasUsed: 0,
      effectiveGasPrice: 0,
      status: false // failure
    }
  }
}
