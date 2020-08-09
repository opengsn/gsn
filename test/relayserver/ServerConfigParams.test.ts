import {entriesToObj, filterMembers, filterType, parseServerConfig} from '../../src/relayserver/ServerConfigParams'
import * as fs from "fs";

function expectThrow(func: () => void, match: string) {
  try {
    func()
  } catch (e) {
    assert.include(e.toString(), match)
    return
  }
  assert.fail('expected to fail with: ' + match)
}

context('#ServerConfigParams', () => {

  context('utils', () => {
    it('#filterType', () => {
      assert.deepEqual(
        filterType({a: 'number', b: 'string', c: 'number'}, 'number'),
        ['a', 'c'])
    })
    it('#entriesToObj', () => {
      const a = {x: 1, y: 2, z: {a: 11, b: 22}}
      assert.deepEqual(a, entriesToObj(Object.entries(a)))
    })

    it('#filterMembers', () => {
      const a = {x: 1, y: 2, z: 3}
      const config = {x: 'number', y: 'string'}

      assert.deepEqual(filterMembers(a, config), {x: 1, y: 2})
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
        {devMode: true, relayHubAddress: '123'})
    });
    it('should use env as defaults', function () {
      assert.deepEqual(
        parseServerConfig(['--devMode=true', '--relayHubAddress=123'], {
          relayHubAddress: 'hubFromEnv',
          url: 'urlFromEnv'
        }),
        {devMode: true, relayHubAddress: '123', url: 'urlFromEnv'})
    });
    it('should throw on unknown cmdline param', function () {
      expectThrow(() => parseServerConfig(['--asdasd'], {}), 'unexpected param asdasd')
    });
    it('should throw on invalid type of cmdline param', function () {
      expectThrow(() => parseServerConfig(['--debug=asd'], {}), 'Invalid boolean: debug')
    });
    it('should throw on missing config file', function () {
      expectThrow(() => parseServerConfig(['--config=nosuchfile'], {}), 'unable to read config file')

    });
    it('should abort on invalid config file', function () {
      fs.writeFileSync(tmpConfigfile, "asdasd")
      expectThrow(() => parseServerConfig(['--config', tmpConfigfile], {}), 'SyntaxError')
    });
    it('should abort on unknown param in config file', function () {
      fs.writeFileSync(tmpConfigfile, '{"asd":123}')
      expectThrow(() => parseServerConfig(['--config', tmpConfigfile], {}), 'unexpected param asd')
    });
    it('should read param from file if no commandline or env', function () {
      fs.writeFileSync(tmpConfigfile, '{"pctRelayFee":123, "baseRelayFee":234, "port":345}')
      assert.deepEqual(
        parseServerConfig(['--config', tmpConfigfile, "--port", '111'], {baseRelayFee: 222}),
        {baseRelayFee: 222, config: tmpConfigfile, pctRelayFee: 123, port: 111})

    });
  })
})
