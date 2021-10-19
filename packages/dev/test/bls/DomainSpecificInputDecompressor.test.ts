import { toBN } from 'web3-utils'

import { encodeBatch, RLPBatchCompressedInput } from '@opengsn/common/dist/bls/DecompressorInteractor'

contract('BatchGatewayCacheDecoder', function () {
  const batchInput: RLPBatchCompressedInput = {
    gasPrice: toBN(15),
    validUntil: toBN(15),
    relayWorker: toBN(15),
    pctRelayFee: toBN(15),
    baseRelayFee: toBN(15),
    maxAcceptanceBudget: toBN(15),
    defaultCacheDecoder: toBN(0),
    blsSignature: [],
    relayRequestElements: [],
    authorizations: []
  }

  context('#encodeBatch()', function () {
    it('should encode minimal empty batch', function () {
      const encoding1 = encodeBatch(batchInput)
      const encoding2 = encodeBatch(batchInput)
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
