/* global describe it web3 */
// @ts-ignore
// eslint-disable-next-line @typescript-eslint/camelcase
import { recoverTypedSignature_v4 } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { defaultEnvironment } from '../src/relayclient/types/Environments'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import {extraDataWithDomain} from "../src/common/EIP712/ExtraData";
import {constants, expectRevert} from "@openzeppelin/test-helpers";
import {AddressZero} from "ethers/constants";

const assert = require('chai').use(chaiAsPromised).assert

const TestUtil = artifacts.require('TestUtil')
const Eip712Forwarder = artifacts.require('Eip712Forwarder')
const RelayHub = artifacts.require('RelayHub')
const TestRecipient = artifacts.require('TestRecipient')

contract('Utils', function (accounts) {
  describe('#getEip712Signature()', function () {
    it('should generate a valid EIP-712 compatible signature', async function () {

      const recipient = await TestRecipient.new()

      const chainId = defaultEnvironment.chainId
      const senderAddress = accounts[0]
      const senderNonce = '0'
      const target = recipient.address
      const encodedFunction = '0xdeadbeef'
      const pctRelayFee = '15'
      const baseRelayFee = '1000'
      const gasPrice = '10000000'
      const gasLimit = '500000'
      // const forwarder = accounts[6]
      const paymaster = accounts[7]
      const verifier = accounts[8]
      const relayWorker = accounts[9]

      const forwarder = (await Eip712Forwarder.new()).address
      await recipient.setTrustedForwarder(forwarder)

      const hub = await RelayHub.new(constants.ZERO_ADDRESS,constants.ZERO_ADDRESS)
      await hub.registerRequestType(forwarder)

      const relayRequest: RelayRequest = {
        request: {
          target,
          encodedFunction,
          senderAddress,
          senderNonce,
          gasLimit,
        },
        relayData: {
          relayWorker,
          paymaster
        },
        gasData: {
          gasPrice,
          pctRelayFee,
          baseRelayFee
        },
        extraData: extraDataWithDomain(forwarder, 999)
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

      const testUtil = await TestUtil.new()
      // const ret = await testUtil.splitRequest(relayRequest);
      // console.log( 'ret=', ret)

      //possible exceptions:
      //  "invalid request typehash" - missing register type with relayHub.registerRequestType(forwarder)
      //  "invalid nonce"
      // "signature mismatch" means the only problem is the signature.
      await testUtil.callForwarderVerify(relayRequest, sig)
    })
  })
})
