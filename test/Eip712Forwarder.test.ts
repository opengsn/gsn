import { Eip712ForwarderInstance, TestRecipientInstance } from '../types/truffle-contracts'
// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { expectRevert } from '@openzeppelin/test-helpers'
import { toBN, toChecksumAddress } from 'web3-utils'

const TestRecipient = artifacts.require('TestRecipient')

const Eip712Forwarder = artifacts.require('Eip712Forwarder')

const keccak256 = web3.utils.keccak256

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64)
}

interface RegisterTypeParams {
  name: string
  extraParams: string
  subTypes: string
  subTypes2: string
}

// Global EIP712 type definitions.
// (read from helper package?)
const EIP712DomainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  // { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const ForwardRequestType = [
  { name: 'target', type: 'address' },
  { name: 'encodedFunction', type: 'bytes' },
  { name: 'senderAddress', type: 'address' },
  { name: 'senderNonce', type: 'uint256' },
  { name: 'gasLimit', type: 'uint256' }
]

// helper function:
//  given a complete EIP712TypedData, validate it extends the ForwardRequest type,
//  and extract the strings required for registering this type.
function getRegisterParams (data: EIP712TypedData, genericParams: string, genericType: string): RegisterTypeParams {
  // before placing the string into a regex, we need to escape special chars
  function escaped (s: string): string {
    return s.replace(/([()])/g, '\\$1')
  }

  const type = TypedDataUtils.encodeType(data.primaryType, data.types)
  const m = new RegExp(`(\\w+)\\(${genericParams}(?:,(.+))?\\)(.*)${escaped(genericType)}(.*)`).exec(type)
  if (m == null) { throw new Error(`type "${type}" doesn't contain "${genericParams}" or "${genericType}"`) }

  const [, name, extraParams, subTypes, subTypes2] = m
  return {
    name, extraParams, subTypes, subTypes2
  }
}

contract('Eip712Forwarder', () => {

  const GENERIC_PARAMS = '_ForwardRequest request'
  const GENERIC_TYPE = '_ForwardRequest(address target,bytes encodedFunction,address senderAddress,uint256 senderNonce,uint256 gasLimit)'

  let fwd: Eip712ForwarderInstance

  const senderPrivateKey = toBuffer(bytes32(1))
  const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

  before(async () => {
    fwd = await Eip712Forwarder.new()
    assert.equal(await fwd.GENERIC_PARAMS(), GENERIC_PARAMS)
    assert.equal(await fwd.GENERIC_TYPE(), GENERIC_TYPE)
  })

  describe('#registerRequestType', () => {
    it('should fail to register without a name', async () => {
      await expectRevert(fwd.registerRequestType('', '', '', ''), 'invalid typeName')
    })

    it('should fail with invalid subtype', async () => {
      await expectRevert(fwd.registerRequestType('asd', '', 'subtype', ''), 'invalid subType')
    })

    it('should accept type with no extra params', async () => {
      const ret = await fwd.registerRequestType('test1', '', '', '')
      const { typeStr, typeHash } = ret.logs[0].args
      assert.equal(typeStr, `test1(${GENERIC_PARAMS})${GENERIC_TYPE}`)
      assert.equal(typeHash, keccak256(typeStr))
    })

    it('should accept extension field', async () => {
      const ret = await fwd.registerRequestType('test2', 'SubType extra,subType extra2', 'SubType(uint a)', 'subType2(uint b)')
      const { typeStr, typeHash } = ret.logs[0].args
      assert.equal(typeStr, `test2(${GENERIC_PARAMS},SubType extra,subType extra2)SubType(uint a)${GENERIC_TYPE}subType2(uint b)`)
      assert.equal(typeHash, keccak256(typeStr))
    })

    it('should reject repeated registration', async () => {
      await fwd.registerRequestType('test3', '', '', '')
      expectRevert(fwd.registerRequestType('test3', '', '', ''), 'revert typehash already registered')
    })
  })

  describe('#isRegisteredTypehash', () => {
    const fullType = `test4(${GENERIC_PARAMS})${GENERIC_TYPE}`
    const hash = keccak256(fullType)
    it('should return false before registration', async () => {
      assert.equal(await fwd.isRegisteredTypehash(hash), false)
    })
    it('should return true after registration', async () => {
      await fwd.registerRequestType('test4', '', '', '')
      assert.equal(true, await fwd.isRegisteredTypehash(hash))
    })
  })

  describe('#verify', () => {
    let typeName: string
    let typeHash: string
    before(async () => {
      typeName = `TestVerify(${GENERIC_PARAMS})${GENERIC_TYPE}`
      typeHash = web3.utils.keccak256(typeName)
      await fwd.registerRequestType('TestVerify', '', '', '')
    })

    describe('#verify failures', () => {
      const dummyDomainSeparator = bytes32(1)

      const req = {
        target: addr(1),
        encodedFunction: '0x',
        senderAddress,
        senderNonce: 0,
        gasLimit: 123,
        forwarder: addr(3)
      }

      it('should fail on wrong nonce', async () => {
        await expectRevert(fwd.verify({
          ...req,
          senderNonce: 123
        }, dummyDomainSeparator, typeHash, '0x', '0x'), 'revert nonce mismatch')
      })
      it('should fail on invalid signature', async () => {
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x'), 'invalid signature length')
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x123456'), 'invalid signature length')
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x' + '1b'.repeat(65)), 'signature mismatch')
      })
    })
    describe('#verify success', () => {
      const TestVerifyType = [
        { name: 'request', type: '_ForwardRequest' }
      ]

      const req = {
        request: {
          target: addr(1),
          encodedFunction: '0x',
          senderAddress,
          senderNonce: 0,
          gasLimit: 123
        }
      }

      let data: EIP712TypedData

      before(() => {
        data = {
          domain: {
            name: 'Test Domain',
            version: '1',
            verifyingContract: fwd.address
          },
          primaryType: 'TestVerify',
          types: {
            EIP712Domain: EIP712DomainType,
            TestVerify: TestVerifyType,
            _ForwardRequest: ForwardRequestType
          },
          message: req
        }
        // sanity: verify that we calculated the type locally just like eth-utils:
        const calcType = TypedDataUtils.encodeType('TestVerify', data.types)
        assert.equal(calcType, typeName)
        const calcTypeHash = bufferToHex(TypedDataUtils.hashType('TestVerify', data.types))
        assert.equal(calcTypeHash, typeHash)
      })

      it('should verify valid signature', async () => {
        const sig = signTypedData_v4(senderPrivateKey, { data })
        const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

        await fwd.verify(req.request, bufferToHex(domainSeparator), typeHash, '0x', sig)
      })

      it('should verify valid signature of extended type', async () => {
        const ExtendedMessageType = [
          { name: 'request', type: '_ForwardRequest' },
          { name: 'extraAddress', type: 'address' } // <--extension
        ]

        const ForwardRequestType = [
          { name: 'target', type: 'address' },
          { name: 'encodedFunction', type: 'bytes' },
          { name: 'senderAddress', type: 'address' },
          { name: 'senderNonce', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' }
        ]

        const extendedReq = {
          request: {
            target: addr(1),
            encodedFunction: '0x',
            senderAddress,
            senderNonce: 0,
            gasLimit: 123
          },
          extraAddress: addr(5) // <-- extension
        }

        // we create extended data message
        const extendedData = {
          domain: data.domain,
          primaryType: 'ExtendedMessage',
          types: {
            EIP712Domain: EIP712DomainType,
            ExtendedMessage: ExtendedMessageType,
            _ForwardRequest: ForwardRequestType
          },
          message: extendedReq
        }

        const { name, extraParams, subTypes, subTypes2 } = getRegisterParams(extendedData, GENERIC_PARAMS, GENERIC_TYPE)
        const { logs } = await fwd.registerRequestType(name, extraParams, subTypes, subTypes2)
        const { typeHash } = logs[0].args
        const sig = signTypedData(senderPrivateKey, { data: extendedData })

        // same calculation of domainSeparator as with base (no-extension)
        const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', extendedData.domain, extendedData.types)

        // encode entire struct, to extract "suffixData" from it
        const encoded = TypedDataUtils.encodeData(extendedData.primaryType, extendedData.message, extendedData.types)
        // when encoding an Extended message, there is 32-byte "typehash", 32-byte hash of ForwardRequest, so suffixData starts after 64 bytes:
        const suffixData = bufferToHex(encoded.slice(64))

        await fwd.verify(extendedReq.request, bufferToHex(domainSeparator), typeHash, suffixData, sig)
      })
    })
  })

  describe('#verifyAndCall', () => {
    const TestCallType = [
      { name: 'request', type: '_ForwardRequest' }
    ]

    let data: EIP712TypedData
    let typeName: string
    let typeHash: string
    let recipient: TestRecipientInstance
    let domainSeparator: string

    before(async () => {
      typeName = `TestCall(${GENERIC_PARAMS})${GENERIC_TYPE}`
      typeHash = web3.utils.keccak256(typeName)
      await fwd.registerRequestType('TestCall', '', '', '')
      data = {
        domain: {
          name: 'Test Domain',
          version: '1',
          verifyingContract: fwd.address
        },
        primaryType: 'TestCall',
        types: {
          EIP712Domain: EIP712DomainType,
          TestCall: TestCallType,
          _ForwardRequest: ForwardRequestType
        },
        message: {}
      }
      // sanity: verify that we calculated the type locally just like eth-utils:
      const calcType = TypedDataUtils.encodeType('TestCall', data.types)
      assert.equal(calcType, typeName)
      const calcTypeHash = bufferToHex(TypedDataUtils.hashType('TestCall', data.types))
      assert.equal(calcTypeHash, typeHash)
      recipient = await TestRecipient.new()
      await recipient.setTrustedForwarder(fwd.address)
      domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
    })

    it('should call function', async () => {
      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      // const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        request: {
          target: recipient.address,
          encodedFunction: func,
          senderAddress,
          senderNonce: 0,
          gasLimit: 1e6
        }
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })
      const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

      await fwd.verifyAndCall(req1.request, bufferToHex(domainSeparator), typeHash, '0x', sig)
      // @ts-ignore
      const logs = await recipient.getPastEvents('SampleRecipientEmitted')
      assert.equal(logs.length, 1, 'TestRecipien should emit')
      assert.equal(logs[0].args.realSender, senderAddress, 'TestRecipient should "see" real sender of meta-tx')
      assert.equal('1', (await fwd.getNonce(senderAddress)).toString(), 'verifyAndCall should increment nonce')
    })

    it('should revert with same reason as target method', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        request: {
          target: recipient.address,
          encodedFunction: func,
          senderAddress,
          senderNonce: (await fwd.getNonce(senderAddress)).toString(),
          gasLimit: 1e6
        }
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      await expectRevert(fwd.verifyAndCall(req1.request, domainSeparator, typeHash, '0x', sig), 'always fail')
    })
  })
})
