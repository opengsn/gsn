import {
  Eip712ForwarderInstance,
  TestEip712ForwarderInstance,
  TestForwarderTargetInstance
} from '../types/truffle-contracts'
// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import {ether, expectRevert} from '@openzeppelin/test-helpers'
import { toChecksumAddress } from 'web3-utils'
import Web3 from 'web3'

const TestForwarderTarget = artifacts.require('TestForwarderTarget')

const Eip712Forwarder = artifacts.require('Eip712Forwarder')
const TestEip712Forwarder = artifacts.require('TestEip712Forwarder')

const keccak256 = web3.utils.keccak256

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64)
}

interface RegisterTypeParams {
  typeName: string
  typeSuffix: string
}

// Global EIP712 type definitions.
// (read from helper package?)
const EIP712DomainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const ForwardRequestType = [
  {name: 'to', type: 'address'},
  {name: 'data', type: 'bytes'},
  {name: 'value', type: 'uint256'},
  {name: 'from', type: 'address'},
  {name: 'nonce', type: 'uint256'},
  {name: 'gas', type: 'uint256'}
]

// helper function:
//  given a complete EIP712TypedData, validate it extends the ForwardRequest type,
//  and extract the strings required for registering this type.
function getRegisterParams (data: EIP712TypedData, genericParams: string): RegisterTypeParams {
  const typeName = data.primaryType
  const type = TypedDataUtils.encodeType(typeName, data.types)
  const prefix = typeName + '(' + genericParams
  if (type.indexOf(prefix) != 0) {
    throw new Error(`type "${type}" doesn't start with  "${genericParams}"`)
  }

  let typeSuffix = type.slice(prefix.length)
  if (typeSuffix == ')') { typeSuffix = '' } else {
    // remove leading ","
    typeSuffix = typeSuffix.slice(1)
  }
  return { typeName, typeSuffix }
}

contract('Eip712Forwarder', ([from]) => {
  const GENERIC_PARAMS = 'address to,bytes data,uint256 value,address from,uint256 nonce,uint256 gas'
  // our generic params has 6 bytes32 values
  const count_params = 6

  let fwd: Eip712ForwarderInstance

  const senderPrivateKey = toBuffer(bytes32(1))
  const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

  let chainId: number
  before(async () => {
    chainId = await new Web3(web3.currentProvider).eth.getChainId()
    fwd = await Eip712Forwarder.new()
    assert.equal(await fwd.GENERIC_PARAMS(), GENERIC_PARAMS)
  })

  describe('#registerRequestType', () => {
    it('should fail to register with invalid name', async () => {
      // this is an example of a typename that attempt to add a new field at the beginning.
      await expectRevert(fwd.registerRequestType('asd(uint a,Request asd)Request(', ')'), 'invalid typename')
    })

    it('should have a registered default type with no extra params', async () => {
      const logs = await fwd.contract.getPastEvents('RequestTypeRegistered', {fromBlock:1});
      assert.equal(logs[0].returnValues.typeStr, `ForwardRequest(${GENERIC_PARAMS})` )
    })

    it('should accept extension field', async () => {
      const ret = await fwd.registerRequestType('test2', 'bool extra)')
      const { typeStr, typeHash } = ret.logs[0].args
      assert.equal(typeStr, `test2(${GENERIC_PARAMS},bool extra)`)
      assert.equal(typeHash, keccak256(typeStr))
    })

    it('should allow silently repeated registration', async () => {
      await fwd.registerRequestType('test3', '')
      await fwd.registerRequestType('test3', '')
    })
  })

  describe('registered typehash', () => {
    const fullType = `test4(${GENERIC_PARAMS},bool extra)`
    const hash = keccak256(fullType)
    it('should return false before registration', async () => {
      assert.equal(await fwd.typeHashes(hash), false)
    })
    it('should return true after registration', async () => {
      const res = await fwd.registerRequestType('test4', 'bool extra)')
      assert.equal(res.logs[0].args.typeStr, fullType)
      assert.equal(res.logs[0].args.typeHash, hash)
      assert.equal(true, await fwd.typeHashes(hash))
    })
  })

  describe('#verify', () => {
    let typeName= `ForwardRequest(${GENERIC_PARAMS})`
    let typeHash = keccak256(typeName)

    describe('#verify failures', () => {
      const dummyDomainSeparator = bytes32(1)

      const req = {
        to: addr(1),
        data: '0x',
        from: senderAddress,
        value: '0',
        nonce: 0,
        gas: 123
      }

      it('should fail on wrong nonce', async () => {
        await expectRevert(fwd.verify({
          ...req,
          nonce: 123
        }, dummyDomainSeparator, typeHash, '0x', '0x'), 'revert nonce mismatch')
      })
      it('should fail on invalid signature', async () => {
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x'), 'invalid signature length')
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x123456'), 'invalid signature length')
        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x' + '1b'.repeat(65)), 'signature mismatch')
      })
    })
    describe('#verify success', () => {

      const req = {
        to: addr(1),
        data: '0x',
        value: '0',
        from: senderAddress,
        nonce: 0,
        gas: 123
      }

      let data: EIP712TypedData

      before(() => {
        data = {
          domain: {
            name: 'Test Domain',
            version: '1',
            chainId: 1234,
            verifyingContract: fwd.address
          },
          primaryType: 'ForwardRequest',
          types: {
            EIP712Domain: EIP712DomainType,
            ForwardRequest: ForwardRequestType
          },
          message: req
        }
        // sanity: verify that we calculated the type locally just like eth-utils:
        const calcType = TypedDataUtils.encodeType('ForwardRequest', data.types)
        assert.equal(calcType, typeName)
        const calcTypeHash = bufferToHex(TypedDataUtils.hashType('ForwardRequest', data.types))
        assert.equal(calcTypeHash, typeHash)
      })

      it('should verify valid signature', async () => {
        const sig = signTypedData_v4(senderPrivateKey, { data })
        const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

        await fwd.verify(req, bufferToHex(domainSeparator), typeHash, '0x', sig)
      })

      it('should verify valid signature of extended type', async () => {
        const ExtendedMessageType = [
          ...ForwardRequestType,
          { name: 'extra', type: 'ExtraData' } // <--extension param. uses a typed structure - though could be plain field
        ]
        const ExtraDataType = [
          { name: 'extraAddr', type: 'address' }
        ]

        const extendedReq = {
          to: addr(1),
          data: '0x',
          value: '0',
          from: senderAddress,
          nonce: 0,
          gas: 123,
          extra: {
            extraAddr: addr(5)
          }
        }

        // we create extended data message
        const extendedData = {
          domain: data.domain,
          primaryType: 'ExtendedMessage',
          types: {
            EIP712Domain: EIP712DomainType,
            ExtendedMessage: ExtendedMessageType,
            ExtraData: ExtraDataType
          },
          message: extendedReq
        }

        const typeName = 'ExtendedMessage'
        const typeSuffix = 'ExtraData extra)ExtraData(address extraAddr)'

        const { logs } = await fwd.registerRequestType(typeName, typeSuffix)
        const { typeHash } = logs[0].args
        const sig = signTypedData(senderPrivateKey, { data: extendedData })

        // same calculation of domainSeparator as with base (no-extension)
        const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', extendedData.domain, extendedData.types)

        // encode entire struct, to extract "suffixData" from it
        const encoded = TypedDataUtils.encodeData(extendedData.primaryType, extendedData.message, extendedData.types)
        // skip default params: typehash, and 5 params, so 32*6
        const suffixData = bufferToHex(encoded.slice((1 + count_params) * 32))

        await fwd.verify(extendedReq, bufferToHex(domainSeparator), typeHash, suffixData, sig)
      })
    })
  })

  describe('#verifyAndCall', () => {

    let data: EIP712TypedData
    let typeName: string
    let typeHash: string
    let recipient: TestForwarderTargetInstance
    let testfwd: TestEip712ForwarderInstance
    let domainSeparator: string

    before(async () => {
      typeName = `ForwardRequest(${GENERIC_PARAMS})`
      typeHash = web3.utils.keccak256(typeName)
      await fwd.registerRequestType('TestCall', '')
      data = {
        domain: {
          name: 'Test Domain',
          version: '1',
          chainId: 1234,
          verifyingContract: fwd.address
        },
        primaryType: 'ForwardRequest',
        types: {
          EIP712Domain: EIP712DomainType,
          ForwardRequest: ForwardRequestType
        },
        message: {}
      }
      // sanity: verify that we calculated the type locally just like eth-utils:
      const calcType = TypedDataUtils.encodeType('ForwardRequest', data.types)
      assert.equal(calcType, typeName)
      const calcTypeHash = bufferToHex(TypedDataUtils.hashType('ForwardRequest', data.types))
      assert.equal(calcTypeHash, typeHash)
      recipient = await TestForwarderTarget.new(fwd.address)
      testfwd = await TestEip712Forwarder.new()

      domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
    })

    it('should call function', async () => {
      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      // const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: 0,
        gas: 1e6
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })
      const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

      // note: we pass request as-is (with extra field): web3/truffle can only send javascript members that were
      // declared in solidity
      await fwd.execute(req1, bufferToHex(domainSeparator), typeHash, '0x', sig)
      // @ts-ignore
      const logs = await recipient.getPastEvents('TestForwarderMessage')
      assert.equal(logs.length, 1, 'TestRecipient should emit')
      assert.equal(logs[0].args.realSender, senderAddress, 'TestRecipient should "see" real sender of meta-tx')
      assert.equal('1', (await fwd.getNonce(senderAddress)).toString(), 'verifyAndCall should increment nonce')
    })

    it('should return revert message of target revert', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: (await fwd.getNonce(senderAddress)).toString(),
        gas: 1e6
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
      assert.equal(ret.logs[0].args.error, 'always fail')
    })

    it('should not be able to re-submit after revert (its repeated nonce)', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: 0,
        from: senderAddress,
        nonce: (await fwd.getNonce(senderAddress)).toString(),
        gas: 1e6
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
      assert.equal(ret.logs[0].args.error, 'always fail')
      assert.equal(ret.logs[0].args.success, false)

      await expectRevert(testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig), 'nonce mismatch')
    })

    describe('value transfer', () => {
      let recipient: TestForwarderTargetInstance

      beforeEach(async () => {
        recipient = await TestForwarderTarget.new(fwd.address)
      })
      afterEach('should not leave funds in the forwarder', async () => {
        assert.equal(await web3.eth.getBalance(fwd.address), '0')
      })

      it('should fail to forward request if value specified but not provided', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce(senderAddress)).toString(),
          value: value.toString(),
          gas: 1e6
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
        assert.equal(ret.logs[0].args.success, false)
      })

      it.skip('should fail to forward request if value specified but not enough not provided', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce(senderAddress)).toString(),
          value: ether('2').toString(),
          gas: 1e6
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig, { value })
        assert.equal(ret.logs[0].args.success, false)
      })

      it('should forward request with value', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        // value = ether('0');
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce(senderAddress)).toString(),
          value: value.toString(),
          gas: 1e6
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig, { value })
        assert.equal(ret.logs[0].args.error, '')
        assert.equal(ret.logs[0].args.success, true)

        assert.equal(await web3.eth.getBalance(recipient.address), value.toString())
      })

      it('should forward all funds left in forwarder to "from" address', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        // value = ether('0');
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce(senderAddress)).toString(),
          value: value.toString(),
          gas: 1e6
        }

        const extraFunds = ether('4')
        await web3.eth.sendTransaction({ from, to: fwd.address, value: extraFunds })

        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        // note: not transfering value in TX.
        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
        assert.equal(ret.logs[0].args.error, '')
        assert.equal(ret.logs[0].args.success, true)

        assert.equal(await web3.eth.getBalance(senderAddress), extraFunds.sub(value).toString())
      })
    })
  })
})
