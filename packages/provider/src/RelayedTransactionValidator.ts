import { Transaction } from '@ethereumjs/tx'
import { PrefixedHexString, toBuffer } from 'ethereumjs-util'

import { isSameAddress } from '@opengsn/common/dist/Utils'

import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { GSNConfig } from './GSNConfigurator'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

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
    maxAcceptanceBudget: number,
    returnedTx: PrefixedHexString
  ): boolean {
    const tx = Transaction.fromSerializedTx(toBuffer(returnedTx), this.contractInteractor.getRawTxOptions())
    const transaction = {
      signer: tx.getSenderAddress().toString(),
      ...tx.toJSON()
    } as any

    if (transaction.to == null) {
      throw new Error('transaction.to must be defined')
    }
    if (transaction.s == null || transaction.r == null || transaction.v == null) {
      throw new Error('tx signature must be defined')
    }

    this.logger.debug(`returnedTx: ${JSON.stringify(transaction, null, 2)}`)

    const signer = transaction.signer

    const externalGasLimit = transaction.gasLimit
    const relayRequestAbiEncode = this.contractInteractor.encodeABI(maxAcceptanceBudget, request.relayRequest, request.metadata.signature, request.metadata.approvalData, externalGasLimit)

    const relayHubAddress = this.contractInteractor.getDeployment().relayHubAddress
    if (relayHubAddress == null) {
      throw new Error('no hub address')
    }

    if (
      isSameAddress(transaction.to, relayHubAddress) &&
      relayRequestAbiEncode === transaction.data &&
      isSameAddress(request.relayRequest.relayData.relayWorker, signer)
    ) {
      this.logger.info('validateRelayResponse - valid transaction response')

      const receivedNonce = parseInt(transaction.nonce)
      if (receivedNonce > request.metadata.relayMaxNonce) {
        // TODO: need to validate that client retries the same request and doesn't double-spend.
        // Note that this transaction is totally valid from the EVM's point of view

        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Relay used a tx nonce higher than requested. Requested ${request.metadata.relayMaxNonce} got ${receivedNonce}`)
      }

      return true
    } else {
      console.error('validateRelayResponse: req', relayRequestAbiEncode, relayHubAddress, request.relayRequest.relayData.relayWorker)
      console.error('validateRelayResponse: rsp', transaction.data, transaction.to, signer)
      return false
    }
  }
}
