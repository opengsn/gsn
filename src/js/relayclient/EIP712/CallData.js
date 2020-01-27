class CallData {
  constructor ({ target, gasLimit, gasPrice, encodedFunction }) {
    this.target = target
    this.gasLimit = gasLimit
    this.gasPrice = gasPrice
    this.encodedFunction = encodedFunction
  }
}

module.exports = CallData
