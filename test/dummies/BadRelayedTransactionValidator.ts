import RelayedTransactionValidator from '../../src/relayclient/RelayedTransactionValidator'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { Address } from '../../src/relayclient/types/Aliases'
import { TransactionValidatorConfig } from '../../src/relayclient/GSNConfigurator'
import TmpRelayTransactionJsonRequest from '../../src/relayclient/types/TmpRelayTransactionJsonRequest'

export default class BadRelayedTransactionValidator extends RelayedTransactionValidator {
  private readonly failValidation: boolean

  constructor (failValidation: boolean, contractInteractor: ContractInteractor, relayHubAddress: Address, chainId: number, config: TransactionValidatorConfig) {
    super(contractInteractor, relayHubAddress, chainId, config)
    this.failValidation = failValidation
  }

  validateRelayResponse (transactionJsonRequest: TmpRelayTransactionJsonRequest, returnedTx: string): boolean {
    if (this.failValidation) {
      return false
    }
    return super.validateRelayResponse(transactionJsonRequest, returnedTx)
  }
}
