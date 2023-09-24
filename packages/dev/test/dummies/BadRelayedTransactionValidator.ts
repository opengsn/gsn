import {
  RelayedTransactionValidator,
  type TransactionValidationResult
} from '@opengsn/provider/dist/RelayedTransactionValidator'
import { type ContractInteractor, type RelayTransactionRequest, type LoggerInterface, type ObjectMap } from '@opengsn/common'
import { type GSNConfig } from '@opengsn/provider/dist'

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
