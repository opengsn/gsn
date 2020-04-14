const RelayRequest = require('../src/common/EIP712/RelayRequest')

const getDataToSign = require('../src/common/EIP712/Eip712Helper')
const utils = require('../src/common/utils')
const getEip712Signature = utils.getEip712Signature

class TmpLegacyRelayClient {
  constructor (web3) {
    this.web3 = web3
  }

  async _prepareRelayHttpRequest (
    encodedFunction,
    relayWorker,
    pctRelayFee,
    baseRelayFee,
    gasPrice,
    gasLimit,
    senderNonce,
    paymaster,
    relayHub,
    forwarder,
    options) {
    const relayRequest = new RelayRequest({
      senderAddress: options.from,
      target: options.to,
      encodedFunction,
      senderNonce: senderNonce.toString(),
      pctRelayFee: pctRelayFee.toString(),
      baseRelayFee: baseRelayFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      paymaster,
      relayWorker
    })
    const signature = await this._prepareSignature(relayHub, relayRequest, options, forwarder._address)
    let approvalData = options.approvalData || '0x'
    if (typeof options.approveFunction === 'function') {
      approvalData = '0x' + await options.approveFunction({
        from: options.from,
        to: options.to,
        encodedFunctionCall: encodedFunction,
        pctRelayFee: options.pctRelayFee,
        gas_price: gasPrice,
        gas_limit: gasLimit,
        nonce: senderNonce,
        relay_hub_address: relayHub._address,
        relay_address: relayWorker
      })
    }
    // max nonce is not signed, as contracts cannot access addresses' nonces.
    const allowedRelayNonceGap = 3
    const relayMaxNonce = (await this.web3.eth.getTransactionCount(relayWorker)) + allowedRelayNonceGap
    return {
      relayRequest,
      relayMaxNonce,
      approvalData,
      signature
    }
  }

  async _prepareSignature (relayHub, relayRequest, options, forwarderAddress) {
    if (this.web3.eth.getChainId === undefined) {
      throw new Error(`getChainId is undefined. Web3 version is ${this.web3.version}, minimum required is 1.2.2`)
    }
    const chainId = await this.web3.eth.getChainId()
    const signedData = await getDataToSign({
      chainId,
      verifier: forwarderAddress,
      relayRequest
    })
    return getEip712Signature(
      {
        web3: this.web3,
        methodSuffix: options.methodSuffix || '',
        jsonStringifyRequest: options.jsonStringifyRequest || false,
        dataToSign: signedData
      })
  }
}

module.exports = TmpLegacyRelayClient
