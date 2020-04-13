const assert = require('chai').use(require('chai-as-promised')).assert
// const ServerHelper = require('../src/relayclient/ServerHelper')
class ServerHelper {}
const HttpWrapper = require('../src/relayclient/HttpWrapper')
const http = require('http')
const testutils = require('./TestUtils')
const registerNewRelay = testutils.registerNewRelay
const increaseTime = testutils.increaseTime

const RelayHub = artifacts.require('./RelayHub.sol')

const localhostOne = 'http://localhost:8090'
const gasPricePercent = 20

// ServerHelper adds "noise" to shuffle requests with the same score.
// this will prevent this randomness, to make tests deterministic.
const noRandomness = () => 0.5

function mockserver (port, data) {
  const s = http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.write(JSON.stringify(data))
    res.end()
  })
  s.listen(port)
  return s
}

contract.skip('ServerHelper', function (accounts) {
  const minStake = 1.5e18
  const minDelay = 3600 * 24 * 10
  const httpWrapper = new HttpWrapper()
  const serverHelper = new ServerHelper(httpWrapper, {}, {
    minStake,
    minDelay,
    verbose: false,
    addScoreRandomness: noRandomness
  })
  let rhub
  let relayproc

  before(async function () {
    rhub = await RelayHub.deployed()
    relayproc = await testutils.startRelay(rhub, {
      verbose: process.env.relaylog,
      stake: 2e18,
      delay: 3600 * 24 * 10,
      pctRelayFee: 12,
      url: 'asd',
      relayOwner: accounts[0],
      EthereumNodeUrl: web3.currentProvider.host,
      GasPricePercent: gasPricePercent
    })
    serverHelper.setHub(rhub.contract)
  })

  after(async function () {
    await testutils.stopRelay(relayproc)
  })

  describe('with running relay hub', function () {
    // Note: a real relay server is not registered in this context
    before('registering relays', async function () {
      // unstake delay too low
      await registerNewRelay({
        relayHub: rhub,
        stake: 2e18,
        delay: 3600 * 24 * 7,
        baseRelayFee: 0,
        pctRelayFee: 20,
        url: 'https://abcd1.com',
        relayAccount: accounts[7],
        ownerAccount: accounts[0]
      })
      // unregistered
      await registerNewRelay({
        relayHub: rhub,
        stake: 2e18,
        delay: 3600 * 24 * 7 * 2,
        baseRelayFee: 0,
        pctRelayFee: 2,
        url: 'https://abcd2.com',
        relayAccount: accounts[2],
        ownerAccount: accounts[0]
      })
      // stake too low
      await registerNewRelay({
        relayHub: rhub,
        stake: 1e18,
        delay: 3600 * 24 * 7 * 2,
        baseRelayFee: 0,
        pctRelayFee: 20,
        url: 'https://abcd3.com',
        relayAccount: accounts[3],
        ownerAccount: accounts[0]
      })

      // Added, removed, added again - go figure.
      // 2 x will not ping
      await registerNewRelay({
        relayHub: rhub,
        stake: 2e18,
        delay: 3600 * 24 * 7 * 2,
        baseRelayFee: 0,
        pctRelayFee: 15,
        url: 'https://abcd4.com',
        relayAccount: accounts[4],
        ownerAccount: accounts[0]
      })
      await rhub.removeRelayByOwner(accounts[4], { from: accounts[0] })
      await increaseTime(3600 * 24 * 7 * 2)
      await rhub.unstake(accounts[4], { from: accounts[0] })
      await registerNewRelay({
        relayHub: rhub,
        stake: 2e18,
        delay: 3600 * 24 * 7 * 2,
        baseRelayFee: 0,
        pctRelayFee: 15,
        url: 'go_resolve_this_address',
        relayAccount: accounts[4],
        ownerAccount: accounts[0]
      })

      await registerNewRelay({
        relayHub: rhub,
        stake: 2e18,
        delay: 3600 * 24 * 7 * 2,
        baseRelayFee: 0,
        pctRelayFee: 30,
        url: 'https://abcd4.com',
        relayAccount: accounts[5],
        ownerAccount: accounts[0]
      })

      await rhub.removeRelayByOwner(accounts[2], { from: accounts[0] })
      await increaseTime(3600 * 24 * 7 * 2)
      await rhub.unstake(accounts[2], { from: accounts[0] })

      serverHelper.setHub(rhub.contract)
    })

    it('should list all relays from relay contract', async function () {
      const relays = await serverHelper.fetchRelaysAdded()
      assert.deepEqual(
        relays.map(relay => relay.relayUrl),
        [localhostOne, 'go_resolve_this_address', 'https://abcd4.com']
      )
    })

    it('should discover a relay from the relay contract', async function () {
      const pinger = await serverHelper.newActiveRelayPinger()
      const relay = await pinger.nextRelay()
      assert.equal(localhostOne, relay.relayUrl)
    })

    it('should discover preferred relay first', async () => {
      let mockrelay
      try {
        const mockport = 12345
        mockrelay = mockserver(mockport, {
          RelayServerAddress: '0x' + 'a'.repeat(40),
          MinGasPrice: 1111000000,
          Ready: true,
          Version: '0.4.2'
        })
        serverHelper.preferredRelays = [
          'http://localhost:19999', // a preferred relay, but missing..
          'http://localhost:' + mockport
        ]
        await serverHelper.fetchRelaysAdded()
        console.log('list=', serverHelper.filteredRelays)
        const pinger = await serverHelper.newActiveRelayPinger()
        let relay = await pinger.nextRelay()
        assert.equal('http://localhost:12345', relay.relayUrl)
        relay = await pinger.nextRelay()
        assert.equal(localhostOne, relay.relayUrl)
      } finally {
        serverHelper.preferredRelays = undefined
        mockrelay.close()
      }
    })
  })

  describe('with mock http wrapper', function () {
    // mock for HttpWrapper: instead of sending any ping, the URL is expected to be a json. (ignoring the "getaddr" suffix)
    // if it contains "error", then return it as error. otherwise, its the http send response.
    class MockHttpWrapper {
      constructor () {
        this.pinged = 0
      }

      send (url, jsonRequestData, callback) {
        const relayInfo = JSON.parse(url.replace(/\/\w+$/, ''))

        this.pinged++

        if (relayInfo.error) {
          setTimeout(() => callback(new Error(url), null), 0)
        } else {
          setTimeout(() => callback(null, relayInfo), 0)
        }
      }
    }

    it('RelaySelectionManager should keep trying find a relay after 6 broken (high gas, not ready) relays', async function () {
      const mockRelays = [
        { relayUrl: 'url1', error: 'failed relay1', stake: 1, unstakeDelay: 1 },
        { relayUrl: 'url2', Ready: false, stake: 1, unstakeDelay: 1 },
        { relayUrl: 'url3', error: 'failed relay1', stake: 1, unstakeDelay: 1 },
        { relayUrl: 'url4', MinGasPrice: 1e20, Ready: true, stake: 1, unstakeDelay: 1 },
        { relayUrl: 'url5', MinGasPrice: 1, Ready: true, stake: 1, unstakeDelay: 1 },
        { relayUrl: 'url6', Ready: false, stake: 1, unstakeDelay: 1 },
        { relayUrl: 'url7', MinGasPrice: 1, Ready: true, stake: 1, unstakeDelay: 1 }
      ]

      mockRelays.forEach(r => {
        r.relayUrl = JSON.stringify(r)
      })

      const mockHttpWrapper = new MockHttpWrapper(mockRelays)

      const pinger = new serverHelper.ActiveRelayPinger(mockRelays, mockHttpWrapper, 100)

      // should skip the bad relays, 3 at a time, and reach relay 5
      const r = await pinger.nextRelay()
      // validate its "url5" that got returned (the other were rejected)
      assert.equal('url5', JSON.parse(r.relayUrl).relayUrl)
      // make sure we totally tried exactly 6 relays (we ping in triplets)
      assert.equal(6, mockHttpWrapper.pinged)
    })
  })

  describe('with mock relay hub', function () {
    // let minStake = 1.5e18
    // let minDelay = 10

    const mockRelayAddedEvents = [
      { relay: '1' },
      { relay: '2' },
      { relay: '3' },
      { relay: '4', unstakeDelay: 3600 * 24 * 7 }, // dropped out by default, below minDelay
      { relay: '5', stake: 1e18, pctRelayFee: 1e5 }, // dropped out by default, below minStake
      { relay: '6', stake: 3e18, pctRelayFee: 1e9 },
      { relay: '7', pctRelayFee: 1e7 }
    ].map(relay => ({
      event: 'RelayAdded',
      returnValues: Object.assign({}, {
        pctRelayFee: 1e10,
        url: `url-${relay.relay}`,
        stake: 2e18,
        unstakeDelay: 3600 * 24 * 14
      }, relay)
    }))

    beforeEach('set mock relay hub', function () {
      this.originalRelayHub = serverHelper.relayHubInstance
      this.mockRelayHub = { getPastEvents: () => mockRelayAddedEvents }
      serverHelper.setHub(this.mockRelayHub)
    })

    afterEach('restore original relay hub', function () {
      serverHelper.setHub(this.originalRelayHub)
    })

    it('should use default strategy for filtering and sorting relays', async function () {
      // 4 & 5 are dropped out due low unstakeDelay and stake
      // 7 & 6 go first due to lower transaction fee (1e7 and 1e9, vs 1e10 of the rest)
      const relays = await serverHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['7', '6', '1', '2', '3'])
    })

    it('should not filter relays if minimum values not set', async function () {
      // 4 & 5 are not filtered out since no restrictions on minimum delay or stake are set
      // 5, 7 & 6 go first due to lower transaction fee (1e5, 1e7, and 1e9, vs 1e10 of the rest)
      const customServerHelper = new ServerHelper(httpWrapper, {}, { addScoreRandomness: noRandomness })
      customServerHelper.setHub(this.mockRelayHub)
      const relays = await customServerHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['5', '7', '6', '1', '2', '3', '4'])
    })

    it('preferredRelays can be a url or an array', () => {
      assert.deepEqual(['url'], new ServerHelper(httpWrapper, {}, { preferredRelays: 'url' }).preferredRelays)
      assert.deepEqual(['url1', 'url2'], new ServerHelper(httpWrapper, {}, { preferredRelays: ['url1', 'url2'] }).preferredRelays)
    })

    it('should use custom strategy for filtering and sorting relays', async function () {
      // 1, 2, 3, & 4 are filtered out due to the custom strategy of filtering by address (only > 4)
      // 6, 7 & 5 are sorted based on stake (3e18, 2e18 & 1e18 respectively)
      const customServerHelper = new ServerHelper(httpWrapper, {}, {
        relayFilter: (relay) => (relay.address > '4'),
        calculateRelayScore: (r) => r.stake,
        addScoreRandomness: noRandomness
      })
      customServerHelper.setHub(this.mockRelayHub)
      const relays = await customServerHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['6', '7', '5'])
    })

    // TODO: this tests depend on Node 10.x implementation of 'sort', and break on later versions:
    // https://github.com/nodejs/node/issues/27871
    it.skip('should use randomness to shuffle results with same score', async function () {
      var seed = 2

      function myRandom () {
        var x = Math.sin(seed++) * 10000
        return x - Math.floor(x)
      }

      // no randomness: should return them all in order
      const customServerHelper = new ServerHelper(httpWrapper, {}, {
        calculateRelayScore: (r) => r.address > '4' ? 2 : 1, // 2 score levels
        addScoreRandomness: noRandomness
      })
      customServerHelper.setHub(this.mockRelayHub)
      let relays = await customServerHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['5', '6', '7', '1', '2', '3', '4'])

      // added randomness: should be shuffled
      customServerHelper.addScoreRandomness = myRandom
      relays = await customServerHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['6', '7', '5', '4', '2', '1', '3'])
    })

    it('should down-score failed relays', async function () {
      const failedRelays = {}

      const customServerHelper = new ServerHelper(httpWrapper, failedRelays, {
        addScoreRandomness: noRandomness
      })

      customServerHelper.setHub(this.mockRelayHub)

      let relays = await customServerHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['5', '7', '6', '1', '2', '3', '4'])

      // recently failed. should be at the end of the list
      failedRelays['url-2'] = { lastError: new Date().getTime() - 60 }

      relays = await customServerHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['5', '7', '6', '1', '3', '4', '2'])

      // failed a long time ago. should return to its normal place (and removed from failed list)
      failedRelays['url-2'] = { lastError: new Date().getTime() - 1000 * 3600 }
      relays = await customServerHelper.fetchRelaysAdded()
      assert.deepEqual(relays.map(r => r.address), ['5', '7', '6', '1', '2', '3', '4'])

      assert.deepEqual(failedRelays, {})
    })
  })
})
