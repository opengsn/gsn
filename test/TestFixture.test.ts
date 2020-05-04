import GsnTest from '../src/relayclient/GsnTest'

contract('TestFixture', function () {
  it('should throw if did not call start', function () {
    expect(() => {
      GsnTest.getTestEnvironment()
    }).to.throw('You must call `await GsnTest.start()` first!')
  })

  it('should create a valid test environment for other tests to rely on', async function () {
    await GsnTest.start()
    const testEnv = GsnTest.getTestEnvironment()
    assert.equal(testEnv.deployment.relayHubAddress.length, 42)
  })
})
