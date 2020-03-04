class RelayData {
  constructor ({ senderAccount, senderNonce, relayAddress, pctRelayFee, paymaster }) {
    this.senderAccount = senderAccount
    this.senderNonce = senderNonce
    this.relayAddress = relayAddress
    this.pctRelayFee = pctRelayFee
    this.paymaster = paymaster
  }
}

module.exports = RelayData
