/* eslint-disable no-new */
import VersionsManager from '../../src/common/VersionsManager'

describe('VersionManager', function () {
  context('constructor', function () {
    it('should throw on invalid semver string', function () {
      expect(function () {
        new VersionsManager('v.1.0')
      }).to.throw('Component version is not valid')
    })
    it('should not throw on valid semver string', function () {
      new VersionsManager('2.0.0-beta.1+opengsn.something')
    })
  })

  context('#isMinorSameOrNewer()', function () {
    const manager = new VersionsManager('1.2.3')
    it('should return true if version is same or newer', function () {
      const isNewerSame = manager.isMinorSameOrNewer('1.2.4')
      const isNewerPatch = manager.isMinorSameOrNewer('1.2.4')
      const isNewerMinor = manager.isMinorSameOrNewer('1.2.4')
      assert.isTrue(isNewerSame)
      assert.isTrue(isNewerPatch)
      assert.isTrue(isNewerMinor)

      const isNewerMajor = manager.isMinorSameOrNewer('2.3.4')
      const isNewerPatchFalse = manager.isMinorSameOrNewer('1.2.0')
      const isNewerMinorFalse = manager.isMinorSameOrNewer('1.1.0')
      const isNewerMajorFalse = manager.isMinorSameOrNewer('0.2.3')
      assert.isFalse(isNewerMajor)
      assert.isFalse(isNewerPatchFalse)
      assert.isFalse(isNewerMinorFalse)
      assert.isFalse(isNewerMajorFalse)
    })
  })
})
