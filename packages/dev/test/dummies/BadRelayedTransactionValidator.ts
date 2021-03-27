import { RelayedTransactionValidator } from '@opengsn/provider/dist/RelayedTransactionValidator'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { GSNConfig } from '@opengsn/provider/dist'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'

export class BadRelayedTransactionValidator extends RelayedTransactionValidator {
  private readonly failValidation: boolean

  constructor (logger: LoggerInterface, failValidation: boolean, contractInteractor: ContractInteractor, config: GSNConfig) {
    super(contractInteractor, logger, config)
    this.failValidation = failValidation
  }

  validateRelayResponse (transactionJsonRequest: RelayTransactionRequest, maxAcceptanceBudget: number, returnedTx: string): boolean {
    if (this.failValidation) {
      return false
    }
    return super.validateRelayResponse(transactionJsonRequest, maxAcceptanceBudget, returnedTx)
  }
}
