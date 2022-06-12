import {
  RelayedTransactionValidator,
  TransactionValidationResult
} from '@opengsn/provider/dist/RelayedTransactionValidator'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { GSNConfig } from '@opengsn/provider/dist'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { ObjectMap } from '@opengsn/common'

export class BadRelayedTransactionValidator extends RelayedTransactionValidator {
  private readonly failValidation: boolean

  constructor (logger: LoggerInterface, failValidation: boolean, contractInteractor: ContractInteractor, config: GSNConfig) {
    super(contractInteractor, logger, config)
    this.failValidation = failValidation
  }

  validateRelayResponse (transactionJsonRequest: RelayTransactionRequest, returnedTx: string, nonceGapFilled: ObjectMap<string>): TransactionValidationResult {
    const superCallResult = super.validateRelayResponse(transactionJsonRequest, returnedTx, nonceGapFilled)
    if (this.failValidation) {
      superCallResult.isTransactionContentValid = false
    }
    return superCallResult
  }
}
