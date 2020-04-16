import RelayProvider from './RelayProvider'
import {DevRelayClient, DevClientConfig} from './DevRelayClient'
import RelayClient from './RelayClient'
import { HttpProvider } from 'web3-core'
import { GSNConfig } from './GSNConfigurator'

export default class GsnDevProvider extends RelayProvider {

  devRelayClient : DevRelayClient

  /**
   * Create a dev provider.
   * Create a provider that brings up an in-process relay.
   */
  constructor (origProvider: HttpProvider, gsnConfig: GSNConfig, devConfig: DevClientConfig, devRelayClient?: DevRelayClient) {

    const client = devRelayClient ?? new DevRelayClient(
        RelayClient.getDefaultDependencies(origProvider, gsnConfig),
        gsnConfig.relayHubAddress,
        gsnConfig.relayClientConfig, devConfig)
    super(origProvider, gsnConfig, client)
    this.devRelayClient = client
  }

  async stopRelay (): Promise<void> {
    await this.devRelayClient.stopRelay()
  }
}
