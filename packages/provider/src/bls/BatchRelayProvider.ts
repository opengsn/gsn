import { JsonRpcCallback, RelayProvider } from '../RelayProvider'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'
import { _dumpRelayingResult, RelayingResult } from '../RelayClient'
import { PrefixedHexString } from 'ethereumjs-util'
import {
  TransactionRejectedByPaymaster,
  TransactionRelayed
} from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { EventData } from 'web3-eth-contract'

export class BatchRelayProvider extends RelayProvider {
  web3!: Web3

  relayRequestsValidUntil = new Map<string, number>()

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

  // TODO: if the 'relayCall' reverts the event will be emitted by the BatchGateway, not by the RelayHub
  //  this is an edge case and is currently unsupported
  // TODO 2: it will save some time if we save the block we submit a transaction to avoid "fromBlock: 1" query
  async _ethGetTransactionReceipt (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    try {
      const relayRequestID = payload.params[0] as string
      const id = (typeof payload.id === 'string' ? parseInt(payload.id) : payload.id) ?? -1

      // 1. Find out if this RelayRequestID is already mined
      const extraTopics = [[], [], [relayRequestID]]
      const events = await this.relayClient.dependencies.contractInteractor.getPastEventsForHub(extraTopics, { fromBlock: 1 }, [TransactionRelayed, TransactionRejectedByPaymaster])
      if (events.length === 0) {
        // TODO 3: create a receipt for this relayRequest
        //  depending on 'validUntil', declare the transaction "pending" or "reverted"
        if ((this.relayRequestsValidUntil.get(relayRequestID) ?? 0) > Date.now()) {
          callback(null) // TODO: this seems to the behaviour for a transaction that is not mined; must validate
          return
        }

        const result = this._createTransactionRevertedReceipt()
        const rpcResponse = {
          id,
          result,
          jsonrpc: '2.0'
        }
        callback(null, rpcResponse)
        return
      }

      if (events.length !== 1) {
        callback(new Error(`only one event expected with relayRequestID ${relayRequestID}`))
        return
      }
      const event = events[0]

      const batchTransactionReceipt = await this.web3.eth.getTransactionReceipt(event.transactionHash)
      const result = this._translateBatchReceiptToTransactionReceipt(batchTransactionReceipt, event)
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

  _translateBatchReceiptToTransactionReceipt (
    batchTransactionReceipt: TransactionReceipt,
    eventData: EventData): TransactionReceipt {
    // 1. This receipt will have tons of events; Filter out ones relevant to current relayRequestId
    throw new Error('not implemented')
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
