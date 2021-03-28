import { TransactionReceipt } from 'web3-core'

import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { ContractInteractor, ConstructorParams } from '@opengsn/common/dist/ContractInteractor'

export class BadContractInteractor extends ContractInteractor {
  static readonly message = 'This is not the contract you are looking for'
  static readonly wrongNonceMessage = 'the tx doesn\'t have the correct nonce'

  private readonly failValidateARC: boolean

  constructor (constructorParams: ConstructorParams, failValidateARC: boolean) {
    super(constructorParams)
    this.failValidateARC = failValidateARC
  }

  async validateRelayCall (maxAcceptanceBudget: number, relayRequest: RelayRequest, signature: string, approvalData: string): Promise<{ paymasterAccepted: boolean, returnValue: string, reverted: boolean }> {
    if (this.failValidateARC) {
      return {
        paymasterAccepted: false,
        reverted: true,
        returnValue: BadContractInteractor.message
      }
    }
    return await super.validateRelayCall(10e6, relayRequest, signature, approvalData)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async sendSignedTransaction (rawTx: string): Promise<TransactionReceipt> {
    throw new Error(BadContractInteractor.wrongNonceMessage)
  }
}
