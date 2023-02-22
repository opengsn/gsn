import { JsonRpcProvider } from '@ethersproject/providers'

export abstract class WrapperProviderBase extends JsonRpcProvider {
  provider: JsonRpcProvider

  protected constructor (provider: JsonRpcProvider) {
    super()
    this.provider = provider
  }

  abstract send (method: string, params: any[]): Promise<any>
}
