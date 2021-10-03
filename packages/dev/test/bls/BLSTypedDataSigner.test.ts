import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'

contract('BLSTypedDataSigner', function () {
  let signer: BLSTypedDataSigner

  context('#signTypedDataBLS()', function () {
    it('should sign data correctly', async function () {
      const signature = await signer.signTypedDataBLS('hello world')
      assert.equal(signature.length, 4)
      // TODO: verify BLS signature off-chain
    })
  })

  context('#aggregateSignatures()', function () {

  })
})
