import { TransactionResponse } from '@ethersproject/providers'
import { ContractInteractor, ConstructorParams, RelayCallABI } from '@opengsn/common'

export class BadContractInteractor extends ContractInteractor {
  static readonly message = 'This is not the contract you are looking for'
  static readonly wrongNonceMessage = 'the tx doesn\'t have the correct nonce'

  private readonly failValidateARC: boolean

  constructor (constructorParams: ConstructorParams, failValidateARC: boolean) {
    super(constructorParams)
    this.failValidateARC = failValidateARC
  }

  async validateRelayCall (relayCallABIData: RelayCallABI, viewCallGasLimit: BN, isDryRun: boolean): Promise<{ paymasterAccepted: boolean, returnValue: string, relayHubReverted: boolean, recipientReverted: boolean }> {
    if (this.failValidateARC) {
      return {
        paymasterAccepted: false,
        relayHubReverted: true,
        recipientReverted: false,
        returnValue: BadContractInteractor.message
      }
    }
    return await super.validateRelayCall(relayCallABIData, viewCallGasLimit, isDryRun)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async sendSignedTransaction (rawTx: string): Promise<TransactionResponse> {
    throw new Error(BadContractInteractor.wrongNonceMessage)
  }
}
