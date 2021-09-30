import { toBN } from 'web3-utils'

import { encodeBatch } from '@opengsn/common/dist/bls/DecompressorInteractor'

contract('DomainSpecificInputDecompressor', function () {
  context('#relayRequestToBatchItem()', function () {
    it('')
  })

  context('#encodeBatch()', function () {
    it('should encode minimal empty batch', function () {
      const encoding1 = encodeBatch({
        maxAcceptanceBudget: toBN(0),
        blsSignature: [],
        items: []
      })
      const encoding2 = encodeBatch({
        maxAcceptanceBudget: toBN(15),
        blsSignature: [toBN(5), toBN(7)],
        items: []
      })
      assert.equal(encoding1, 'WHAAAA')
      assert.equal(encoding2, '0xc30f37c0')
    })

    it('should encode batch with one element')
    it('should encode batch with five elements')
  })
})
