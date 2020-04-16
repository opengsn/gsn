import RelayProvider from './RelayProvider'
import DevRelayClient from './DevRelayClient'
import RelayClient from './RelayClient'
import { HttpProvider } from 'web3-core'
import { GSNConfig } from './GSNConfigurator'

export default class GsnDevProvider extends RelayProvider {
  /**
   * create a dev provider.
   * @param origProvider - the underlying web3 provider
   * @param relayOptions:
   *      relayHub - RelayHub address (must be already deployed)
   *      paymaster - a paymaster to use (must be already deployed)
   *      (and other RelayProvider options, if needed)
   */

  constructor (relayClient: RelayClient | undefined, origProvider: HttpProvider, gsnConfig: GSNConfig) {
    // @ts-ignore
    super(origProvider, relayOptions)

    // @ts-ignore
    this.relayClient = new DevRelayClient(this.relayClient.web3, this.relayClient.config)
  }

  // @ts-ignore
  stop (): void {
    // @ts-ignore
    this.relayClient.stop()
  }
}
