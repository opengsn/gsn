import { toHex } from 'web3-utils'

import {
  BigNumberToBN,
  getPublicKeySerialized
} from '@opengsn/common/src/bls/BLSTypedDataSigner'

import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { g2ToBN } from '@opengsn/common/dist/bls/evmbls/mcl'
import { cloneRelayRequest, RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { BLSContractInstance } from '@opengsn/contracts'

const BLSContract = artifacts.require('BLSContract')

contract.only('BLSTypedDataSigner', function ([address]: string[]) {
  let blsContract: BLSContractInstance

  let relayRequest: RelayRequest

  before(async function () {
    blsContract = await BLSContract.new()
    relayRequest = {
      request: {
        to: address,
        data: '0xdeadbeefcafecafe',
        from: address,
        nonce: '777',
        value: '0',
        gas: '10000',
        validUntil: '0'
      },
      relayData: {
        pctRelayFee: '1',
        baseRelayFee: '1',
        transactionCalldataGasUsed: '0',
        gasPrice: '4494095',
        paymaster: address,
        paymasterData: '0xcafecafedeadbeef',
        clientId: '123',
        forwarder: address,
        relayWorker: address
      }
    }
  })

  context('#signRelayRequestBLS()', function () {
    it('should sign RelayRequest correctly', async function () {
      const keypair = await BLSTypedDataSigner.newKeypair()
      const blsTypedDataSigner = new BLSTypedDataSigner({ keypair })
      const pubkey = blsTypedDataSigner.getPublicKeySerialized()
      const signature = await blsTypedDataSigner.signRelayRequestBLS(relayRequest)
      const blsPointMessage = await blsTypedDataSigner.relayRequestToG1Point(relayRequest)
      const hexSigWithoutZ = [toHex(signature[0]), toHex(signature[1])]
      const hexMessageWithoutZ = [toHex(blsPointMessage[0]), toHex(blsPointMessage[1])]
      const onChainValid = await blsContract.verifySingle(hexSigWithoutZ, pubkey, hexMessageWithoutZ)
      assert.isTrue(onChainValid, 'single signature validation failed')
    })
  })

  context('#aggregateSignatures()', function () {
    it('should aggregate multiple signatures into a single valid one', async function () {
      const keypair1 = await BLSTypedDataSigner.newKeypair()
      const keypair2 = await BLSTypedDataSigner.newKeypair()
      const keypair3 = await BLSTypedDataSigner.newKeypair()
      const blsTypedDataSigner1 = new BLSTypedDataSigner({ keypair: keypair1 })
      const blsTypedDataSigner2 = new BLSTypedDataSigner({ keypair: keypair2 })
      const blsTypedDataSigner3 = new BLSTypedDataSigner({ keypair: keypair3 })

      const relayRequest2 = cloneRelayRequest(relayRequest, { request: { data: '0xdeadc0de' } })
      const relayRequest3 = cloneRelayRequest(relayRequest, { request: { data: '0xdecafbad' } })

      const signature1 = await blsTypedDataSigner1.signRelayRequestBLS(relayRequest)
      const signature2 = await blsTypedDataSigner2.signRelayRequestBLS(relayRequest2)
      const signature3 = await blsTypedDataSigner3.signRelayRequestBLS(relayRequest3)

      const blsPointMessage1 = await blsTypedDataSigner1.relayRequestToG1Point(relayRequest)
      const blsPointMessage2 = await blsTypedDataSigner2.relayRequestToG1Point(relayRequest2)
      const blsPointMessage3 = await blsTypedDataSigner3.relayRequestToG1Point(relayRequest3)
      const hexMessageWithoutZ = [
        [toHex(blsPointMessage1[0]), toHex(blsPointMessage1[1])],
        [toHex(blsPointMessage2[0]), toHex(blsPointMessage2[1])],
        [toHex(blsPointMessage3[0]), toHex(blsPointMessage3[1])]
      ]

      const pubkeys = [keypair1, keypair2, keypair3].map(it => it.pubkey).map(getPublicKeySerialized)
      const signatures = [signature1, signature2, signature3].map(it => it.map(it => it.toString('hex')))
      const aggregatedSignature = blsTypedDataSigner1.aggregateSignatures(signatures)
      const hexSigWithoutZ = [toHex(aggregatedSignature[0]), toHex(aggregatedSignature[1])]

      const onChainValid = await blsContract.verifyMultiple(hexSigWithoutZ, pubkeys, hexMessageWithoutZ)
      assert.isTrue(onChainValid, 'aggregated signature validation failed')
    })
  })

  context('#deserializeHexStringKeypair()', function () {
    it('should convert hex strings of public, private keys into a valid MCL G2 object', async function () {
      const keypair = await BLSTypedDataSigner.newKeypair()
      const blsTypedDataSigner = new BLSTypedDataSigner({ keypair })
      const privateKeySerialized = '495fcacda7aa8ddaf59f3c81eae6a66a2abc935a8d405a0cbcad20c57c89670b'
      const publicKey0Serialized = '1696d393da25ffbb2b0b8061ed6cfb5de57186a5df5e032cb3cc08593da203c3'
      const deserializedKeypair = blsTypedDataSigner.deserializeHexStringKeypair(privateKeySerialized)
      assert.equal(deserializedKeypair.secret.serializeToHexStr(), privateKeySerialized)
      assert.equal(g2ToBN(deserializedKeypair.pubkey).map(BigNumberToBN)[0].toString('hex'), publicKey0Serialized)
    })
    it('should revert for corrupted input') // <-- not sure about that; is there a built-in verification in BLS?
  })
})
