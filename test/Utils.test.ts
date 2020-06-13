/* global describe it web3 */
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/camelcase
import { recoverTypedSignature_v4, TypedDataUtils } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { defaultEnvironment } from '../src/relayclient/types/Environments'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import { extraDataWithDomain } from '../src/common/EIP712/ExtraData'
import { constants, expectEvent } from '@openzeppelin/test-helpers'
import { bufferToHex } from 'ethereumjs-util'
import { TestRecipientInstance, TestUtilInstance } from '../types/truffle-contracts'
import { PrefixedHexString } from 'ethereumjs-tx'

const assert = require('chai').use(chaiAsPromised).assert

const TestUtil = artifacts.require('TestUtil')
const Eip712Forwarder = artifacts.require('Eip712Forwarder')
const RelayHub = artifacts.require('RelayHub')
const TestRecipient = artifacts.require('TestRecipient')

contract('Utils', function (accounts) {
  describe('#getEip712Signature()', function () {
    const chainId = defaultEnvironment.chainId
    let forwarder: PrefixedHexString
    let relayRequest: RelayRequest
    const senderAddress = accounts[0]
    let testUtil: TestUtilInstance
    let recipient: TestRecipientInstance

    before(async () => {
      const forwarderInstance = await Eip712Forwarder.new()
      forwarder = forwarderInstance.address
      recipient = await TestRecipient.new(forwarder)

      const senderNonce = '0'
      const target = recipient.address
      const encodedFunction = '0xdeadbeef'
      const pctRelayFee = '15'
      const baseRelayFee = '1000'
      const gasPrice = '10000000'
      const gasLimit = '500000'
      // const forwarder = accounts[6]
      const paymaster = accounts[7]
      const relayWorker = accounts[9]

      const hub = await RelayHub.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS)
      await hub.registerRequestType(forwarder)

      relayRequest = {
        request: {
          to: target,
          data: encodedFunction,
          from: senderAddress,
          nonce: senderNonce,
          gas: gasLimit
        },
        relayData: {
          gasPrice,
          pctRelayFee,
          baseRelayFee,
          relayWorker,
          paymaster
        },
        extraData: extraDataWithDomain(forwarder, 999)
      }
      testUtil = await TestUtil.new()
    })
    it('should generate a valid EIP-712 compatible signature', async function () {
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
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

      // perform the on-chain logic to calculate signature:
      const ret: any = await testUtil.splitRequest(relayRequest)
      // console.log( 'ret=', ret)
      // const {fwd, domainSeparator, typeHash, suffixData} = ret
      // const encodedForSig = await forwarderInstance._getEncoded(fwd, typeHash, suffixData)
      // console.log( {
      //   fwd,domainSeparator,typeHash, suffixData, encodedForSig
      // })

      // verify we calculated locally the same domainSeparator we pass to the forwarder:
      assert.equal(ret.domainSeparator, bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', dataToSign.domain, dataToSign.types)))

      // const digest = keccak256(bufferToHex(Buffer.concat([
      //   Buffer.from("\x19\x01"), domainSeparator, keccak256(encodedForSig)
      // ].map(toBuffer))))

      // possible exceptions:
      //  "invalid request typehash" - missing register type with relayHub.registerRequestType(forwarder)
      //  "invalid nonce"
      // "signature mismatch" signature error - wrong signer/domain/struct
      await testUtil.callForwarderVerify(relayRequest, sig)
    })

    describe('#callForwarderVerifyAndCall', () => {
      it('should return revert result', async function () {
        relayRequest.request.data = await recipient.contract.methods.testRevert().encodeABI()
        const sig = await getEip712Signature(
          web3, new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ))
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)

        expectEvent(ret, 'Called', {
          success: false,
          error: 'always fail'
        })
      })
      it('should return revert', async function () {
        relayRequest.request.data = await recipient.contract.methods.emitMessage('hello').encodeABI()

        const sig = await getEip712Signature(
          web3, new TypedRequestData(
            chainId,
            forwarder,
            relayRequest
          ))
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        expectEvent(ret, 'Called', {
          success: true,
          error: ''
        })
        const logs = await recipient.contract.getPastEvents(null, { fromBlock: 1 })
        assert.equal(logs[0].event, 'SampleRecipientEmitted')
      })
    })
  })
})
