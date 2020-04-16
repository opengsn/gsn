import ContractInteractor from '../../src/relayclient/ContractInteractor'
import RelayRequest from '../../src/common/EIP712/RelayRequest'
import { GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { TransactionReceipt } from 'web3-core'

export default class BadContractInteractor extends ContractInteractor {
  static readonly message = 'This is not the contract you are looking for'
  static readonly wrongNonceMessage = 'the tx doesn\'t have the correct nonce'

  private readonly failValidateARC: boolean

  constructor (provider: provider, config: GSNConfig, failValidateARC: boolean) {
    super(provider, config)
    this.failValidateARC = failValidateARC
  }

  async validateAcceptRelayCall (relayRequest: RelayRequest, signature: string, approvalData: string): Promise<{ success: boolean, returnValue: string, reverted: boolean }> {
    if (this.failValidateARC) {
      return {
        success: false,
        reverted: true,
        returnValue: BadContractInteractor.message
      }
    }
    return super.validateAcceptRelayCall(relayRequest, signature, approvalData)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async sendSignedTransaction (rawTx: string): Promise<TransactionReceipt> {
    throw new Error(BadContractInteractor.wrongNonceMessage)
  }
}
