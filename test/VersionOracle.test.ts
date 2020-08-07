import {
  VersionOracleInstance
} from '../types/truffle-contracts'
import { expectRevert } from '@openzeppelin/test-helpers'
import { hexlify } from 'ethers/utils'
import { increaseTime } from './TestUtils'
import { PrefixedHexString } from 'ethereumjs-tx'

require('source-map-support').install({ errorFormatterForce: true })
const VersionOracle = artifacts.require('VersionOracle')

contract('VersionOracle', () => {
  let oracle: VersionOracleInstance

  // convert string to bytes32 value (padded with zeros)
  function string32 (s: string): PrefixedHexString {
    return hexlify(Buffer.from(s))
  }

  // convert a bytes32 into a string, removing any trailing zeros
  function bytes32toString (s: PrefixedHexString): string {
    return Buffer.from(s.replace(/^(?:0x)?(.*?)(00)*$/, '$1'), 'hex').toString()
  }

  before(async () => {
    oracle = await VersionOracle.new()
    await oracle.addVersion(string32('id'), string32('ver'), 'value')
  })
  it('should fail to add without id', async () => {
    await expectRevert(oracle.addVersion(string32(''), string32(''), 'value'), 'missing id')
  })
  it('should fail to add without version', async () => {
    await expectRevert(oracle.addVersion(string32('id'), string32(''), 'value'), 'missing version')
  })
  it('should fail to add same version', async () => {
    await expectRevert(oracle.addVersion(string32('id'), string32('ver'), 'value2'), 'version already set')
  })
  describe('with more versions', () => {
    let now: number
    before(async () => {
      await increaseTime(100)
      await oracle.addVersion(string32('id'), string32('ver2'), 'value2')
      await increaseTime(100)
      await oracle.addVersion(string32('id'), string32('ver3'), 'value3')
      await increaseTime(100)

      await oracle.addVersion(string32('id1'), string32('ver3'), '1'.repeat(200))

      now = parseInt((await web3.eth.getBlock('latest')).timestamp.toString())

      // at this point:
      // ver1 - 300 sec old
      // ver2 - 200 sec old
      // ver3 - 100 sec old
    })

    describe('#getVersion', () => {
      it('should revert if has no version', async () => {
        expectRevert(oracle.getVersion(string32('nosuchid'), string32(''), 1), 'no version found')
      })

      it('should revert if no version is mature', async () => {
        expectRevert(oracle.getVersion(string32('id'), string32(''), 10000), 'no version found')
      })

      it('should return latest version', async () => {
        const { version, value } = await oracle.getVersion(string32('id'), string32(''), 1)
        const versionStr = bytes32toString(version)
        assert.deepEqual({ versionStr, value }, { versionStr: 'ver3', value: 'value3' })
      })

      it('should return latest "mature" version', async () => {
        // ignore entries in the past 150 seconds
        const { version, value } = await oracle.getVersion(string32('id'), string32(''), 150)
        const versionStr = bytes32toString(version)

        assert.deepEqual({ versionStr, value }, { versionStr: 'ver2', value: 'value2' })
      })

      it('should return "young" version if opted-in', async () => {
        // ignore entries in the past 150 seconds (unless explicitly opted-in)
        const { version, value } = await oracle.getVersion(string32('id'), string32('ver3'), 150)
        const versionStr = bytes32toString(version)

        assert.deepEqual({ versionStr, value }, { versionStr: 'ver3', value: 'value3' })
      })

      it('should ignore opt-in if later version exists', async () => {
        // ignore entries in the past 150 seconds
        const { version, value } = await oracle.getVersion(string32('id'), string32('ver1'), 150)
        const versionStr = bytes32toString(version)

        assert.deepEqual({ versionStr, value }, { versionStr: 'ver2', value: 'value2' })
      })
    })

    it('should fail to cancel missing id', async () => {
      await expectRevert(oracle.cancelVersion(string32('noid'), string32('ver')), 'cancelVersion: no such version for id')
      await expectRevert(oracle.cancelVersion(string32('id'), string32('nover')), 'cancelVersion: no such version for id')
    })

    describe('with canceled version', () => {
      before(async () => {
        await oracle.cancelVersion(string32('id'), string32('ver2'))
        // at this point:
        // ver1 - 300 sec old
        // ver2 - 200 sec old - canceled
        // ver3 - 100 sec old
      })

      it('should fail to re-cancel event', async () => {
        await expectRevert(oracle.cancelVersion(string32('id'), string32('ver2')), 'cancelVersion: already canceled')
      })

      it('getVersion should ignore canceled version', async () => {
        // ignore entries in the past 150 seconds
        const { version, value } = await oracle.getVersion(string32('id'), string32(''), 150)
        const versionStr = bytes32toString(version)
        assert.deepEqual({ versionStr, value }, { versionStr: 'ver', value: 'value' })
      })

      context('#getAllVersions', () => {
        it('should return all versions', async () => {
          const ret = await oracle.getAllVersions(string32('id'), 10)
          const count = ret[0].toNumber()
          assert.equal(count, 3)

          const versions = ret[1].map((ver: any) => ({
            time: ver.time,
            canceled: ver.canceled,
            version: bytes32toString(ver.version),
            value: ver.value
          }))

          assert.closeTo(now - versions[0].time, 100, 2)
          assert.closeTo(now - versions[1].time, 200, 2)

          assert.deepInclude(versions[0], { version: 'ver3', value: 'value3', canceled: false })
          assert.deepInclude(versions[1], { version: 'ver2', value: 'value2', canceled: true })
          assert.deepInclude(versions[2], { version: 'ver', value: 'value', canceled: false })
          assert.deepInclude(versions[3], { version: '', value: '', canceled: false })
        })

        it('should return some versions if buffer too small', async () => {
          const ret = await oracle.getAllVersions(string32('id'), 2)
          const count = ret[0].toNumber()
          assert.equal(count, 2)

          const versions = ret[1].map((ver: any) => ({
            time: ver.time,
            canceled: ver.canceled,
            version: bytes32toString(ver.version),
            value: ver.value
          }))

          assert.deepInclude(versions[0], { version: 'ver3', value: 'value3', canceled: false })
          assert.deepInclude(versions[1], { version: 'ver2', value: 'value2', canceled: true })
        })
      })
    })
  })
})
