import { HttpProvider } from 'web3-core'
import { SendCallback } from './SendCallback'
import { JsonRpcPayload } from 'web3-core-helpers'

export abstract class WrapperProviderBase implements HttpProvider {
  provider: HttpProvider

  protected constructor (provider: HttpProvider) {
    this.provider = provider
  }

  get connected (): boolean {
    return this.provider.connected
  }

  get host (): string {
    return this.provider.host
  }

  disconnect (): boolean {
    return this.provider.disconnect()
  }

  abstract send (payload: JsonRpcPayload, callback: SendCallback): void

  supportsSubscriptions (): boolean {
    return this.provider.supportsSubscriptions()
  }
}
