import RelayedTransactionValidator from '../../src/relayclient/RelayedTransactionValidator'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { GSNConfig } from '../../src/relayclient/GSNConfigurator'
import TmpRelayTransactionJsonRequest from '../../src/relayclient/types/TmpRelayTransactionJsonRequest'

export default class BadRelayedTransactionValidator extends RelayedTransactionValidator {
  private readonly failValidation: boolean

  constructor (failValidation: boolean, contractInteractor: ContractInteractor, config: GSNConfig) {
    super(contractInteractor, config)
    this.failValidation = failValidation
  }

  validateRelayResponse (transactionJsonRequest: TmpRelayTransactionJsonRequest, returnedTx: string): boolean {
    if (this.failValidation) {
      return false
    }
    return super.validateRelayResponse(transactionJsonRequest, returnedTx)
  }
}
