class RelayData {
  constructor ({ senderAddress, senderNonce, relayWorker, paymaster }) {
    this.senderAddress = senderAddress
    this.senderNonce = senderNonce
    this.relayWorker = relayWorker
    this.paymaster = paymaster
  }
}

module.exports = RelayData
