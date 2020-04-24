import { RelayProvider } from './RelayProvider'
import { DevRelayClient, DevGSNConfig } from './DevRelayClient'
import { HttpProvider } from 'web3-core'
import { configureGSN, GSNDependencies } from './GSNConfigurator'

export class GsnDevProvider extends RelayProvider {
  private readonly devRelayClient: DevRelayClient

  /**
   * Create a dev provider.
   * Create a provider that brings up an in-process relay.
   */
  constructor (origProvider: HttpProvider, devConfig: DevGSNConfig, overrideDependencies?: Partial<GSNDependencies>, relayClient?: DevRelayClient) {
    const gsnConfig = configureGSN(devConfig)
    const client = relayClient ?? new DevRelayClient(origProvider, gsnConfig, overrideDependencies)
    super(origProvider, gsnConfig, overrideDependencies, client)
    this.devRelayClient = client
  }

  async stopRelay (): Promise<void> {
    await this.devRelayClient.stopRelay()
  }
}
