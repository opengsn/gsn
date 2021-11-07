import {
  entriesToObj,
  filterMembers,
  filterType,
  parseServerConfig,
  resolveServerConfig,
  serverDefaultConfiguration
} from '@opengsn/relay/dist/ServerConfigParams'
import * as fs from 'fs'
import { expectRevert } from '@openzeppelin/test-helpers'
import {
  RelayHubInstance,
  VersionRegistryInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { string32 } from '@opengsn/common/dist/VersionRegistry'
import { constants } from '@opengsn/common/dist'
import { deployHub } from './TestUtils'

require('source-map-support').install({ errorFormatterForce: true })
const VersionRegistryContract = artifacts.require('VersionRegistry')

function expectThrow (func: () => void, match: string): void {
  try {
    func()
  } catch (e) {
    assert.include(e.toString(), match)
    return
  }
  assert.fail('expected to fail with: ' + match)
}

function addr (n: number): string {
  return '0x'.padEnd(42, n.toString())
}

context('#ServerConfigParams', () => {
  context('utils', () => {
    it('#filterType', () => {
      assert.deepEqual(
        filterType({ a: 'number', b: 'string', c: 'number' }, 'number'),
        ['a', 'c'])
    })
    it('#entriesToObj', () => {
      const a = { x: 1, y: 2, z: { a: 11, b: 22 } }
      assert.deepEqual(a, entriesToObj(Object.entries(a)))
    })

    it('#filterMembers', () => {
      const a = { x: 1, y: 2, z: 3 }
      const config = { x: 'number', y: 'string' }

      assert.deepEqual(filterMembers(a, config), { x: 1, y: 2 })
    })
  })

  context('#parseServerConfig', () => {
    const tmpConfigfile = '/tmp/test.configfile.tmp'
    after(() => {
      if (fs.existsSync(tmpConfigfile)) {
        fs.unlinkSync(tmpConfigfile)
      }
    })
    it('should parse command line params', function () {
      assert.deepEqual(
        parseServerConfig(['--devMode=true', '--relayHubAddress=123'], {}),
        { devMode: true, relayHubAddress: '123' })
    })

    it('cmdline should override env, which should override file', async () => {
      fs.writeFileSync(tmpConfigfile, JSON.stringify({ url: 'fileparam' }))
      const env = { url: 'envparam' }
      // just file
      assert.deepInclude(
        parseServerConfig(['--config', tmpConfigfile], {}),
        { url: 'fileparam' })
      // file+env
      assert.deepInclude(
        parseServerConfig(['--config', tmpConfigfile], env),
        { url: 'envparam' })
      // file+env+cmdline
      assert.deepInclude(
        parseServerConfig(['--config', tmpConfigfile, '--url', 'cmdparam'], env),
        { url: 'cmdparam' })
    })

    it('should use env as defaults', function () {
      assert.deepEqual(
        parseServerConfig(['--devMode=true', '--relayHubAddress=123'], {
          relayHubAddress: 'hubFromEnv',
          url: 'urlFromEnv'
        }),
        { devMode: true, relayHubAddress: '123', url: 'urlFromEnv' })
    })

    it('should throw on unknown cmdline param', function () {
      expectThrow(() => parseServerConfig(['--asdasd'], {}), 'unexpected param asdasd')
    })

    it.skip('should throw on invalid type of cmdline param', function () {
      expectThrow(() => parseServerConfig(['--debug=asd'], {}), 'Invalid boolean: debug')
    })

    it('should throw on missing config file', function () {
      expectThrow(() => parseServerConfig(['--config=nosuchfile'], {}), 'unable to read config file')
    })

    it('should abort on invalid config file', function () {
      fs.writeFileSync(tmpConfigfile, 'asdasd')
      expectThrow(() => parseServerConfig(['--config', tmpConfigfile], {}), 'SyntaxError')
    })

    it('should abort on unknown param in config file', function () {
      fs.writeFileSync(tmpConfigfile, '{"asd":123}')
      expectThrow(() => parseServerConfig(['--config', tmpConfigfile], {}), 'unexpected param asd')
    })

    it('should read param from file if no commandline or env', function () {
      fs.writeFileSync(tmpConfigfile, '{"pctRelayFee":123, "baseRelayFee":234, "port":345}')
      assert.deepEqual(
        parseServerConfig(['--config', tmpConfigfile, '--port', '111'], { baseRelayFee: 222 }),
        { baseRelayFee: 222, config: tmpConfigfile, pctRelayFee: 123, port: 111 })
    })

    it('should accept all known params in config file', async function () {
      fs.writeFileSync(tmpConfigfile, JSON.stringify(serverDefaultConfiguration))
      try {
        parseServerConfig(['--config', tmpConfigfile], {})
      } catch (e) {
        assert.fail(e)
      }
    })
  })
  context('#resolveServerConfig', () => {
    const provider = web3.currentProvider
    it('should fail on missing hub/oracle', async () => {
      await expectRevert(resolveServerConfig({}, provider), 'missing param: must have either relayHubAddress or versionRegistryAddress')
    })

    it('should fail on invalid relayhub address', async () => {
      const config = { relayHubAddress: '123' }
      await expectRevert(resolveServerConfig(config, provider),
        'Provided address "123" is invalid, the capitalization checksum test failed, or its an indrect IBAN address which can\'t be converted')
    })

    it('should fail on no-contract relayhub address', async () => {
      const config = { relayHubAddress: addr(1) }
      await expectRevert(resolveServerConfig(config, provider),
        'RelayHub: no contract at address 0x1111111111111111111111111111111111111111')
    })

    it('should fail on missing hubid for VersionRegistry', async () => {
      const config = { versionRegistryAddress: addr(1) }
      await expectRevert(resolveServerConfig(config, provider), 'missing param: relayHubId to read from VersionRegistry')
    })

    it('should fail on no-contract VersionRegistry address', async () => {
      const config = { versionRegistryAddress: addr(1), relayHubId: 'hubid' }
      await expectRevert(resolveServerConfig(config, provider),
        'Invalid param versionRegistryAddress: no contract at address 0x1111111111111111111111111111111111111111')
    })

    contract('with VersionRegistry', () => {
      let oracle: VersionRegistryInstance

      before(async () => {
        oracle = await VersionRegistryContract.new()
        await oracle.addVersion(string32('hub-invalidaddr'), string32('1.0'), 'garbagevalue')
        await oracle.addVersion(string32('hub-nocontract'), string32('1.0'), addr(2))
        await oracle.addVersion(string32('hub-wrongcontract'), string32('1.0'), oracle.address)
      })

      it('should fail on invalid hub address in oracle', async () => {
        const config = { versionRegistryAddress: oracle.address, relayHubId: 'hub-invalidaddr' }
        await expectRevert(resolveServerConfig(config, provider),
          'Invalid param relayHubId hub-invalidaddr @ 1.0: not an address: garbagevalue')
      })

      it('should fail on no contract at hub address in oracle', async () => {
        const config = { versionRegistryAddress: oracle.address, relayHubId: 'hub-nocontract' }
        await expectRevert(resolveServerConfig(config, provider),
          'RelayHub: no contract at address 0x2222222222222222222222222222222222222222')
      })
    })

    contract('Mandatory parameters', () => {
      let hub: RelayHubInstance
      before(async () => {
        hub = await deployHub(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS)
      })

      it('should fail on missing url', async () => {
        const config = { relayHubAddress: hub.address }
        await expectRevert(resolveServerConfig(config, provider), 'missing param: url')
      })

      it('should fail on missing workdir', async () => {
        const config = { relayHubAddress: hub.address, url: 'fake.url.com' }
        await expectRevert(resolveServerConfig(config, provider), 'missing param: workdir')
      })

      it('should fail on missing owner address', async () => {
        const config = { relayHubAddress: hub.address, url: 'fake.url.com', workdir: '/path/to/somewhere/' }
        await expectRevert(resolveServerConfig(config, provider), 'missing param: ownerAddress')
      })

      it('should fail on zero owner address', async () => {
        const config = {
          relayHubAddress: hub.address,
          url: 'fake.url.com',
          workdir: '/path/to/somewhere/',
          ownerAddress: constants.ZERO_ADDRESS
        }
        await expectRevert(resolveServerConfig(config, provider), 'missing param: ownerAddress')
      })

      it('should succeed on valid config', async () => {
        const config = {
          relayHubAddress: hub.address,
          url: 'fake.url.com',
          workdir: '/path/to/somewhere/',
          ownerAddress: '0x1111111111111111111111111111111111111111'
        }
        await resolveServerConfig(config, provider)
      })
    })
  })
})
