import semver from 'semver'

export default class VersionsManager {
  readonly componentVersion: string
  readonly requiredVersionRange: string

  /**
   * @param componentVersion - a semver of a component that uses the VersionsManager
   */
  constructor (componentVersion: string, requiredVersionRange?: string) {
    if (semver.valid(componentVersion) == null) {
      throw new Error('Component version is not valid')
    }

    if (requiredVersionRange == null) {
      const ver = new semver.SemVer(componentVersion)
      ver.patch = 0
      requiredVersionRange = '^' + ver.format()
    }
    this.componentVersion = componentVersion
    this.requiredVersionRange = requiredVersionRange
  }

  /**
   * @param version - the version of a dependency to compare against
   * @return true if {@param version} is same or newer then {@link componentVersion}
   */
  isMinorSameOrNewer (version: string): boolean {
    // prevent crash with some early paymasters (which are otherwise perfectly valid)
    version = version.replace('_', '-')

    return semver.satisfies(version, this.requiredVersionRange, { includePrerelease: true })
  }
}
