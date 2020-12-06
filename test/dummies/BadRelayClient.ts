import { GSNUnresolvedConstructorInput, RelayClient, RelayingResult } from '../../src/relayclient/RelayClient'
import GsnTransactionDetails from '../../src/common/types/GsnTransactionDetails'

export default class BadRelayClient extends RelayClient {
  static readonly message = 'This is not the transaction you are looking for'

  private readonly failRelay: boolean
  private readonly returnUndefinedTransaction: boolean

  constructor (
    failRelay: boolean,
    returnNullTransaction: boolean,
    rawConstructorInput: GSNUnresolvedConstructorInput
  ) {
    super(rawConstructorInput)
    this.failRelay = failRelay
    this.returnUndefinedTransaction = returnNullTransaction
  }

  async relayTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    if (this.failRelay) {
      throw new Error(BadRelayClient.message)
    }
    if (this.returnUndefinedTransaction) {
      return {
        transaction: undefined,
        pingErrors: new Map<string, Error>(),
        relayingErrors: new Map<string, Error>()
      }
    }
    return await super.relayTransaction(gsnTransactionDetails)
  }
}
