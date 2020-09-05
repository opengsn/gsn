/* global describe it web3 */
// @ts-ignore
import { recoverTypedSignature_v4, TypedDataUtils } from 'eth-sig-util'
import chaiAsPromised from 'chai-as-promised'
import chai from 'chai'
import { HttpProvider } from 'web3-core'

import RelayRequest from '../src/common/EIP712/RelayRequest'
import { getEip712Signature } from '../src/common/Utils'
import TypedRequestData, {
  getDomainSeparatorHash, getRegisterDomainSeparatorData,
  GsnRequestType
} from '../src/common/EIP712/TypedRequestData'
import { expectEvent } from '@openzeppelin/test-helpers'
import { ForwarderInstance, TestRecipientInstance, TestUtilInstance } from '../types/truffle-contracts'
import { PrefixedHexString } from 'ethereumjs-tx'
import { bufferToHex } from 'ethereumjs-util'
import { encodeRevertReason } from './TestUtils'
import CommandsLogic from '../src/cli/CommandsLogic'
import { configureGSN, GSNConfig, resolveConfigurationGSN } from '../src/relayclient/GSNConfigurator'
import { defaultEnvironment } from '../src/common/Environments'
require('source-map-support').install({ errorFormatterForce: true })

const { expect, assert } = chai.use(chaiAsPromised)

const TestUtil = artifacts.require('TestUtil')
const Forwarder = artifacts.require('Forwarder')
const TestRecipient = artifacts.require('TestRecipient')

contract('Utils', function (accounts) {
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
      const pctRelayFee = '15'
      const baseRelayFee = '1000'
      const gasPrice = '10000000'
      const gasLimit = '500000'
      // const forwarder = accounts[6]
      const paymaster = accounts[7]
      const relayWorker = accounts[9]
      const paymasterData = '0x'
      const clientId = '0'

      const { prefix, dataPrefix } = getRegisterDomainSeparatorData()
      const res1 = await forwarderInstance.registerDomainSeparator(prefix, dataPrefix)
      console.log(res1.logs[0])
      const { domainSeparator } = res1.logs[0].args

      // sanity check: our locally-calculated domain-separator is the same as on-chain registered domain-separator
      assert.equal(domainSeparator, getDomainSeparatorHash(forwarder, chainId))

      const res = await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )

      const typeName = res.logs[0].args.typeStr

      relayRequest = {
        request: {
          to: target,
          data: encodedFunction,
          from: senderAddress,
          nonce: senderNonce,
          value: '0',
          gas: gasLimit
        },
        relayData: {
          gasPrice,
          pctRelayFee,
          baseRelayFee,
          relayWorker,
          forwarder,
          paymaster,
          paymasterData,
          clientId
        }
      }
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequest
      )
      assert.equal(typeName, TypedDataUtils.encodeType(dataToSign.primaryType, dataToSign.types))
    })

    it('#_getEncoded should extract data exactly as local encoded data', async () => {
      // @ts-ignore
      const { forwardRequest, typeHash, suffixData } = await testUtil.splitRequest(relayRequest)
      const getEncoded = await forwarderInstance._getEncoded(forwardRequest, typeHash, suffixData)
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequest
      )
      const localEncoded = bufferToHex(TypedDataUtils.encodeData(dataToSign.primaryType, dataToSign.message, dataToSign.types))
      assert.equal(getEncoded, localEncoded)
    })

    it('library constants should match RelayHub eip712 constants', async function () {
      assert.equal(GsnRequestType.typeName, await testUtil.libRelayRequestName())
      assert.equal(GsnRequestType.typeSuffix, await testUtil.libRelayRequestSuffix())

      const { prefix, dataPrefix } = getRegisterDomainSeparatorData()
      const res1 = await forwarderInstance.registerDomainSeparator(prefix, dataPrefix)
      console.log(res1.logs[0])
      const { domainSeparator } = res1.logs[0].args
      assert.equal(domainSeparator, await testUtil.libDomainSeparator(forwarder))

      const res = await forwarderInstance.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )
      const { typeStr, typeHash } = res.logs[0].args

      assert.equal(typeStr, await testUtil.libRelayRequestType())
      assert.equal(typeHash, await testUtil.libRelayRequestTypeHash())
    })

    it('should use same domainSeparator on-chain and off-chain', async () => {
      assert.equal(getDomainSeparatorHash(forwarder, chainId), await testUtil.libDomainSeparator(forwarder))
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
          web3, new TypedRequestData(
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

  describe('#resolveGSNDeploymentFromPaymaster()', function () {
    it('should resolve the deployment from paymaster', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const defaultConfiguration = configureGSN({})
      const commandsLogic = new CommandsLogic(host, defaultConfiguration)
      const deploymentResult = await commandsLogic.deployGsnContracts({
        from: accounts[0],
        gasPrice: '1',
        deployPaymaster: true,
        skipConfirmation: true,
        relayHubConfiguration: defaultEnvironment.relayHubConfiguration
      })
      const minGasPrice = 777
      const partialConfig: Partial<GSNConfig> = {
        paymasterAddress: deploymentResult.naivePaymasterAddress,
        minGasPrice
      }
      const resolvedPartialConfig = await resolveConfigurationGSN(web3.currentProvider, partialConfig)
      assert.equal(resolvedPartialConfig.paymasterAddress, deploymentResult.naivePaymasterAddress)
      assert.equal(resolvedPartialConfig.relayHubAddress, deploymentResult.relayHubAddress)
      assert.equal(resolvedPartialConfig.minGasPrice, minGasPrice, 'Input value lost')
      assert.equal(resolvedPartialConfig.sliceSize, defaultConfiguration.sliceSize, 'Unexpected value appeared')
    })

    it('should throw if no paymaster at address', async function () {
      await expect(resolveConfigurationGSN(
        web3.currentProvider, {})
      ).to.be.eventually.rejectedWith('Cannot resolve GSN deployment without paymaster address')
    })
  })
})
