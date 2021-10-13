import { Transaction } from '@ethereumjs/tx'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'

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
    if (tx.to == null) {
      throw new Error('transaction.to must be defined')
    }
    if (tx.s == null || tx.r == null || tx.v == null) {
      throw new Error('tx signature must be defined')
    }

    const transaction = {
      v: `0x${tx.v.toString(16)}`,
      r: `0x${tx.r.toString(16)}`,
      s: `0x${tx.s.toString(16)}`,
      to: tx.to.toString(),
      data: `0x${tx.data.toString('hex')}`,
      gasLimit: `0x${tx.gasLimit.toString(16)}`,
      gasPrice: `0x${tx.gasPrice.toString(16)}`,
      value: `0x${tx.value.toString(16)}`,
      nonce: `0x${tx.nonce.toString(16)}`
    }
    console.log
      // this.logger.debug
      (`returnedTx:
    v:        ${transaction.v}
    r:        ${transaction.r}
    s:        ${transaction.s}
    to:       ${transaction.to}
    data:     ${transaction.data}
    gasLimit: ${transaction.gasLimit}
    gasPrice: ${transaction.gasPrice}
    value:    ${transaction.value}
    `)

    const signer = tx.getSenderAddress().toString()

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
