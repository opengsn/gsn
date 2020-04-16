import RelayProvider from './RelayProvider'
import DevRelayClient from './DevRelayClient'

class GsnDevProvider extends RelayProvider {
  /**
   * create a dev provider.
   * @param origProvider - the underlying web3 provider
   * @param relayOptions:
   *      relayHub - RelayHub address (must be already deployed)
   *      paymaster - a paymaster to use (must be already deployed)
   *      (and other RelayProvider options, if needed)
   */
  // @ts-ignore
  constructor (origProvider, relayOptions) {
    // @ts-ignore
    super(origProvider, relayOptions)

    // @ts-ignore
    this.relayClient = new DevRelayClient(this.relayClient.web3, this.relayClient.config)
  }

  stop () {
    // @ts-ignore
    this.relayClient.stop()
  }
}

module.exports = GsnDevProvider
