import BN from 'bn.js'
import { Transaction } from '@ethereumjs/tx'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'
import { toHex } from 'web3-utils'

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
    returnedTx: PrefixedHexString,
    baseRelayFeeBiddingMode: boolean
  ): boolean {
    const transaction = Transaction.fromSerializedTx(toBuffer(returnedTx), this.contractInteractor.getRawTxOptions())
    if (transaction.to == null) {
      throw new Error('transaction.to must be defined')
    }
    if (transaction.s == null || transaction.r == null || transaction.v == null) {
      throw new Error('tx signature must be defined')
    }
    this.logger.info(`returnedTx:
    v:        ${toHex(transaction.v)}
    r:        ${toHex(transaction.r)}
    s:        ${toHex(transaction.s)}
    to:       ${transaction.to.toString()}
    data:     ${bufferToHex(transaction.data)}
    gasLimit: ${toHex(transaction.gasLimit)}
    gasPrice: ${toHex(transaction.gasPrice)}
    value:    ${toHex(transaction.value)}
    `)

    const signer = transaction.getSenderAddress().toString()

    const externalGasLimit = toHex(transaction.gasLimit)
    const relayRequestAbiEncode = this.contractInteractor.encodeABI({
      maxAcceptanceBudget,
      relayRequest: request.relayRequest,
      signature: request.metadata.signature,
      approvalData: request.metadata.approvalData,
      externalGasLimit: baseRelayFeeBiddingMode ? '0x0' : externalGasLimit
    })

    const relayHubAddress = this.contractInteractor.getDeployment().relayHubAddress
    if (relayHubAddress == null) {
      throw new Error('no hub address')
    }

    if (
      isSameAddress(transaction.to.toString(), relayHubAddress) &&
      relayRequestAbiEncode === bufferToHex(transaction.data) &&
      isSameAddress(request.relayRequest.relayData.relayWorker, signer)
    ) {
      const minAcceptableGasPrice = baseRelayFeeBiddingMode ? request.metadata.minAcceptableGasPrice : request.relayRequest.relayData.gasPrice
      if (transaction.gasPrice.lt(new BN(minAcceptableGasPrice))) {
        throw new Error(`Relay Server signed gas price too low. Requested transaction with gas price at least ${minAcceptableGasPrice}`)
      }
      const receivedNonce = transaction.nonce.toNumber()
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
      console.error('validateRelayResponse: rsp', bufferToHex(transaction.data), transaction.to.toString(), signer)
      return false
    }
  }
}
