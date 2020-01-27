class RelayData {
  constructor ({ senderAccount, senderNonce, relayAddress, pctRelayFee }) {
    this.senderAccount = senderAccount
    this.senderNonce = senderNonce
    this.relayAddress = relayAddress
    this.pctRelayFee = pctRelayFee
  }
}

module.exports = RelayData
