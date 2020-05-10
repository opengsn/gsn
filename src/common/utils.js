const ethUtils = require('ethereumjs-util')
const web3Utils = require('web3-utils')

const { default: Common } = require('ethereumjs-common')

function removeHexPrefix (hex) {
  if (hex == null || typeof hex.replace !== 'function') {
    throw new Error('Cannot remove hex prefix')
  }
  return hex.replace(/^0x/, '')
}

const zeroPad = '0000000000000000000000000000000000000000000000000000000000000000'

function padTo64 (hex) {
  if (hex.length < 64) {
    hex = (zeroPad + hex).slice(-64)
  }
  return hex
}

module.exports = {

  getEip712Signature: async function (
    {
      rpcProvider,
      dataToSign,
      methodSuffix = '',
      jsonStringifyRequest = false
    }) {
    assert(rpcProvider != null, 'no provider')
    const senderAddress = dataToSign.message.relayData.senderAddress
    if (jsonStringifyRequest) {
      dataToSign = JSON.stringify(dataToSign)
    }
    return new Promise((resolve, reject) => {
      let method
      if (typeof rpcProvider.sendAsync === 'function') {
        method = rpcProvider.sendAsync
      } else {
        method = rpcProvider.send
        assert(typeof method === 'function', 'Invalid provider')
      }
      method.bind(rpcProvider)({
        method: 'eth_signTypedData' + methodSuffix,
        params: [senderAddress, dataToSign],
        from: senderAddress,
        id: Date.now()
      }, (err, res) => {
        if (err) {
          reject(err)
        } else {
          resolve(res.result)
        }
      })
    })
  },

  /**
   * @param gasLimits
   * @param hubOverhead
   * @param relayCallGasLimit
   * @param calldataSize
   * @param gtxdatanonzero
   * @returns maximum possible gas consumption by this relayed call
   */
  calculateTransactionMaxPossibleGas: function ({
    gasLimits,
    hubOverhead,
    relayCallGasLimit,
    calldataSize,
    gtxdatanonzero
  }) {
    return 21000 +
      hubOverhead +
      calldataSize * gtxdatanonzero +
      parseInt(relayCallGasLimit) +
      parseInt(gasLimits.acceptRelayedCallGasLimit) +
      parseInt(gasLimits.preRelayedCallGasLimit) +
      parseInt(gasLimits.postRelayedCallGasLimit)
  },

  getTransactionSignature: async function (web3, account, hash) {
    let sig_
    try {
      sig_ = await new Promise((resolve, reject) => {
        try {
          web3.eth.personal.sign(hash, account, (err, res) => {
            if (err) {
              reject(err)
            } else {
              resolve(res)
            }
          })
        } catch (e) {
          reject(e)
        }
      })
    } catch (e) {
      sig_ = await new Promise((resolve, reject) => {
        web3.eth.sign(hash, account, (err, res) => {
          if (err) {
            reject(err)
          } else {
            resolve(res)
          }
        })
      })
    }

    const signature = ethUtils.fromRpcSig(sig_)
    const sig = web3Utils.bytesToHex(signature.r) + removeHexPrefix(web3Utils.bytesToHex(signature.s)) + removeHexPrefix(web3Utils.toHex(signature.v))

    return sig
  },

  getTransactionSignatureWithKey: function (privKey, hash) {
    const signature = ethUtils.ecsign(hash, privKey)
    const sig = web3Utils.bytesToHex(signature.r) + removeHexPrefix(web3Utils.bytesToHex(signature.s)) + removeHexPrefix(web3Utils.toHex(signature.v))
    return sig
  },

  getEcRecoverMeta: function (message, signature) {
    if (typeof signature === 'string') {
      const r = this.parseHexString(signature.substr(2, 65))
      const s = this.parseHexString(signature.substr(66, 65))
      const v = this.parseHexString(signature.substr(130, 2))

      signature = {
        v: v,
        r: r,
        s: s
      }
    }
    const msg = Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n32'), Buffer.from(removeHexPrefix(message), 'hex')])
    const signed = web3Utils.sha3('0x' + msg.toString('hex'))
    const bufSigned = Buffer.from(removeHexPrefix(signed), 'hex')
    const signer = ethUtils.bufferToHex(ethUtils.pubToAddress(ethUtils.ecrecover(bufSigned, signature.v, signature.r, signature.s)))
    return signer
  },

  parseHexString: function (str) {
    var result = []
    while (str.length >= 2) {
      result.push(parseInt(str.substring(0, 2), 16))

      str = str.substring(2, str.length)
    }

    return result
  },
  removeHexPrefix: removeHexPrefix,
  padTo64: padTo64,

  isSameAddress: function (address1, address2) {
    return address1.toLowerCase() === address2.toLowerCase()
  },

  sleep: function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  /**
   * Ganache does not seem to enforce EIP-155 signature. Buidler does, though.
   * This is how {@link Transaction} constructor allows support for custom and private network.
   * @param chainId
   * @param networkId
   * @return {{common: Common}}
   */
  getRawTxOptions (chainId, networkId) {
    return {
      common: Common.forCustomChain(
        'mainnet',
        {
          chainId,
          networkId
        }, 'istanbul')
    }
  }
}
