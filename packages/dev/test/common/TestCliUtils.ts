import { getNetworkUrl } from '@opengsn/cli/dist/utils'

describe('cli-utils', () => {
  describe('#getNetworkUrl', () => {
    it('should validate url', function () {
      assert.equal(getNetworkUrl('http://localhost:12345'), 'http://localhost:12345')
      assert.equal(getNetworkUrl('https://localhost:12345'), 'https://localhost:12345')
    })
    it('should require INFURA_ID for valid networks', function () {
      expect(() => getNetworkUrl('kovan', {})).to.throw('INFURA_ID not set')
      assert.equal(getNetworkUrl('kovan', { INFURA_ID: '<id>' }), 'https://kovan.infura.io/v3/<id>')
    })
    it('should reject invalid url', function () {
      expect(() => getNetworkUrl('asdasdas', {})).to.throw('network asdasdas is not supported')
    })
  })
})
