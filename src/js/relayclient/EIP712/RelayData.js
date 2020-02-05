class RelayData {
  constructor ({ senderAccount, senderNonce, relayAddress, pctRelayFee, gasSponsor }) {
    this.senderAccount = senderAccount
    this.senderNonce = senderNonce
    this.relayAddress = relayAddress
    this.pctRelayFee = pctRelayFee
    this.gasSponsor = gasSponsor
  }
}

module.exports = RelayData
