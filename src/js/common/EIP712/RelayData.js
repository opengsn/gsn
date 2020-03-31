class RelayData {
  constructor ({ senderAddress, senderNonce, relayAddress, paymaster }) {
    this.senderAddress = senderAddress
    this.senderNonce = senderNonce
    this.relayAddress = relayAddress
    this.paymaster = paymaster
  }
}

module.exports = RelayData
