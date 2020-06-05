/* global describe it web3 */
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/camelcase
import { recoverTypedSignature_v4 } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { defaultEnvironment } from '../src/relayclient/types/Environments'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'

const assert = require('chai').use(chaiAsPromised).assert

const SignatureVerifier = artifacts.require('./SignatureVerifier.sol')

contract('Utils', function (accounts) {
  describe('#getEip712Signature()', function () {
    it('should generate a valid EIP-712 compatible signature', async function () {
      const chainId = defaultEnvironment.chainId
      const senderAddress = accounts[0]
      const senderNonce = '5'
      const target = accounts[5]
      const encodedFunction = '0xdeadbeef'
      const pctRelayFee = '15'
      const baseRelayFee = '1000'
      const gasPrice = '10000000'
      const gasLimit = '500000'
      const forwarder = accounts[6]
      const paymaster = accounts[7]
      const verifier = accounts[8]
      const relayWorker = accounts[9]

      const relayRequest: RelayRequest = {
        target,
        encodedFunction,
        senderAddress,
        senderNonce,
        gasLimit,
        forwarder,
        relayData: {
          relayWorker,
          paymaster
        },
        gasData: {
          gasPrice,
          pctRelayFee,
          baseRelayFee
        }
      }

      const dataToSign = new TypedRequestData(
        chainId,
        verifier,
        relayRequest
      )
      const sig = await getEip712Signature(
        web3,
        dataToSign
      )

      const recoveredAccount = recoverTypedSignature_v4({
        data: dataToSign,
        sig
      })
      assert.strictEqual(senderAddress.toLowerCase(), recoveredAccount.toLowerCase())

      const signatureVerifier = await SignatureVerifier.new(verifier)
      const verify = await signatureVerifier.verify(dataToSign.message, sig, { from: senderAddress })
      assert.strictEqual(verify, true)
    })
  })
})
