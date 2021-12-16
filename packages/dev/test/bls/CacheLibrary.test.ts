import { TestCacheLibraryInstance } from '@opengsn/contracts'
import { removeHexPrefix } from '@opengsn/common'
import { toBN } from 'web3-utils'

const TestCacheLibrary = artifacts.require('TestCacheLibrary')

contract.only('CacheLibrary', function ([address]: string[]) {
  let testCacheLibrary: TestCacheLibraryInstance
  before(async function () {
    testCacheLibrary = await TestCacheLibrary.new()
  })

  context('#convertWordsToIds()', function () {
    it('should return the original value if no value cached', async function () {
      const [[returnedId]] = await testCacheLibrary.convertWordsToIds([[address]])
      assert.equal(returnedId.toString('hex'), removeHexPrefix(address.toLowerCase()))
      const cachedValue = await testCacheLibrary.contract.methods.queryAndUpdateCache(returnedId).call()
      assert.equal(toBN(cachedValue).toString('hex'), removeHexPrefix(address.toLowerCase()))
    })

    context('with cached value', function () {
      before(async function () {
        await testCacheLibrary.queryAndUpdateCache(address)
      })

      it('should return the id if value cached', async function () {
        const [[returnedId]] = await testCacheLibrary.convertWordsToIds([[address]])
        assert.equal(returnedId.toString(), '1')
        const cachedValue = await testCacheLibrary.contract.methods.queryAndUpdateCache(returnedId).call()
        assert.equal(toBN(cachedValue).toString('hex'), removeHexPrefix(address.toLowerCase()))
      })
    })
  })
})
