const ethUtils = require('ethereumjs-util')
const EthCrypto = require('eth-crypto')
const web3Utils = require('web3-utils')

const getDataToSign = require('./EIP712/Eip712Helper')

const relayPrefix = 'rlx:'

function toUint256NoPrefix (int) {
  return removeHexPrefix(ethUtils.bufferToHex(ethUtils.setLengthLeft(int, 32)))
}

function removeHexPrefix (hex) {
  return hex.replace(/^0x/, '')
}

const zeroPad = '0000000000000000000000000000000000000000000000000000000000000000'

function padTo64 (hex) {
  if (hex.length < 64) {
    hex = (zeroPad + hex).slice(-64)
  }
  return hex
}

function bytesToHexNoPrefix (bytes) {
  let hex = removeHexPrefix(web3Utils.toHex(bytes))
  if (hex.length % 2 !== 0) {
    hex = '0' + hex
  }
  return hex
}

module.exports = {
  register_new_relay: async function (relayHub, stake, delay, txFee, url, account) {
    await relayHub.stake(account, delay, { from: account, value: stake })
    return relayHub.registerRelay(txFee, url, { from: account })
  },

  getEip712Signature: async function (
    {
      web3,
      methodAppendix: methodSuffix = '',
      senderAccount,
      senderNonce,
      target,
      encodedFunction,
      pctRelayFee,
      gasPrice,
      gasLimit,
      relayHub,
      relayAddress
    }) {
    const data = await getDataToSign({
      web3,
      senderAccount,
      senderNonce,
      target,
      encodedFunction,
      pctRelayFee,
      gasPrice,
      gasLimit,
      relayHub,
      relayAddress
    })
    return new Promise((resolve, reject) => {
      web3.currentProvider.send({
        method: 'eth_signTypedData' + methodSuffix,
        params: [senderAccount, data],
        from: senderAccount
      }, (err, res) => {
        if (err) {
          reject(err)
        } else {
          resolve(res)
        }
      })
    })
  },

  getTransactionHash: function (from, to, tx, txfee, gasPrice, gasLimit, nonce, relayHubAddress, relayAddress) {
    const txhstr = bytesToHexNoPrefix(tx)
    const dataToHash =
            Buffer.from(relayPrefix).toString('hex') +
            removeHexPrefix(from) +
            removeHexPrefix(to) +
            txhstr +
            toUint256NoPrefix(parseInt(txfee)) +
            toUint256NoPrefix(parseInt(gasPrice)) +
            toUint256NoPrefix(parseInt(gasLimit)) +
            toUint256NoPrefix(parseInt(nonce)) +
            removeHexPrefix(relayHubAddress) +
            removeHexPrefix(relayAddress)
    return web3Utils.sha3('0x' + dataToHash)
  },

  getTransactionSignature: async function (web3, account, hash) {
    let sig_
    try {
      sig_ = await new Promise((resolve, reject) => {
        try {
          web3.eth.personal.sign(hash, account, (err, res) => {
            if (err) reject(err)
            else resolve(res)
          })
        } catch (e) {
          reject(e)
        }
      })
    } catch (e) {
      sig_ = await new Promise((resolve, reject) => {
        web3.eth.sign(hash, account, (err, res) => {
          if (err) reject(err)
          else resolve(res)
        })
      })
    }

    const signature = ethUtils.fromRpcSig(sig_)
    const sig = web3Utils.bytesToHex(signature.r) + removeHexPrefix(web3Utils.bytesToHex(signature.s)) + removeHexPrefix(web3Utils.toHex(signature.v))

    return sig
  },

  getTransactionSignatureWithKey: function (privKey, hash, withPrefix = true) {
    let signed
    if (withPrefix) {
      const msg = Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n32'), Buffer.from(removeHexPrefix(hash), 'hex')])
      signed = web3Utils.sha3('0x' + msg.toString('hex'))
    } else { signed = hash }
    const keyHex = '0x' + Buffer.from(privKey).toString('hex')
    const sig_ = EthCrypto.sign(keyHex, signed)
    const signature = ethUtils.fromRpcSig(sig_)
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
  }
}
