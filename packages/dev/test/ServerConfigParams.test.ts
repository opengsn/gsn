import {
  entriesToObj,
  filterMembers,
  filterType,
  parseServerConfig,
  resolveServerConfig,
  ServerConfigParams,
  serverDefaultConfiguration,
  validateBalanceParams
} from '@opengsn/relay/dist/ServerConfigParams'
import * as fs from 'fs'
import { expectRevert } from '@openzeppelin/test-helpers'

import { StaticJsonRpcProvider } from '@ethersproject/providers'

import {
  RelayHubInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { constants } from '@opengsn/common'
import { deployHub } from './TestUtils'

function expectThrow (func: () => void, match: string): void {
  try {
    func()
  } catch (e: any) {
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

    it('should throw on invalid type of cmdline param', function () {
      expectThrow(() => parseServerConfig(['--devMode=asd'], {}), 'Invalid boolean: devMode')
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
      fs.writeFileSync(tmpConfigfile, '{"checkInterval":123, "alertedDelaySeconds":234, "port":345}')
      assert.deepEqual(
        parseServerConfig(['--config', tmpConfigfile, '--port', '111'], { alertedDelaySeconds: 222 }),
        { alertedDelaySeconds: 222, config: tmpConfigfile, checkInterval: 123, port: 111 })
    })

    it('should parse numeric params', async function () {
      fs.writeFileSync(tmpConfigfile, JSON.stringify({ gasPriceFactor: 1.2 }))
      assert.deepEqual(
        parseServerConfig(['--config', tmpConfigfile], {}),
        { config: tmpConfigfile, gasPriceFactor: 1.2 })
    })
    it('should accept all known params in config file', async function () {
      fs.writeFileSync(tmpConfigfile, JSON.stringify(serverDefaultConfiguration))
      try {
        parseServerConfig(['--config', tmpConfigfile], {})
      } catch (e: any) {
        assert.fail(e)
      }
    })
  })

  context('_validateBalanceParams', function () {
    it('should throw if workerMinBalance > workerTargetBalance', function () {
      const config: ServerConfigParams = {
        ...serverDefaultConfiguration,
        workerTargetBalance: 1e18,
        workerMinBalance: 2e18
      }
      try {
        validateBalanceParams(config)
        assert.fail()
      } catch (e: any) {
        assert.include(e.message, 'workerTargetBalance must be at least workerMinBalance')
      }
    })
    it('should throw if managerMinBalance > managerTargetBalance', function () {
      const config: ServerConfigParams = {
        ...serverDefaultConfiguration,
        managerTargetBalance: 1e18,
        managerMinBalance: 2e18
      }
      try {
        validateBalanceParams(config)
        assert.fail()
      } catch (e: any) {
        assert.include(e.message, 'managerTargetBalance must be at least managerMinBalance')
      }
    })
    it('should throw if managerTargetBalance + workerTargetBalance > withdrawToOwnerOnBalance', function () {
      const config: ServerConfigParams = {
        ...serverDefaultConfiguration,
        managerTargetBalance: 1e18,
        workerTargetBalance: 1e18,
        withdrawToOwnerOnBalance: 1.9e18
      }
      try {
        validateBalanceParams(config)
        assert.fail()
      } catch (e: any) {
        assert.include(e.message, 'withdrawToOwnerOnBalance must be larger than managerTargetBalance + workerTargetBalance')
      }
    })
    it('should not throw on serverDefaultConfiguration', function () {
      validateBalanceParams(serverDefaultConfiguration)
    })
    it('should not throw on valid balance parameters with/without owner withdrawal', function () {
      const config: ServerConfigParams = {
        ...serverDefaultConfiguration,
        managerTargetBalance: 1e18,
        workerTargetBalance: 1e18,
        workerMinBalance: 0.5e18,
        managerMinBalance: 0.5e18
      }
      validateBalanceParams(config)
      config.withdrawToOwnerOnBalance = 4e18
      validateBalanceParams(config)
    })
  })

  context('#resolveServerConfig', () => {
    // @ts-ignore
    const currentProviderHost = web3.currentProvider.host
    const provider = new StaticJsonRpcProvider(currentProviderHost)
    it('should fail on missing hub/oracle', async () => {
      await expectRevert(resolveServerConfig({}, provider), 'missing param: must have relayHubAddress')
    })

    it('should fail on invalid relayhub address', async () => {
      // ethers.js considers invalid addresses to be ENS names
      const config = { relayHubAddress: '123' }
      await expectRevert(resolveServerConfig(config, provider),
        'network does not support ENS')
    })

    it('should fail on no-contract relayhub address', async () => {
      const config = { relayHubAddress: addr(1) }
      await expectRevert(resolveServerConfig(config, provider),
        'RelayHub: no contract at address 0x1111111111111111111111111111111111111111')
    })

    contract('Mandatory parameters', () => {
      let hub: RelayHubInstance
      before(async () => {
        hub = await deployHub(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, '0')
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

      it('should fail on whitelisting paymaster or recipient addresses for public relay', async () => {
        const fullConfig: Partial<ServerConfigParams> = {
          relayHubAddress: hub.address,
          url: 'fake.url.com',
          workdir: '/path/to/somewhere/',
          ownerAddress: constants.BURN_ADDRESS,
          managerStakeTokenAddress: constants.BURN_ADDRESS
        }
        let config: Partial<ServerConfigParams> = { whitelistedPaymasters: ['something'], ...fullConfig }
        await expectRevert(resolveServerConfig(config, provider), 'Cannot whitelist recipients or paymasters on a public Relay Server')
        config = { whitelistedRecipients: ['something'], ...fullConfig }
        await expectRevert(resolveServerConfig(config, provider), 'Cannot whitelist recipients or paymasters on a public Relay Server')
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
          managerStakeTokenAddress: '0x1111111111111111111111111111111111111111',
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
