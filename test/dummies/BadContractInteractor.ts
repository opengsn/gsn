import ContractInteractor from '../../src/relayclient/ContractInteractor'
import RelayRequest from '../../src/common/EIP712/RelayRequest'
import { ContractInteractorConfig } from '../../src/relayclient/GSNConfigurator'

export default class BadContractInteractor extends ContractInteractor {
  static readonly message = 'This is not the contract you are looking for'

  private readonly failValidateARC: boolean

  constructor (provider: provider, config: ContractInteractorConfig, failValidateARC: boolean) {
    super(provider, config)
    this.failValidateARC = failValidateARC
  }

  async validateAcceptRelayCall (relayRequest: RelayRequest, signature: string, approvalData: string, relayHubAddress: string): Promise<{ success: boolean, returnValue: string, reverted: boolean }> {
    if (this.failValidateARC) {
      return {
        success: false,
        reverted: true,
        returnValue: BadContractInteractor.message
      }
    }
    return super.validateAcceptRelayCall(relayRequest, signature, approvalData, relayHubAddress)
  }
}
