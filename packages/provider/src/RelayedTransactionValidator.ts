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
    const transaction = Transaction.fromSerializedTx(toBuffer(returnedTx), this.contractInteractor.getRawTxOptions())

    this.logger.info(`returnedTx:
    v:        ${bufferToHex(transaction.v!.toBuffer())}
    r:        ${bufferToHex(transaction.r!.toBuffer())}
    s:        ${bufferToHex(transaction.s!.toBuffer())}
    to:       ${transaction.to!.toString()}
    data:     ${bufferToHex(transaction.data)}
    gasLimit: ${bufferToHex(transaction.gasLimit!.toBuffer())}
    gasPrice: ${bufferToHex(transaction.gasPrice!.toBuffer())}
    value:    ${bufferToHex(transaction.value!.toBuffer())}
    `)

    const signer = bufferToHex(transaction.getSenderAddress().toBuffer())

    const externalGasLimit = bufferToHex(transaction.gasLimit!.toBuffer())
    const relayRequestAbiEncode = this.contractInteractor.encodeABI(maxAcceptanceBudget, request.relayRequest, request.metadata.signature, request.metadata.approvalData, externalGasLimit)

    const relayHubAddress = this.contractInteractor.getDeployment().relayHubAddress
    if (relayHubAddress == null) {
      throw new Error('no hub address')
    }

    if (
      isSameAddress(bufferToHex(transaction.to!.toBuffer()), relayHubAddress) &&
      relayRequestAbiEncode === bufferToHex(transaction.data) &&
      isSameAddress(request.relayRequest.relayData.relayWorker, signer)
    ) {
      this.logger.info('validateRelayResponse - valid transaction response')

      const receivedNonce = transaction.nonce.toNumber()
      if (receivedNonce > request.metadata.relayMaxNonce) {
        // TODO: need to validate that client retries the same request and doesn't double-spend.
        // Note that this transaction is totally valid from the EVM's point of view

        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Relay used a tx nonce higher than requested. Requested ${request.metadata.relayMaxNonce} got ${receivedNonce}`)
      }

      return true
    } else {
      console.error('validateRelayResponse: req', relayRequestAbiEncode, relayHubAddress, request.relayRequest.relayData.relayWorker)
      console.error('validateRelayResponse: rsp', bufferToHex(transaction.data), bufferToHex(transaction.to!.toBuffer()), signer)
      return false
    }
  }
}
