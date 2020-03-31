class GasData {
  constructor ({ gasLimit, gasPrice, pctRelayFee, baseRelayFee }) {
    this.gasLimit = gasLimit
    this.gasPrice = gasPrice
    this.pctRelayFee = pctRelayFee
    this.baseRelayFee = baseRelayFee
  }
}

module.exports = GasData
