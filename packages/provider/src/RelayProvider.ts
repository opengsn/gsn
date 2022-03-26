/* eslint-disable no-void */
// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import { HttpProvider } from 'web3-core'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString } from 'ethereumjs-util'
import { EventData } from 'web3-eth-contract'

import { gsnRuntimeVersion } from '@opengsn/common'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import relayHubAbi from '@opengsn/common/dist/interfaces/IRelayHub.json'

import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { AccountKeypair } from './AccountManager'
import { GsnEvent } from './GsnEvents'
import { _dumpRelayingResult, GSNUnresolvedConstructorInput, RelayClient, RelayingResult } from './RelayClient'
import { GSNConfig } from './GSNConfigurator'
import { Web3ProviderBaseInterface } from '@opengsn/common/dist/types/Aliases'
import { TransactionRejectedByPaymaster, TransactionRelayed } from '@opengsn/common/dist/types/GSNContractsDataTypes'

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

    if (typeof this.origProvider.sendAsync === 'function') {
      this.origProviderSend = this.origProvider.sendAsync.bind(this.origProvider)
    } else {
      this.origProviderSend = this.origProvider.send.bind(this.origProvider)
    }
    this._delegateEventsApi()
  }

  async init (): Promise<this> {
    await this.relayClient.init()
    this.config = this.relayClient.config
    this.logger = this.relayClient.logger
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
      if (payload.method === 'eth_accounts') {
        this._getAccounts(payload, callback)
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
   * The ID can be either a RelayRequestID which requires event-based lookup or Transaction Hash that goes through
   * @param payload
   * @param callback
   */
  async _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1
    const relayRequestID = payload.params[0] as string
    const submissionDetails = this.submittedRelayRequests.get(relayRequestID)
    if (submissionDetails == null) {
      this._ethGetTransactionReceiptWithTransactionHash(payload, callback)
      return
    }
    try {
      const result = await this._createTransactionReceiptForRelayRequestID(relayRequestID, submissionDetails)
      const rpcResponse = {
        id,
        result,
        jsonrpc: '2.0'
      }
      callback(null, rpcResponse)
    } catch (error) {
      callback(error, undefined)
    }
  }

  async _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    this.logger.info('calling sendAsync' + JSON.stringify(payload))
    let gsnTransactionDetails: GsnTransactionDetails
    try {
      gsnTransactionDetails = this._fixGasFees(payload.params[0])
    } catch (e) {
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

  async _onRelayTransactionFulfilled (relayingResult: RelayingResult, payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
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

  async _onRelayTransactionRejected (reason: any, callback: JsonRpcCallback): Promise<void> {
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
   * If the transaction is already mined, return a simulated successful transaction receipt
   * If the transaction is no longer valid, return a simulated reverted transaction receipt
   * If the transaction can still be mined, returns "null" like a regular RPC call would do
   */
  async _createTransactionReceiptForRelayRequestID (
    relayRequestID: string,
    submissionDetails: SubmittedRelayRequestInfo): Promise<TransactionReceipt | null> {
    const extraTopics = [undefined, undefined, [relayRequestID]]
    const events = await this.relayClient.dependencies.contractInteractor.getPastEventsForHub(
      extraTopics,
      { fromBlock: submissionDetails.submissionBlock },
      [TransactionRelayed, TransactionRejectedByPaymaster])
    if (events.length === 0) {
      if (parseInt(submissionDetails.validUntilTime) > Date.now()) {
        return null
      }
      return this._createTransactionRevertedReceipt()
    }

    const eventData = await this._pickSingleEvent(events, relayRequestID)
    const originalTransactionReceipt = await this.web3.eth.getTransactionReceipt(eventData.transactionHash)
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
    if (payload.params[0] === undefined) {
      return false
    }
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    return gsnTransactionDetails?.useGSN ?? true
  }

  _fixGasFees (_txDetails: any): GsnTransactionDetails {
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
    throw new Error('Relay Provider: must provide either gasPrice or (maxFeePerGas and maxPriorityFeePerGas)')
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

  addAccount (privateKey: PrefixedHexString): void {
    this.relayClient.addAccount(privateKey)
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
  async _pickSingleEvent (events: EventData[], relayRequestID: string): Promise<EventData> {
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
      status: false // failure
    }
  }
}
