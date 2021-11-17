import { encodeBatch } from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { stubBatchInput } from '../ServerTestEnvironment'

contract('BatchGatewayCacheDecoder', function () {
  context('#encodeBatch()', function () {
    it('should encode minimal empty batch', function () {
      const encoding1 = encodeBatch(stubBatchInput)
      const encoding2 = encodeBatch(stubBatchInput)
      assert.equal(encoding1, 'WHAAAA')
      assert.equal(encoding2, '0xc30f37c0')
    })

    it('should encode batch with one element')
    it('should encode batch with five elements')
  })

  context('#calculateRLPItemsSizeBytes()', function () {
    it('should calculate exact number of bytes in an RLP input')
  })
})
