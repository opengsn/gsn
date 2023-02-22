import { HttpWrapper } from '@opengsn/common'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

const { expect, assert } = chai.use(chaiAsPromised)

describe('HttpWrapper', () => {
  it('connect to node, get version', async () => {
    const http = new HttpWrapper()
    // @ts-ignore
    const url = web3.currentProvider.host
    const res = await http.sendPromise(url, {
      jsonrpc: '2.0',
      method: 'net_version',
      id: 123
    })

    assert.equal(123, res.id, JSON.stringify(res)) // just verify its a valid response
  })

  it('should fail on connection refused', async () => {
    const http = new HttpWrapper()
    const res = http.sendPromise(new URL('http://localhost:44321'), {
      jsonrpc: '2.0',
      method: 'net_version',
      id: 123
    })
    // @ts-ignore
    await expect(res).to.be.eventually.rejectedWith({ error: 'connect ECONNREFUSED 127.0.0.1:44321' })
  })

  it('should pass timeout to provider', async () => {
    // This test should be removed. It checks axios functionality.
    const http = new HttpWrapper({ timeout: 1234 })
    // @ts-ignore
    assert.equal(http.provider.defaults.timeout, 1234)
  })
})
