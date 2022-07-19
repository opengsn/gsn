/* eslint-disable no-new */
import { VersionsManager } from '@opengsn/common'

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
    it('target version with zero patch', function () {
      assert.equal(new VersionsManager('2.3.4+opengsn.something').requiredVersionRange, '^2.3.0')
    })
    it('target beta version with zero patch', function () {
      assert.equal(new VersionsManager('2.3.4-beta.5+opengsn.something').requiredVersionRange, '^2.3.0-beta.5')
    })
  })

  context('#isMinorSameOrNewer()', function () {
    const manager = new VersionsManager('1.2.3')
    it('should ignore patch level', function () {
      assert.isTrue(manager.isRequiredVersionSatisfied('1.2.2'))
      assert.isTrue(manager.isRequiredVersionSatisfied('1.2.3'))
      assert.isTrue(manager.isRequiredVersionSatisfied('1.2.4'))
    })

    it('should require minor same or equal', function () {
      assert.isTrue(manager.isRequiredVersionSatisfied('1.3.0'))
      assert.isFalse(manager.isRequiredVersionSatisfied('1.1.3'))
    })

    it('should require exact same major', function () {
      assert.isFalse(manager.isRequiredVersionSatisfied('0.2.3'))
      assert.isFalse(manager.isRequiredVersionSatisfied('3.2.3'))
    })
  })
})
