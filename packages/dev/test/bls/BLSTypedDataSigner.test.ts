import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { g2ToBN } from '@opengsn/common/dist/bls/evmbls/mcl'
import { BigNumberToBN } from '@opengsn/common/src/bls/BLSTypedDataSigner'

contract.only('BLSTypedDataSigner', function () {
  let blsTypedDataSigner: BLSTypedDataSigner

  before(async function () {
    blsTypedDataSigner = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })
  })
  context.skip('#signTypedDataBLS()', function () {
    it('should sign data correctly', async function () {
      const signature = await blsTypedDataSigner.signTypedDataBLS('hello world')
      assert.equal(signature.length, 4)
      // TODO: verify BLS signature off-chain
    })
  })

  context('#aggregateSignatures()', function () {

  })
  context('#deserializeHexStringKeypair()', function () {
    it('should convert hex strings of public, private keys into a valid MCL G2 object', async function () {
      const privateKeySerialized = '495fcacda7aa8ddaf59f3c81eae6a66a2abc935a8d405a0cbcad20c57c89670b'
      const publicKey0Serialzied = '1696d393da25ffbb2b0b8061ed6cfb5de57186a5df5e032cb3cc08593da203c3'
      const deserializedKeypair = blsTypedDataSigner.deserializeHexStringKeypair(privateKeySerialized)
      assert.equal(deserializedKeypair.secret.serializeToHexStr(), privateKeySerialized)
      assert.equal(g2ToBN(deserializedKeypair.pubkey).map(BigNumberToBN)[0].toString('hex'), publicKey0Serialzied)
    })
    it('should revert for corrupted input') // <-- not sure about that; is there a built-in verification in BLS?
  })
})
