import Web3 from 'web3'
import { PrefixedHexString, toBuffer, bufferToHex } from 'ethereumjs-util'
import { TypedTransaction, Transaction, FeeMarketEIP1559Transaction, TransactionFactory } from '@ethereumjs/tx'
import { toBN } from 'web3-utils'

import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { isSameAddress } from '@opengsn/common/dist/Utils'

import { GSNConfig } from './GSNConfigurator'

export interface GasPriceValidationResult {
  isTransactionTypeValid: boolean
  isFeeMarket1559Transaction: boolean
  isLegacyGasPriceValid: boolean
  isMaxFeePerGasValid: boolean
  isMaxPriorityFeePerGasValid: boolean
}

export interface TransactionValidationResult {
  gasPriceValidationResult: GasPriceValidationResult
  nonceGapFilledValidationResult: TransactionValidationResult[]
  isNonceGapFilledSizeValid: boolean
  isTransactionTargetValid: boolean
  isTransactionSenderValid: boolean
  isTransactionContentValid: boolean
  isTransactionNonceValid: boolean
}

export function isTransactionValid (result: TransactionValidationResult): boolean {
  const isValid1559GasFee =
    result.gasPriceValidationResult.isFeeMarket1559Transaction &&
    result.gasPriceValidationResult.isMaxFeePerGasValid &&
    result.gasPriceValidationResult.isMaxPriorityFeePerGasValid
  const isGasPriceValid =
    result.gasPriceValidationResult.isTransactionTypeValid &&
    (result.gasPriceValidationResult.isLegacyGasPriceValid || isValid1559GasFee)

  // this call is 'recursive' but transactions inside nonce gap have empty arrays here and function is not called
  const isNonceGapFilled = !result.nonceGapFilledValidationResult.map(it => isTransactionValid(it)).includes(false)
  return isGasPriceValid &&
    isNonceGapFilled &&
    result.isTransactionTargetValid &&
    result.isTransactionSenderValid &&
    result.isTransactionContentValid &&
    result.isNonceGapFilledSizeValid &&
    result.isTransactionNonceValid
}

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
   * @returns true if relay response is valid, false otherwise
   */
  validateTransactionInNonceGap (request: RelayTransactionRequest, transaction: TypedTransaction, expectedNonce: number): TransactionValidationResult {
    const isTransactionSenderValid = this._validateTransactionSender(request, transaction)
    const isTransactionTargetValid = this.validateTransactionTarget(transaction)
    const isTransactionContentValid = this._validateTransactionMethodSignature(transaction)
    const gasPriceValidationResult = this._validateGasPrice(request, transaction)
    const isTransactionNonceValid = parseInt(transaction.nonce.toString()) === expectedNonce
    return {
      nonceGapFilledValidationResult: [],
      isNonceGapFilledSizeValid: true,
      isTransactionTargetValid,
      isTransactionSenderValid,
      isTransactionContentValid,
      gasPriceValidationResult,
      isTransactionNonceValid
    }
  }

  validateRelayResponse (
    request: RelayTransactionRequest,
    returnedTx: PrefixedHexString,
    nonceGapFilled: PrefixedHexString[]
  ): TransactionValidationResult {
    const transaction = TransactionFactory.fromSerializedData(toBuffer(returnedTx), this.contractInteractor.getRawTxOptions())
    this.logger.debug(`returnedTx: ${JSON.stringify(transaction.toJSON(), null, 2)}`)

    const nonce = parseInt(transaction.nonce.toString())
    const expectedNonceGapLength = nonce - request.metadata.relayLastKnownNonce
    const isNonceGapFilledSizeValid = nonceGapFilled.length === expectedNonceGapLength
    const isTransactionTargetValid = this.validateTransactionTarget(transaction)
    const isTransactionSenderValid = this._validateTransactionSender(request, transaction)
    const isTransactionContentValid = this._validateTransactionContent(request, transaction)
    const gasPriceValidationResult = this._validateGasPrice(request, transaction)
    const isTransactionNonceValid = nonce <= request.metadata.relayMaxNonce
    const nonceGapFilledValidationResult =
      this._validateNonceGapFilled(
        request,
        nonceGapFilled
      )

    return {
      gasPriceValidationResult,
      isTransactionTargetValid,
      isTransactionSenderValid,
      isTransactionContentValid,
      isTransactionNonceValid,
      isNonceGapFilledSizeValid,
      nonceGapFilledValidationResult
    }
  }

  private validateTransactionTarget (transaction: TypedTransaction): boolean {
    const relayHubAddress = this.contractInteractor.getDeployment().relayHubAddress
    return transaction.to != null && relayHubAddress != null && isSameAddress(transaction.to.toString(), relayHubAddress)
  }

  _validateTransactionSender (
    request: RelayTransactionRequest,
    transaction: TypedTransaction
  ): boolean {
    const signer = transaction.getSenderAddress().toString()
    return isSameAddress(request.relayRequest.relayData.relayWorker, signer)
  }

  /**
   * For transactions that are filling the nonce gap, we only check that the transaction is not penalizable.
   */
  _validateTransactionMethodSignature (transaction: TypedTransaction): boolean {
    const relayCallSignature = new Web3().eth.abi.encodeFunctionSignature(RelayHubABI.find(it => it.name === 'relayCall') as any)
    return bufferToHex(transaction.data).startsWith(relayCallSignature)
  }

  _validateTransactionContent (request: RelayTransactionRequest, transaction: TypedTransaction): boolean {
    const relayRequestAbiEncode = this.contractInteractor.encodeABI({
      relayRequest: request.relayRequest,
      signature: request.metadata.signature,
      approvalData: request.metadata.approvalData,
      maxAcceptanceBudget: request.metadata.maxAcceptanceBudget
    })
    return relayRequestAbiEncode === bufferToHex(transaction.data)
  }

  _validateGasPrice (request: RelayTransactionRequest, transaction: TypedTransaction): GasPriceValidationResult {
    let isTransactionTypeValid = true
    let isFeeMarket1559Transaction = false
    let isLegacyGasPriceValid = false
    let isMaxFeePerGasValid = false
    let isMaxPriorityFeePerGasValid = false

    if (transaction instanceof Transaction) {
      isLegacyGasPriceValid = transaction.gasPrice.gte(toBN(request.relayRequest.relayData.maxFeePerGas))
      // throw new Error(`Relay Server signed gas price too low (${transaction.gasPrice}). Requested transaction with gas price at least ${request.relayRequest.relayData.maxPriorityFeePerGas}`)
    } else if (transaction instanceof FeeMarketEIP1559Transaction) {
      isFeeMarket1559Transaction = true
      isMaxPriorityFeePerGasValid = transaction.maxPriorityFeePerGas.gte(toBN(request.relayRequest.relayData.maxPriorityFeePerGas))
      // throw new Error(`Relay Server signed max priority fee too low (${transaction.maxPriorityFeePerGas}). Requested transaction with priority fee at least ${request.relayRequest.relayData.maxPriorityFeePerGas}`)
      isMaxFeePerGasValid = transaction.maxFeePerGas.gte(toBN(request.relayRequest.relayData.maxFeePerGas))
      // throw new Error(`Relay Server signed max fee too low (${transaction.maxFeePerGas}). Requested transaction with max fee at least ${request.relayRequest.relayData.maxFeePerGas}`)
    } else {
      isTransactionTypeValid = false
      // throw new Error('Transaction must have either gasPrice or (maxFeePerGas and maxPriorityFeePerGas)')
    }
    return {
      isTransactionTypeValid,
      isFeeMarket1559Transaction,
      isLegacyGasPriceValid,
      isMaxFeePerGasValid,
      isMaxPriorityFeePerGasValid
    }
  }

  _validateNonceGapFilled (
    request: RelayTransactionRequest,
    transactionsInGap: PrefixedHexString[]
  ): TransactionValidationResult[] {
    const result: TransactionValidationResult[] = []
    let expectedNonce = request.metadata.relayLastKnownNonce
    for (const rawTransaction of transactionsInGap) {
      const transaction = TransactionFactory.fromSerializedData(toBuffer(rawTransaction), this.contractInteractor.getRawTxOptions())
      const validationResult = this.validateTransactionInNonceGap(request, transaction, expectedNonce)
      result.push(validationResult)
      expectedNonce++
    }
    return result
  }
}
