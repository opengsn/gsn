import {Eip712ForwarderInstance} from "../types/truffle-contracts"
import {EIP712Domain, EIP712TypedData, recoverTypedSignature, signTypedData, TypedDataUtils} from "eth-sig-util";
import TypedRequestData from "../src/common/EIP712/TypedRequestData";
import {bufferToHex, privateToAddress, toBuffer} from "ethereumjs-util";

const Eip712Forwarder = artifacts.require('Eip712Forwarder')

function addr(n: number): string {
    return '0x' + n.toString().repeat(40)
}

function bytes32(n: number): string {
    return '0x' + n.toString().repeat(64)
}

async function res<T>(asyncFunc: Promise<T>): Promise<any> {

    try {
        return await asyncFunc
    } catch (e) {
        const m = e.message.match(/VM Exception while processing transaction: (revert .*)/)
        if (m != null) {
            return m[1]
        }
        return e.message
    }
}

contract('Eip712Forwarder', () => {
    let fwd: Eip712ForwarderInstance
    before(async () => {
        fwd = await Eip712Forwarder.new()
    })
    describe('#registerRequestType', () => {

        it('should fail to register without a name', async () => {
            assert.equal(await res(fwd.registerRequestType('')), 'revert invalid type: no name')
            assert.include(await res(fwd.registerRequestType('()')), 'revert invalid type: no name')
        })

        it('should fail with no parameters', async () => {
            assert.equal(await res(fwd.registerRequestType('asd')), 'revert invalid type: no params')
            assert.equal(await res(fwd.registerRequestType('asd(')), 'revert invalid type: too short')
            assert.equal(await res(fwd.registerRequestType('asd()')), 'revert invalid type: too short')
        })

        it('should fail with incomplete parameters', async () => {
            assert.equal(await res(fwd.registerRequestType('asd(' + 'a'.repeat(100))), 'revert invalid type: params don\'t match')
            assert.equal(await res(fwd.registerRequestType('asd(' + await fwd.paramsPrefix())), 'revert invalid type: too short')
        })

        it('should accept type with exact parameters', async () => {
            await fwd.registerRequestType('asd(' + await fwd.paramsPrefix() + ')')
            await fwd.registerRequestType('veryLongName'.repeat(10) + '(' + await fwd.paramsPrefix() + ')')
        })

        it('should accept extension type', async () => {
            await fwd.registerRequestType('asd(' + await fwd.paramsPrefix() + 'extension)')
        })

        it('should emit typehash', async () => {
            let typeName = 'anotherType(' + await fwd.paramsPrefix() + ')';
            const res = await fwd.registerRequestType(typeName)
            const {typehash, typeStr} = (res.logs.find(e => e.event == 'RequestTypeRegistered') as any).args
            assert.equal(typeStr, typeName)
            assert.equal(typehash, web3.utils.keccak256(typeName))
        })
        it('should reject repeated registration', async () => {
            let typeName = 'anotherType(' + await fwd.paramsPrefix() + ')';
            assert.equal(await res(fwd.registerRequestType(typeName)), 'revert typehash already registered')
        })
    })
    describe('#isRegisteredTypehash', () => {
        let typeName: string
        before(async () => {
            typeName = 'testIsRegistered(' + await fwd.paramsPrefix() + ')';
        })
        it('should return false before registration', async () => {
            assert.equal(false, await fwd.isRegisteredTypehash(web3.utils.keccak256(typeName)))
        })
        it('should return true after registration', async () => {
            await fwd.registerRequestType(typeName)
            assert.equal(true, await fwd.isRegisteredTypehash(web3.utils.keccak256(typeName)))
        })
    })

    describe('#verify', () => {
        let typeName: string
        let typeHash: string

        const dummyDomainSeparator = bytes32(1)
        let senderPrivateKey = toBuffer(bytes32(1))
        const senderAddress = bufferToHex(privateToAddress(senderPrivateKey))

        const req = {
            target: addr(1),
            encodedFunction: '0x',
            senderAddress,
            senderNonce: 0,
            gasLimit: 123,
            forwarder: addr(3)
        }
        before(async () => {
            typeName = 'TestVerify(' + await fwd.paramsPrefix() + ')';
            typeHash = web3.utils.keccak256(typeName)
            await fwd.registerRequestType(typeName)
        })

        it('should fail on wrong nonce', async () => {

            assert.equal(await res(fwd.verify({
                ...req,
                senderNonce: 123
            }, dummyDomainSeparator, typeHash, '0x', '0x')), 'revert nonce mismatch')
        })
        it('should fail on invalid signature', async () => {

            assert.include(await res(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x')), 'invalid signature length')
            assert.include(await res(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x123456')), 'invalid signature length')
            assert.include(await res(fwd.verify(req, dummyDomainSeparator, typeHash, '0x', '0x' + '1b'.repeat(65))), 'signature mismatch')
        })
        it('should verify valid signature', async () => {
            const chainId = 1
            const verifier = fwd.address

            const EIP712DomainType = [
                {name: 'name', type: 'string'},
                {name: 'version', type: 'string'},
                // { name: 'chainId', type: 'uint256' },
                {name: 'verifyingContract', type: 'address'}
            ]

            const MessageType = [
                {name: 'target', type: 'address'},
                {name: 'encodedFunction', type: 'bytes'},
                {name: 'senderAddress', type: 'address'},
                {name: 'senderNonce', type: 'uint256'},
                {name: 'gasLimit', type: 'uint256'},
            ]

            let req = {
                target: addr(1),
                encodedFunction: '0x',
                senderAddress,
                senderNonce: 0,
                gasLimit: 123
            };
            const data: EIP712TypedData = {
                domain: {
                    name: 'Test Domain',
                    version: '1',
                    verifyingContract: fwd.address
                },
                primaryType: "TestVerify",
                types: {
                    EIP712Domain: EIP712DomainType,
                    TestVerify: MessageType
                },
                message: req,
            }

            const sig = signTypedData(senderPrivateKey, {data})
            const domainSeparator = TypedDataUtils.hashStruct('EIP712Domain', data.domain, data.types)

            //sanity: verify that we calculated the type locally just like eth-utils:
            const calcType = TypedDataUtils.encodeType('TestVerify', data.types)
            assert.equal(calcType, typeName)
            const calcTypeHash = bufferToHex(TypedDataUtils.hashType('TestVerify', data.types))
            assert.equal(calcTypeHash, typeHash)

            await fwd.verify(req, bufferToHex(domainSeparator), typeHash, '0x', sig)
        })


    })
})