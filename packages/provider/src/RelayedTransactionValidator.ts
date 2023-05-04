import { PrefixedHexString } from 'ethereumjs-util'

import { Transaction, parse } from '@ethersproject/transactions'

import { Interface } from '@ethersproject/abi'

import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'
import {
  ContractInteractor,
  LoggerInterface,
  ObjectMap,
  RelayTransactionRequest,
  isSameAddress
} from '@opengsn/common'

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
  validateTransactionInNonceGap (request: RelayTransactionRequest, transaction: Transaction, expectedNonce: number): TransactionValidationResult {
    const isTransactionSenderValid = this._validateTransactionSender(request, transaction)
    const isTransactionTargetValid = this.validateTransactionTarget(transaction)
    const isTransactionContentValid = this._validateTransactionMethodSignature(transaction)
    const gasPriceValidationResult = this._validateNonceGapGasPrice(request, transaction)
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
    nonceGapFilled: ObjectMap<PrefixedHexString>
  ): TransactionValidationResult {
    const transaction = parse(returnedTx)
    this.logger.debug(`returnedTx: ${JSON.stringify(transaction, null, 2)}`)

    const nonce = parseInt(transaction.nonce.toString())
    const expectedNonceGapLength = nonce - request.metadata.relayLastKnownNonce
    const isNonceGapFilledSizeValid = Object.keys(nonceGapFilled).length === expectedNonceGapLength
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

  private validateTransactionTarget (transaction: Transaction): boolean {
    const relayHubAddress = this.contractInteractor.getDeployment().relayHubAddress
    return transaction.to != null && relayHubAddress != null && isSameAddress(transaction.to.toString(), relayHubAddress)
  }

  _validateTransactionSender (
    request: RelayTransactionRequest,
    transaction: Transaction
  ): boolean {
    const signer = transaction.from ?? ''
    return isSameAddress(request.relayRequest.relayData.relayWorker, signer)
  }

  /**
   * For transactions that are filling the nonce gap, we only check that the transaction is not penalizable.
   */
  _validateTransactionMethodSignature (transaction: Transaction): boolean {
    const iface = new Interface(RelayHubABI)
    const relayCallSignature = iface.getSighash('relayCall')
    return transaction.data.startsWith(relayCallSignature)
  }

  _validateTransactionContent (request: RelayTransactionRequest, transaction: Transaction): boolean {
    const relayRequestAbiEncode = this.contractInteractor.encodeABI({
      domainSeparatorName: request.metadata.domainSeparatorName,
      relayRequest: request.relayRequest,
      signature: request.metadata.signature,
      approvalData: request.metadata.approvalData,
      maxAcceptanceBudget: request.metadata.maxAcceptanceBudget
    })
    return relayRequestAbiEncode === transaction.data
  }

  _validateNonceGapGasPrice (_request: RelayTransactionRequest, _transaction: Transaction): GasPriceValidationResult {
    // TODO: implement logic for verifying gas price is valid for transactions in the nonce gap
    this.logger.debug('not checking gas prices for transaction in nonce gap - not implemented')
    return {
      isTransactionTypeValid: true,
      isFeeMarket1559Transaction: true,
      isLegacyGasPriceValid: true,
      isMaxFeePerGasValid: true,
      isMaxPriorityFeePerGasValid: true
    }
  }

  _validateGasPrice (request: RelayTransactionRequest, transaction: Transaction): GasPriceValidationResult {
    let isTransactionTypeValid = true
    let isFeeMarket1559Transaction = false
    let isLegacyGasPriceValid = false
    let isMaxFeePerGasValid = false
    let isMaxPriorityFeePerGasValid = false

    if (transaction.gasPrice != null) {
      isLegacyGasPriceValid = transaction.gasPrice?.gte(request.relayRequest.relayData.maxFeePerGas) ?? false
    } else if (transaction.maxFeePerGas != null && transaction.maxPriorityFeePerGas != null) {
      isFeeMarket1559Transaction = true
      isMaxPriorityFeePerGasValid = transaction.maxPriorityFeePerGas.gte(request.relayRequest.relayData.maxPriorityFeePerGas)
      isMaxFeePerGasValid = transaction.maxFeePerGas.gte(request.relayRequest.relayData.maxFeePerGas)
    } else {
      isTransactionTypeValid = false
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
    transactionsInGap: ObjectMap<PrefixedHexString>
  ): TransactionValidationResult[] {
    const result: TransactionValidationResult[] = []
    let expectedNonce = request.metadata.relayLastKnownNonce
    for (const rawTransaction of Object.values(transactionsInGap)) {
      const transaction = parse(rawTransaction)
      const validationResult = this.validateTransactionInNonceGap(request, transaction, expectedNonce)
      result.push(validationResult)
      expectedNonce++
    }
    return result
  }
}
