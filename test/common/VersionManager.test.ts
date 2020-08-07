/* eslint-disable no-new */
import VersionsManager from '../../src/common/VersionsManager'
require('source-map-support').install({ errorFormatterForce: true })

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
    context( 'version check', ()=> {
      const manager = new VersionsManager('3.4.5')
      it('sameness', function () {
        assert.isTrue(manager.isMinorSameOrNewer('3.4.5'))
      })
      it('different patch', function () {
        //accept any patch change
        assert.isTrue(manager.isMinorSameOrNewer('3.4.9'))
        assert.isTrue(manager.isMinorSameOrNewer('3.4.1'))
      })
      it('different minor', function () {
        //accept higher minor, but not lower
        assert.isTrue(manager.isMinorSameOrNewer('3.5.5'))
        assert.isFalse(manager.isMinorSameOrNewer('3.2.5'))
      })
      it('different major', function () {
        //don't accept any major change
        assert.isFalse(manager.isMinorSameOrNewer('2.4.5'))
        assert.isFalse(manager.isMinorSameOrNewer('4.4.5'))
      })
    })
  })
})
