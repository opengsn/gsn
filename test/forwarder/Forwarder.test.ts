import {
  ForwarderInstance,
  TestForwarderInstance,
  TestForwarderTargetInstance
} from '../../types/truffle-contracts'

// @ts-ignore
import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData } from 'eth-sig-util'
import { bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
import { ether, expectRevert } from '@openzeppelin/test-helpers'
import { toChecksumAddress } from 'web3-utils'
require('source-map-support').install({ errorFormatterForce: true })

const TestForwarderTarget = artifacts.require('TestForwarderTarget')

const Forwarder = artifacts.require('Forwarder')
const TestForwarder = artifacts.require('TestForwarder')

const keccak256 = web3.utils.keccak256

function addr (n: number): string {
  return '0x' + n.toString().repeat(40)
}

function bytes32 (n: number): string {
  return '0x' + n.toString().repeat(64).slice(0, 64)
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
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'gas', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'data', type: 'bytes' },
  { name: 'validUntil', type: 'uint256' }
]

contract('Forwarder', ([from]) => {
  const GENERIC_PARAMS = 'address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,uint256 validUntil'
  // our generic params has 7 bytes32 values
  const countParams = ForwardRequestType.length

  let fwd: ForwarderInstance

  let tf: TestForwarderInstance

  let chainId: number

  const senderPrivateKey = toBuffer(bytes32(1))
  const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

  before(async () => {
    fwd = await Forwarder.new()
    tf = await TestForwarder.new()
    chainId = (await tf.getChainId()).toNumber()
    assert.equal(await fwd.GENERIC_PARAMS(), GENERIC_PARAMS)
  })

  describe('#registerRequestType', () => {
    it('should fail to register with invalid name', async () => {
      // this is an example of a typename that attempt to add a new field at the beginning.
      await expectRevert(fwd.registerRequestType('asd(uint a,Request asd)Request(', ')'), 'invalid typename')
    })

    it('should have a registered default type with no extra params', async () => {
      const logs = await fwd.contract.getPastEvents('RequestTypeRegistered', { fromBlock: 1 })
      assert.equal(logs[0].returnValues.typeStr, `ForwardRequest(${GENERIC_PARAMS})`)
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

  describe('#registerDomainSeparator', () => {
    it('registered domain should match local definition', async () => {
      const data = {
        domain: {
          name: 'domainName',
          version: 'domainVer',
          chainId,
          verifyingContract: fwd.address
        },
        primaryType: 'ForwardRequest',
        types: {
          EIP712Domain: EIP712DomainType
        }
      }

      const localDomainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
      const typehash = TypedDataUtils.hashType('EIP712Domain', data.types)
      const ret = await fwd.registerDomainSeparator('domainName', 'domainVer')

      const { domainSeparator, domainValue } = ret.logs[0].args
      assert.equal(domainValue, web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [typehash, keccak256('domainName'), keccak256('domainVer'), data.domain.chainId, fwd.address]))
      assert.equal(domainSeparator, localDomainSeparator)

      assert.equal(await fwd.domains(localDomainSeparator), true)
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
    const typeName = `ForwardRequest(${GENERIC_PARAMS})`
    const typeHash = keccak256(typeName)
    let domainInfo: any

    let domainSeparator: string

    before('register domain separator', async () => {
      domainInfo = {
        name: 'domainName',
        version: 'domainVer',
        chainId,
        verifyingContract: fwd.address
      }

      const data = {
        domain: domainInfo,
        primaryType: 'ForwardRequest',
        types: {
          EIP712Domain: EIP712DomainType
        }
      }

      domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))
      await fwd.registerDomainSeparator('domainName', 'domainVer')
    })

    describe('#verify failures', () => {
      const req = {
        to: addr(1),
        data: '0x',
        from: senderAddress,
        value: '0',
        nonce: 0,
        gas: 123,
        validUntil: 0
      }

      it('should fail on unregistered domain separator', async () => {
        const dummyDomainSeparator = bytes32(1)

        await expectRevert(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x'.padEnd(65 * 2 + 2, '1b')), 'FWD: unregistered domain sep.')
      })

      it('should fail on wrong nonce', async () => {
        await expectRevert(fwd.verify({
          ...req,
          nonce: 123
        }, domainSeparator, typeHash, '0x', '0x'), 'FWD: nonce mismatch')
      })
      it('should fail on invalid signature', async () => {
        await expectRevert(fwd.verify(req, domainSeparator, typeHash, '0x', '0x'), 'invalid signature length')
        await expectRevert(fwd.verify(req, domainSeparator, typeHash, '0x', '0x123456'), 'invalid signature length')
        await expectRevert(fwd.verify(req, domainSeparator, typeHash, '0x', '0x' + '1b'.repeat(65)), 'signature mismatch')
      })
    })
    describe('#verify success', () => {
      const req = {
        to: addr(1),
        data: '0x',
        value: '0',
        from: senderAddress,
        nonce: 0,
        gas: 123,
        validUntil: 0
      }

      let data: EIP712TypedData

      before(() => {
        data = {
          domain: domainInfo,
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
          validUntil: 0,
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
        // skip default params: typehash, and 6 params, so 32*7
        const suffixData = bufferToHex(encoded.slice((1 + countParams) * 32))

        await fwd.verify(extendedReq, bufferToHex(domainSeparator), typeHash, suffixData, sig)
      })
    })
  })

  describe('#execute', () => {
    let data: EIP712TypedData
    let typeName: string
    let typeHash: string
    let recipient: TestForwarderTargetInstance
    let testfwd: TestForwarderInstance
    let domainSeparator: string

    before(async () => {
      typeName = `ForwardRequest(${GENERIC_PARAMS})`
      typeHash = web3.utils.keccak256(typeName)
      await fwd.registerRequestType('TestCall', '')

      data = {
        domain: {
          name: 'Test Domain',
          version: '1',
          chainId,
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
      testfwd = await TestForwarder.new()

      const ret = await fwd.registerDomainSeparator(data.domain.name!, data.domain.version!)

      domainSeparator = bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types))

      // validate registration matches local definition
      assert.equal(domainSeparator, ret.logs[0].args.domainSeparator)
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
        gas: 1e6,
        validUntil: 0
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
      assert.equal('1', (await fwd.getNonce(senderAddress)).toString(), 'execute should increment nonce')
    })

    it('should revert if not given enough gas', async () => {
      const nonce = await fwd.getNonce(senderAddress)

      const func = recipient.contract.methods.emitMessage('hello').encodeABI()
      const funcGasEtimate = await recipient.emitMessage.estimateGas('hello')

      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: nonce.toString(),
        gas: funcGasEtimate,
        validUntil: 0
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })
      const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

      const outerGasEstimate = await testfwd.callExecute.estimateGas(fwd.address, req1, bufferToHex(domainSeparator), typeHash, '0x', sig)

      // should fail if too little gas
      expectRevert(testfwd.callExecute(fwd.address, req1, bufferToHex(domainSeparator), typeHash, '0x', sig, { gas: outerGasEstimate - 1 }), 'insufficient gas')

      // and succeed with exact amount
      await testfwd.callExecute(fwd.address, req1, bufferToHex(domainSeparator), typeHash, '0x', sig, { gas: outerGasEstimate })
    })

    it('should return revert message of target revert', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: '0',
        from: senderAddress,
        nonce: (await fwd.getNonce(senderAddress)).toString(),
        gas: 1e6,
        validUntil: 0
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
        gas: 1e6,
        validUntil: 0
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      // the helper simply emits the method return values
      const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
      assert.equal(ret.logs[0].args.error, 'always fail')
      assert.equal(ret.logs[0].args.success, false)

      await expectRevert(testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig), 'nonce mismatch')
    })

    it('should revert if validUntil is passed', async () => {
      const func = recipient.contract.methods.testRevert().encodeABI()

      const req1 = {
        to: recipient.address,
        data: func,
        value: 0,
        from: senderAddress,
        nonce: (await fwd.getNonce(senderAddress)).toString(),
        gas: 1e6,
        validUntil: '1' // Math.trunc(Date.now() / 1000 - 10).toString()
      }
      const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

      await expectRevert(fwd.execute(req1, domainSeparator, typeHash, '0x', sig), 'FWD: request expired')
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
          gas: 1e6,
          validUntil: 0
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig)
        assert.equal(ret.logs[0].args.success, false)
      })

      it('should fail to forward request if value specified but not enough not provided', async () => {
        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce(senderAddress)).toString(),
          value: ether('2').toString(),
          gas: 1e6,
          validUntil: 0
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
          gas: 1e6,
          validUntil: 0
        }
        const sig = signTypedData_v4(senderPrivateKey, { data: { ...data, message: req1 } })

        const ret = await testfwd.callExecute(fwd.address, req1, domainSeparator, typeHash, '0x', sig, { value })
        assert.equal(ret.logs[0].args.error, '')
        assert.equal(ret.logs[0].args.success, true)

        assert.equal(await web3.eth.getBalance(recipient.address), value.toString())
      })

      it('should forward all funds left in forwarder to "from" address', async () => {
        const senderPrivateKey = toBuffer(bytes32(2))
        const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))

        const value = ether('1')
        const func = recipient.contract.methods.mustReceiveEth(value.toString()).encodeABI()

        // value = ether('0');
        const req1 = {
          to: recipient.address,
          data: func,
          from: senderAddress,
          nonce: (await fwd.getNonce(senderAddress)).toString(),
          value: value.toString(),
          gas: 1e6,
          validUntil: 0
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
