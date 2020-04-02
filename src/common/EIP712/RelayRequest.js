const ow = require('ow/dist/source/index')

const GasData = require('./GasData')
const RelayData = require('./RelayData')

class RelayRequest {
  constructor ({
    senderAddress,
    target,
    encodedFunction,
    gasPrice,
    gasLimit,
    baseRelayFee,
    pctRelayFee,
    senderNonce,
    relayWorker,
    paymaster
  }) {
    // TODO: define ow predicates for addresses, signatures etc.
    ow(senderAddress, ow.string)
    ow(target, ow.string)
    ow(encodedFunction, ow.string)
    ow(gasPrice, ow.string)
    ow(gasLimit, ow.string)
    ow(pctRelayFee, ow.string)
    ow(baseRelayFee, ow.string)
    ow(senderNonce, ow.string)
    ow(relayWorker, ow.string)
    ow(paymaster, ow.string)
    this.target = target
    this.encodedFunction = encodedFunction
    this.gasData =
      new GasData({
        gasLimit,
        gasPrice,
        pctRelayFee,
        baseRelayFee
      })
    this.relayData =
      new RelayData({
        senderAddress,
        senderNonce,
        relayWorker,
        paymaster
      })
  }

  clone () {
    return new RelayRequest({
      target: this.target,
      encodedFunction: this.encodedFunction,
      senderAddress: this.relayData.senderAddress,
      senderNonce: this.relayData.senderNonce,
      relayWorker: this.relayData.relayWorker,
      paymaster: this.relayData.paymaster,
      gasLimit: this.gasData.gasLimit,
      gasPrice: this.gasData.gasPrice,
      pctRelayFee: this.gasData.pctRelayFee,
      baseRelayFee: this.gasData.baseRelayFee
    })
  }
}

module.exports = RelayRequest
