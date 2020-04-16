import RelayClient, { RelayingResult } from '../../src/relayclient/RelayClient'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'
import { GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { HttpProvider } from 'web3-core'

export default class BadRelayClient extends RelayClient {
  static readonly message = 'This is not the transaction you are looking for'

  private readonly failRelay: boolean
  private readonly returnUndefindedTransaction: boolean

  constructor (
    failRelay: boolean,
    returnNullTransaction: boolean,
    provider: HttpProvider,
    config: GSNConfig
  ) {
    super(provider, config)
    this.failRelay = failRelay
    this.returnUndefindedTransaction = returnNullTransaction
  }

  async relayTransaction (gsnTransactionDetails: GsnTransactionDetails): Promise<RelayingResult> {
    if (this.failRelay) {
      throw new Error(BadRelayClient.message)
    }
    if (this.returnUndefindedTransaction) {
      return {
        transaction: undefined,
        pingErrors: new Map<string, Error>(),
        relayingErrors: new Map<string, Error>()
      }
    }
    return super.relayTransaction(gsnTransactionDetails)
  }
}
