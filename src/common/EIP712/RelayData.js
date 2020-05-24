class RelayData {
  constructor ({ senderAddress, senderNonce, relayWorker, paymaster, forwarder }) {
    this.senderAddress = senderAddress
    this.senderNonce = senderNonce
    this.relayWorker = relayWorker
    this.paymaster = paymaster
    this.forwarder = forwarder
  }
}

module.exports = RelayData
