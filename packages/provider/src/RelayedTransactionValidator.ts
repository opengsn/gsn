import { TransactionFactory } from '@ethereumjs/tx'
import { PrefixedHexString, toBuffer } from 'ethereumjs-util'

import { isSameAddress } from '@opengsn/common/dist/Utils'

import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { GSNConfig } from './GSNConfigurator'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { toBN } from 'web3-utils'

export class RelayedTransactionValidator {
  private readonly contractInteractor: ContractInteractor
  private readonly config: GSNConfig
  private readonly logger: LoggerInterface

  constructor (contractInteractor: ContractInteractor, logger: LoggerInterface, config: GSNConfig) {
    this.contractInteractor = contractInteractor
    this.config = config
    this.logger = logger
  }

  /**
   * Decode the signed transaction returned from the Relay Server, compare it to the
   * requested transaction and validate its signature.
   * @returns a signed {@link Transaction} instance for broadcasting, or null if returned
   * transaction is not valid.
   */
  validateRelayResponse (
    request: RelayTransactionRequest,
    returnedTx: PrefixedHexString
  ): boolean {
    const tx = TransactionFactory.fromSerializedData(toBuffer(returnedTx), this.contractInteractor.getRawTxOptions())
    const transaction = {
      signer: tx.getSenderAddress().toString(),
      ...tx.toJSON()
    }

    if (transaction.to == null) {
      throw new Error('transaction.to must be defined')
    }
    if (transaction.s == null || transaction.r == null || transaction.v == null) {
      throw new Error('tx signature must be defined')
    }

    this.logger.debug(`returnedTx: ${JSON.stringify(transaction, null, 2)}`)

    const signer = transaction.signer

    const relayRequestAbiEncode = this.contractInteractor.encodeABI({
      relayRequest: request.relayRequest,
      signature: request.metadata.signature,
      approvalData: request.metadata.approvalData,
      maxAcceptanceBudget: request.metadata.maxAcceptanceBudget
    })

    const relayHubAddress = this.contractInteractor.getDeployment().relayHubAddress
    if (relayHubAddress == null) {
      throw new Error('no hub address')
    }

    if (
      isSameAddress(transaction.to, relayHubAddress) &&
      relayRequestAbiEncode === transaction.data &&
      isSameAddress(request.relayRequest.relayData.relayWorker, signer)
    ) {
      if (transaction.gasPrice != null) {
        if (toBN(transaction.gasPrice).lt(toBN(request.relayRequest.relayData.maxPriorityFeePerGas))) {
          throw new Error(`Relay Server signed gas price too low (${transaction.gasPrice}). Requested transaction with gas price at least ${request.relayRequest.relayData.maxPriorityFeePerGas}`)
        }
      } else if (transaction.maxFeePerGas != null && transaction.maxPriorityFeePerGas != null) {
        if (toBN(transaction.maxPriorityFeePerGas).lt(toBN(request.relayRequest.relayData.maxPriorityFeePerGas))) {
          throw new Error(`Relay Server signed max priority fee too low (${transaction.maxPriorityFeePerGas}). Requested transaction with priority fee at least ${request.relayRequest.relayData.maxPriorityFeePerGas}`)
        }
        if (toBN(transaction.maxFeePerGas).lt(toBN(request.relayRequest.relayData.maxFeePerGas))) {
          throw new Error(`Relay Server signed max fee too low (${transaction.maxFeePerGas}). Requested transaction with max fee at least ${request.relayRequest.relayData.maxFeePerGas}`)
        }
      } else {
        throw new Error('Transaction must have either gasPrice or (maxFeePerGas and maxPriorityFeePerGas)')
      }
      // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
      const receivedNonce = parseInt(transaction.nonce!)
      if (receivedNonce > request.metadata.relayMaxNonce) {
        // TODO: need to validate that client retries the same request and doesn't double-spend.
        // Note that this transaction is totally valid from the EVM's point of view

        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Relay used a tx nonce higher than requested. Requested ${request.metadata.relayMaxNonce} got ${receivedNonce}`)
      }

      this.logger.info('validateRelayResponse - valid transaction response')
      return true
    } else {
      console.error('validateRelayResponse: req', relayRequestAbiEncode, relayHubAddress, request.relayRequest.relayData.relayWorker)
      console.error('validateRelayResponse: rsp', transaction.data, transaction.to, signer)
      return false
    }
  }
}
