import { PrefixedHexString } from 'ethereumjs-tx'

import PingResponse from '../common/PingResponse'
import HttpWrapper from './HttpWrapper'
import TmpRelayTransactionJsonRequest from './types/TmpRelayTransactionJsonRequest'
import { GSNConfig } from './GSNConfigurator'

export default class HttpClient {
  private readonly httpWrapper: HttpWrapper
  private readonly config: GSNConfig

  constructor (httpWrapper: HttpWrapper, config: GSNConfig) {
    this.httpWrapper = httpWrapper
    this.config = config
  }

  async getPingResponse (relayUrl: string): Promise<PingResponse> {
    const pingResponse: PingResponse = await this.httpWrapper.sendPromise(relayUrl + '/getaddr', {})
    if (this.config.verbose) {
      console.log('error, body', pingResponse)
    }
    if (pingResponse == null) {
      throw new Error('Relay responded without a body')
    }
    return pingResponse
  }

  async relayTransaction (relayUrl: string, request: TmpRelayTransactionJsonRequest): Promise<PrefixedHexString> {
    const { signedTx, error }: { signedTx: string, error: string } = await this.httpWrapper.sendPromise(relayUrl + '/relay', request)
    if (this.config.verbose) {
      console.log('relayTransaction response:', signedTx, error)
    }
    if (error != null) {
      throw new Error(`Got error response from relay: ${error}`)
    }
    if (signedTx == null) {
      throw new Error('body.signedTx field missing.')
    }
    return signedTx
  }
}
