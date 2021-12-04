// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import { EventData } from 'web3-eth-contract'
import { HttpProvider } from 'web3-core'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString } from 'ethereumjs-util'

import {
  TransactionRejectedByPaymaster,
  TransactionRelayed
} from '@opengsn/common/dist/types/GSNContractsDataTypes'

import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'

import { BaseTransactionReceipt, JsonRpcCallback, RelayProvider } from '../RelayProvider'
import {
  _dumpRelayingResult,
  GSNUnresolvedConstructorInput,
  RelayClient,
  RelayingResult,
  SubmittedRelayRequestInfo
} from '../RelayClient'
import { GSNBatchingContractsDeployment, removeHexPrefix } from '@opengsn/common'
import { BatchRelayClient } from './BatchRelayClient'
import { CacheDecoderInteractor } from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { ExternalBLSKeypairType, InternalBLSKeypairType } from '@opengsn/common/dist/bls/BLSTypedDataSigner'

export class BatchRelayProvider extends RelayProvider {
  web3: Web3

  static newBatchingProvider (
    input: GSNUnresolvedConstructorInput,
    batchingContractsDeployment: GSNBatchingContractsDeployment,
    cacheDecoderInteractor: CacheDecoderInteractor
  ): BatchRelayProvider {
    return new BatchRelayProvider(new BatchRelayClient(input, batchingContractsDeployment, cacheDecoderInteractor))
  }

  constructor (relayClient: RelayClient) {
    super(relayClient)
    this.web3 = new Web3(relayClient.getUnderlyingProvider() as HttpProvider)
    abiDecoder.addABI(RelayHubABI)
  }

  async newBLSKeypair (): Promise<InternalBLSKeypairType> {
    return await this.relayClient.dependencies.accountManager.newBLSKeypair()
  }

  setBLSKeypair (keypair: ExternalBLSKeypairType): void {
    return this.relayClient.dependencies.accountManager.setBLSKeypair(keypair)
  }

  async _onRelayTransactionFulfilled (relayingResult: RelayingResult, payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    if (relayingResult.relayRequestID != null) {
      const jsonRpcSendResult = this._convertRelayRequestIdToRpcSendResponse(relayingResult.relayRequestID, payload)
      callback(null, jsonRpcSendResult)
    } else {
      const message = `Failed to relay call. Results:\n${_dumpRelayingResult(relayingResult)}`
      this.logger.error(message)
      callback(new Error(message))
    }
  }

  _convertRelayRequestIdToRpcSendResponse (relayRequestID: PrefixedHexString, request: JsonRpcPayload): JsonRpcResponse {
    const id = (typeof request.id === 'string' ? parseInt(request.id) : request.id) ?? -1
    return {
      jsonrpc: '2.0',
      id,
      result: relayRequestID
    }
  }

  async _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1
    const relayRequestID = payload.params[0] as string
    const submissionDetails = this.relayClient.submittedRelayRequests.get(relayRequestID)
    if (submissionDetails == null) {
      super._ethGetTransactionReceipt(payload, callback)
      return
    }
    try {
      const result = await this._createTransactionReceiptForBatchId(relayRequestID, submissionDetails)
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

  /**
   * Avoid modifying the transaction receipt if it is was not a known RelayRequestID
   */
  _getTranslatedGsnResponseResult (respResult: BaseTransactionReceipt): BaseTransactionReceipt {
    return respResult
  }

  /**
   * If the transaction is already mined, return a simulated successful transaction receipt
   * If the transaction is no longer valid, return a simulated reverted transaction receipt
   * If the transaction can still be mined, returns "null" like a regular RPC call would do
   */
  async _createTransactionReceiptForBatchId (
    relayRequestID: string,
    submissionDetails: SubmittedRelayRequestInfo): Promise<TransactionReceipt | null> {
    const extraTopics = [undefined, undefined, [relayRequestID]]
    const events = await this.relayClient.dependencies.contractInteractor.getPastEventsForHub(
      extraTopics,
      { fromBlock: submissionDetails.submissionBlock },
      [TransactionRelayed, TransactionRejectedByPaymaster])
    if (events.length === 0) {
      const currentBlock = await this.web3.eth.getBlockNumber()
      if (parseInt(submissionDetails.validUntil) > currentBlock) {
        return null
      }
      return this._createTransactionRevertedReceipt()
    }

    const eventData = await this._pickSingleEvent(events, relayRequestID)
    const batchTransactionReceipt = await this.web3.eth.getTransactionReceipt(eventData.transactionHash)
    return this._translateBatchReceiptToTransactionReceipt(relayRequestID, batchTransactionReceipt)
  }

  /**
   * In an edge case many events with the same ID may be mined.
   * If there is a successful {@link TransactionRelayed} event, it will be returned.
   * If all events are {@link TransactionRejectedByPaymaster}, return the last one.
   * If there is more then one successful {@link TransactionRelayed} throws as this is impossible for current Forwarder
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

  /**
   * Filter out events emitted inside the batch element defined by the {@param relayRequestID}
   * @param relayRequestID - unique identifier of an element in a batch
   * @param batchTransactionReceipt - the receipt containing all events emitted during the batch execution
   */
  _translateBatchReceiptToTransactionReceipt (
    // TODO: horrible code; due to 'decodeLogs' losing logIndex, need multiple different iterators; refactor or modify the decodeLogs
    relayRequestID: string,
    batchTransactionReceipt: TransactionReceipt
  ): TransactionReceipt {
    const decodedHubLogs = abiDecoder.decodeLogs(batchTransactionReceipt.logs).filter((it: any) => [TransactionRelayed, TransactionRejectedByPaymaster].includes(it.name))
    const methodIDs = abiDecoder.getMethodIDs()
    const hubEventsIndexes = batchTransactionReceipt.logs
      .filter(
        it => {
          return [TransactionRelayed, TransactionRejectedByPaymaster].includes(methodIDs[removeHexPrefix(it.topics[0])]?.name)
        }
      )
      .map(it => it.logIndex)
    const eventsForCurrentRelayRequestId = []
    let j = hubEventsIndexes.length - 1
    let isInRange = false
    for (let i = batchTransactionReceipt.logs.length - 1; i >= 0; i--) {
      const rawEvent = batchTransactionReceipt.logs[i]
      if (rawEvent.logIndex === hubEventsIndexes[j]) {
        if (decodedHubLogs[j].events.find((it: any) => it.name === 'relayRequestID')?.value === relayRequestID) {
          isInRange = true
          j--
          continue
        } else if (decodedHubLogs[j].events.find((it: any) => it.name === 'relayRequestID')?.value !== relayRequestID && isInRange) {
          break
        }
        j--
      }
      if (isInRange) {
        eventsForCurrentRelayRequestId.push(rawEvent)
      }
    }
    return Object.assign({}, batchTransactionReceipt, { logs: eventsForCurrentRelayRequestId.reverse(), status: '0x1' })
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
