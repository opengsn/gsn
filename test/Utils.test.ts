/* global describe it web3 */
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/camelcase
import { recoverTypedSignature_v4 } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData, { GsnRequestType } from '../src/common/EIP712/TypedRequestData'
import { expectEvent } from '@openzeppelin/test-helpers'
import { Eip712ForwarderInstance, TestRecipientInstance, TestUtilInstance } from '../types/truffle-contracts'
import { PrefixedHexString } from 'ethereumjs-tx'

const assert = require('chai').use(chaiAsPromised).assert

const TestUtil = artifacts.require('TestUtil')
const Eip712Forwarder = artifacts.require('Eip712Forwarder')
const TestRecipient = artifacts.require('TestRecipient')

contract('Utils', function (accounts) {
  describe('#getEip712Signature()', function () {
    // ganache always reports chainId as '1'
    const chainId = 1
    let forwarder: PrefixedHexString
    let relayRequest: RelayRequest
    const senderAddress = accounts[0]
    let testUtil: TestUtilInstance
    let recipient: TestRecipientInstance

    let forwarderInstance: Eip712ForwarderInstance
    before(async () => {
      forwarderInstance = await Eip712Forwarder.new()
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

      await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.extraParams,
        GsnRequestType.subTypes,
        GsnRequestType.subTypes2
      )

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
          forwarder,
          paymaster
        }
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
        relayRequest.request.nonce = (await forwarderInstance.getNonce(relayRequest.request.from)).toString()

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
