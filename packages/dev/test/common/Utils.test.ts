/* global describe it web3 */
// @ts-ignore
import { SignTypedDataVersion, recoverTypedSignature, TypedDataUtils } from '@metamask/eth-sig-util'
import chaiAsPromised from 'chai-as-promised'
import chai, { expect } from 'chai'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

import {
  RelayRequest,
  constants,
  getEip712Signature,
  packRelayUrlForRegistrar,
  removeNullValues,
  splitRelayUrlForRegistrar,
  waitForSuccess
} from '@opengsn/common'

import {
  TypedRequestData,
  getDomainSeparatorHash,
  GsnDomainSeparatorType,
  GsnRequestType
} from '@opengsn/common/dist/EIP712/TypedRequestData'
import { expectEvent } from '@openzeppelin/test-helpers'
import { ForwarderInstance, TestRecipientInstance, TestUtilInstance } from '@opengsn/contracts/types/truffle-contracts'
import { bufferToHex, PrefixedHexString } from 'ethereumjs-util'
import { encodeRevertReason } from '../TestUtils'
import { DomainRegistered, RequestTypeRegistered } from '@opengsn/contracts/types/truffle-contracts/IForwarder'

import { toBN } from 'web3-utils'
import { defaultGsnConfig } from '@opengsn/provider'

const HashZero = constants.ZERO_BYTES32
const { assert } = chai.use(chaiAsPromised)

const TestUtil = artifacts.require('TestUtil')
const Forwarder = artifacts.require('Forwarder')
const TestRecipient = artifacts.require('TestRecipient')

contract('Utils', function (accounts) {
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const provider = new StaticJsonRpcProvider(currentProviderHost)

  describe('#getEip712Signature()', function () {
    // ganache always reports chainId as '1'
    let chainId: number
    let forwarder: PrefixedHexString
    let relayRequest: RelayRequest
    const senderAddress = accounts[0]
    let testUtil: TestUtilInstance
    let recipient: TestRecipientInstance

    let forwarderInstance: ForwarderInstance
    before(async () => {
      testUtil = await TestUtil.new()
      chainId = (await testUtil.libGetChainID()).toNumber()
      forwarderInstance = await Forwarder.new()
      forwarder = forwarderInstance.address
      recipient = await TestRecipient.new(forwarder)

      const senderNonce = '0'
      const target = recipient.address
      const encodedFunction = '0xdeadbeef'
      const maxFeePerGas = '10000000'
      const maxPriorityFeePerGas = '10000000'
      const gasLimit = '500000'
      // const forwarder = accounts[6]
      const paymaster = accounts[7]
      const relayWorker = accounts[9]
      const paymasterData = '0x'
      const clientId = '0'

      const res1 = await forwarderInstance.registerDomainSeparator(defaultGsnConfig.domainSeparatorName, GsnDomainSeparatorType.version)
      console.log(res1.logs[0])
      const { domainSeparator } = (res1.logs[0].args as DomainRegistered['args'])

      // sanity check: our locally-calculated domain-separator is the same as on-chain registered domain-separator
      assert.equal(domainSeparator, getDomainSeparatorHash(defaultGsnConfig.domainSeparatorName, forwarder, chainId))

      const res = await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )

      const typeName = (res.logs[0].args as RequestTypeRegistered['args']).typeStr

      relayRequest = {
        request: {
          to: target,
          data: encodedFunction,
          from: senderAddress,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit,
          validUntilTime: '0'
        },
        relayData: {
          maxFeePerGas,
          maxPriorityFeePerGas,
          transactionCalldataGasUsed: '0',
          relayWorker,
          forwarder,
          paymaster,
          paymasterData,
          clientId
        }
      }
      const dataToSign = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        chainId,
        forwarder,
        relayRequest
      )
      assert.equal(typeName, TypedDataUtils.encodeType(dataToSign.primaryType, dataToSign.types))
    })

    it('#_getEncoded should extract data exactly as local encoded data', async () => {
      // @ts-ignore
      const { typeHash, suffixData } = await testUtil.splitRequest(relayRequest)
      const getEncoded = await forwarderInstance._getEncoded(relayRequest.request, typeHash, suffixData)
      const dataToSign = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        chainId,
        forwarder,
        relayRequest
      )
      const localEncoded = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types, SignTypedDataVersion.V4))
      assert.equal(getEncoded, localEncoded)
    })

    it('library constants should match RelayHub eip712 constants', async function () {
      assert.equal(GsnRequestType.typeName, await testUtil.libRelayRequestName())
      assert.equal(GsnRequestType.typeSuffix, await testUtil.libRelayRequestSuffix())

      const res1 = await forwarderInstance.registerDomainSeparator(defaultGsnConfig.domainSeparatorName, GsnDomainSeparatorType.version)
      console.log(res1.logs[0])
      const { domainSeparator } = (res1.logs[0].args as DomainRegistered['args'])
      assert.equal(domainSeparator, await testUtil.libDomainSeparator(forwarder))

      const res = await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )
      const { typeStr, typeHash } = res.logs[0].args as RequestTypeRegistered['args']

      assert.equal(typeStr, await testUtil.libRelayRequestType())
      assert.equal(typeHash, await testUtil.libRelayRequestTypeHash())
    })

    it('should use same domainSeparator on-chain and off-chain', async () => {
      assert.equal(getDomainSeparatorHash(defaultGsnConfig.domainSeparatorName, forwarder, chainId), await testUtil.libDomainSeparator(forwarder))
    })

    it('should generate a valid EIP-712 compatible signature', async function () {
      const dataToSign = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        chainId,
        forwarder,
        relayRequest
      )

      const sig = await getEip712Signature(
        provider.getSigner(),
        dataToSign
      )

      const recoveredAccount = recoverTypedSignature({
        data: dataToSign,
        signature: sig,
        version: SignTypedDataVersion.V4
      })
      assert.strictEqual(senderAddress.toLowerCase(), recoveredAccount.toLowerCase())

      await testUtil.callForwarderVerify(relayRequest, sig)
    })

    describe('#callForwarderVerifyAndCall', () => {
      it('should return revert result', async function () {
        relayRequest.request.data = await recipient.contract.methods.testRevert().encodeABI()
        const sig = await getEip712Signature(
          provider.getSigner(),
          new TypedRequestData(
            defaultGsnConfig.domainSeparatorName,
            chainId,
            forwarder,
            relayRequest
          ))
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        const expectedReturnValue = encodeRevertReason('always fail')
        expectEvent(ret, 'Called', {
          success: false,
          error: expectedReturnValue
        })
      })
      it('should call target', async function () {
        relayRequest.request.data = await recipient.contract.methods.emitMessage('hello').encodeABI()
        relayRequest.request.nonce = (await forwarderInstance.getNonce(relayRequest.request.from)).toString()

        const sig = await getEip712Signature(
          provider.getSigner(),
          new TypedRequestData(
            defaultGsnConfig.domainSeparatorName,
            chainId,
            forwarder,
            relayRequest
          ))
        const ret = await testUtil.callForwarderVerifyAndCall(relayRequest, sig)
        expectEvent(ret, 'Called', {
          error: null
        })
        const logs = await recipient.contract.getPastEvents(null, { fromBlock: 1 })
        assert.equal(logs[0].event, 'SampleRecipientEmitted')
      })
    })
  })

  describe('#removeNullValues', function () {
    it('should remove nulls shallowly', async () => {
      expect(removeNullValues({
        a: 1,
        b: 'string',
        c: null,
        d: { e: null, f: 3 },
        arr: [10, null, 30],
        bn: toBN(123)
      })).to.deep
        .equal({ a: 1, b: 'string', d: { e: null, f: 3 }, arr: [10, null, 30], bn: toBN(123) })
    })
    it('should remove nulls recursively', async () => {
      expect(removeNullValues({
        a: 1,
        b: 'string',
        c: null,
        d: { e: null, f: 3 },
        arr: [10, null, 30],
        bn: toBN(123)
      }, true)).to.deep
        .equal({ a: 1, b: 'string', d: { f: 3 }, arr: [10, null, 30], bn: toBN(123) })
    })
  })

  describe('#splitRelayUrlForRegistrar() and #packRelayUrlForRegistrar()', function () {
    it('should separate and concatenate strings into reversible chunks', function () {
      expect(splitRelayUrlForRegistrar('1')).to.eql(['0x31'.padEnd(66, '0'), HashZero, HashZero])
      expect(splitRelayUrlForRegistrar('1'.repeat(32))).to.eql(['0x' + '31'.repeat(32), HashZero, HashZero])
      expect(splitRelayUrlForRegistrar('1'.repeat(33))).to.eql(['0x' + '31'.repeat(32), '0x31'.padEnd(66, '0'), HashZero])

      expect(packRelayUrlForRegistrar(splitRelayUrlForRegistrar('1'.repeat(33)))).to.eql('1'.repeat(33))

      const str = 'this is a long string to split. it should fit into several items. this should fit into 3 words'
      expect(packRelayUrlForRegistrar(splitRelayUrlForRegistrar(str))).to.eql(str)

      expect(packRelayUrlForRegistrar(splitRelayUrlForRegistrar('short string'))).to.eql('short string')
      expect(packRelayUrlForRegistrar(splitRelayUrlForRegistrar('1'))).to.eql('1')
    })

    it('should throw for strings that are too long', function () {
      expect(() => splitRelayUrlForRegistrar('1'.repeat(97))).to.throw('The URL does not fit to the RelayRegistrar. Please shorten it to less than 96 characters')
    })
  })

  describe('#waitForSuccess', function () {
    async function after (t: number): Promise<number> {
      await new Promise(resolve => setTimeout(resolve, t))
      return t
    }

    it('should return a single response', async () => {
      assert.deepEqual(await waitForSuccess([Promise.resolve(1)], [''], 100).then(r => r.results), [1])
    })

    it('should return a multiple responses if multiple responses resolve', async () => {
      assert.deepEqual(await waitForSuccess([Promise.resolve(1), Promise.resolve(2)], ['a', 'b'], 100).then(r => r.results), [1, 2])
      assert.deepEqual(await waitForSuccess([Promise.resolve(1), Promise.resolve(2)], ['a', 'b'], 100).then(r => r.results), [1, 2])
    })

    it('should reject with first error if all fail', async () => {
      const ret = await waitForSuccess([Promise.reject(Error('err1')), Promise.reject(Error('err2'))], ['one', 'two'], 100)
      assert.deepEqual(ret.results, [])
      assert.equal(ret.errors.get('one')!.message, 'err1')
    })

    it('should resolve immediately (without grace) if all promises are done', async () => {
      const now = Date.now()
      await waitForSuccess(
        [Promise.reject(Error('err1')), after(50), after(20)],
        ['a', 'b', 'c'],
        2000)

      assert.closeTo(Date.now() - now, 50, 200, 'should not wait entire 2000 grace time if all are completed')
    })

    it('should ignore rejection if at least one response is successful', async () => {
      const res = await waitForSuccess(
        [Promise.reject(Error('err1')), after(50), after(1000)],
        ['a', 'b', 'c'],
        200)
      assert.deepEqual(res.results, [50])
    })

    it('should wait after first response', async () => {
      const res1 = await waitForSuccess(
        [after(1), after(50), after(1000)],
        ['a', 'b', 'c'],
        200
      )
      assert.deepEqual(res1.results, [1, 50])
    })

    it('should throw if input has duplicate keys', async function () {
      await expect(
        waitForSuccess(
          [after(1), after(50), after(1000)],
          ['a', 'b', 'a'],
          200)
      ).to.be.eventually.rejectedWith('waitForSuccess: duplicate relay URL keys, aborting')
    })
  })
})
