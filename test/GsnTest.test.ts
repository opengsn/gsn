import GsnTest from '../src/relayclient/GsnTest'
import { HttpProvider } from 'web3-core'

contract('GsnTest', function () {
  it('should throw if did not call start', function () {
    expect(() => {
      GsnTest.getTestEnvironment()
    }).to.throw('You must call `await GsnTest.start()` first!')
  })

  it('should create a valid test environment for other tests to rely on', async function () {
    const host = (web3.currentProvider as HttpProvider).host
    await GsnTest.start(host)
    const testEnv = GsnTest.getTestEnvironment()
    assert.equal(testEnv.deployment.relayHubAddress.length, 42)
  })
})
