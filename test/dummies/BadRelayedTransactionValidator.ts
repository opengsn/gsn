import RelayedTransactionValidator from '../../src/relayclient/RelayedTransactionValidator'
import ContractInteractor from '../../src/common/ContractInteractor'
import { GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { RelayTransactionRequest } from '../../src/common/types/RelayTransactionRequest'
import { LoggerInterface } from '../../src/common/LoggerInterface'

export default class BadRelayedTransactionValidator extends RelayedTransactionValidator {
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
