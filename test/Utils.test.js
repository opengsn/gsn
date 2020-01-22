/* global describe it web3 */
const assert = require('chai').use(require('chai-as-promised')).assert
const sigUtil = require('eth-sig-util')

const getDataToSign = require('../src/js/relayclient/EIP712/Eip712Helper')
const Utils = require('../src/js/relayclient/utils')

const EIP712Sig = artifacts.require('./EIP712Sig.sol')

contract('Utils', async function (accounts) {
  describe('#getEip712Signature()', async function () {
    it('shuld generate a valid EIP-712 compatible signature', async function () {
      const senderAccount = accounts[0]
      const senderNonce = 5
      const target = accounts[5]
      const encodedFunction = '0xdeadbeef'
      const pctRelayFee = 15
      const gasPrice = 10000000
      const gasLimit = 500000
      const relayHub = accounts[8]
      const relayAddress = accounts[9]

      const sig = await Utils.getEip712Signature({
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
      const recoveredAccount = sigUtil.recoverTypedSignature_v4({
        data,
        sig: sig.result
      })
      assert.strictEqual(senderAccount.toLowerCase(), recoveredAccount.toLowerCase())

      const chainId = await web3.eth.net.getId()
      const eip712Sig = await EIP712Sig.new(relayHub, chainId)
      const signature = sig.result.substr(2)
      const r = '0x' + signature.slice(0, 64)
      const s = '0x' + signature.slice(64, 128)
      const v = '0x' + signature.slice(128, 130)
      const verify = await eip712Sig.verify(data.message, v, r, s, { from: senderAccount })
      assert.strictEqual(verify, true)
    })
  })
})
