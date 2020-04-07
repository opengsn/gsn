const RelayProvider = require('./RelayProvider')
const DevRelayClient = require('./DevRelayClient')

class GsnDevProvider extends RelayProvider {
  /**
   * create a dev provider.
   * @param origProvider - the underlying web3 provider
   * @param relayOptions:
   *      relayHub - RelayHub address (must be already deployed)
   *      paymaster - a paymaster to use (must be already deployed)
   *      (and other RelayProvider options, if needed)
   */
  constructor (origProvider, relayOptions) {
    super(origProvider, relayOptions)

    this.relayClient = new DevRelayClient(this.relayClient.web3, this.relayClient.config)
  }

  stop () {
    this.relayClient.stop()
  }
}

module.exports = GsnDevProvider
