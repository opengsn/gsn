import { expect } from 'chai'
import { RelayRegistrarInstance, TestRelayHubForRegistrarInstance } from '@opengsn/contracts'
import { cleanValue } from './chaiHelper'
import { evmMine, evmMineMany, revert, snapshot } from '../TestUtils'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { constants, splitRelayUrlForRegistrar } from '@opengsn/common'

const TestRelayHubForRegistrar = artifacts.require('TestRelayHubForRegistrar')
const RelayRegistrar = artifacts.require('RelayRegistrar')

contract('RelayRegistrar', function ([_, relay1, relay2, relay3, relay4]) {
  const splitUrl = splitRelayUrlForRegistrar('http://relay')
  const splitUrl2 = splitRelayUrlForRegistrar('http://relay2')
  const splitUrl4 = splitRelayUrlForRegistrar('http://relay4')
  const relay1Info = {
    relayManager: relay1,
    baseRelayFee: '111',
    pctRelayFee: '1111',
    urlParts: splitUrl
  }
  const relay2Info = {
    relayManager: relay2,
    baseRelayFee: '222',
    pctRelayFee: '2222',
    urlParts: splitUrl2
  }
  const relay3Info = {
    relayManager: relay3,
    baseRelayFee: '333',
    pctRelayFee: '3333',
    urlParts: splitUrl
  }
  const relay4Info = {
    relayManager: relay4,
    baseRelayFee: '444',
    pctRelayFee: '4444',
    urlParts: splitUrl4
  }
  const emptyInfo = {
    relayManager: constants.ZERO_ADDRESS,
    baseRelayFee: '0',
    pctRelayFee: '0',
    // urlParts: splitRelayUrlForRegistrar('')
    urlParts: ['0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    ]
  }
  // remove block number, to make the test deterministic..
  function cleanBlockNumbers (info: any): void {
    info.forEach((item: any) => {
      delete item.lastSeenBlockNumber
      delete item.firstSeenBlockNumber
    })
  }

  let id: string
  let relayHubOne: TestRelayHubForRegistrarInstance
  let relayHubTwo: TestRelayHubForRegistrarInstance
  let relayRegistrar: RelayRegistrarInstance
  let firstSeenBlockNumber: number
  let lastSeenBlockNumber: number

  before(async function () {
    relayHubOne = await TestRelayHubForRegistrar.new()
    relayHubTwo = await TestRelayHubForRegistrar.new()
    await relayHubOne.setRelayManagerStaked(relay1, true)
    await relayHubTwo.setRelayManagerStaked(relay1, true)
    relayRegistrar = await RelayRegistrar.new(true)
  })

  beforeEach(async function () {
    id = (await snapshot()).result
  })

  afterEach(async function () {
    await revert(id)
  })

  context('#registerRelayServer()', function () {
    it('should fail to register if the Relay Manager does not get approved by the RelayHub', async function () {
      await relayHubOne.setRelayManagerStaked(relay1, false)
      await expectRevert(relayRegistrar.registerRelayServer(relayHubOne.address, 1, 2, splitUrl, { from: relay1 }), 'verifyCanRegister: cannot')
    })

    it('should store the relay details on-chain and emit an event', async function () {
      const { tx } = await relayRegistrar.registerRelayServer(relayHubOne.address, 111, 1111, splitUrl, { from: relay1 })
      await expectEvent.inTransaction(tx, RelayRegistrar, 'RelayServerRegistered', {
        relayManager: relay1,
        baseRelayFee: '111',
        pctRelayFee: '1111',
        relayUrl: splitUrl
      })
      let info = await relayRegistrar.getRelayInfo(relayHubOne.address, relay1)
      info = cleanValue(info)
      cleanBlockNumbers([info])
      expect(info).to.eql(relay1Info)
    })

    context('with multiple re-registrations by a single relay', function () {
      before(async function () {
        await relayRegistrar.registerRelayServer(relayHubOne.address, 210, 220, splitUrl2, { from: relay1 })
        firstSeenBlockNumber = await web3.eth.getBlockNumber()
        await evmMineMany(2)
        await relayRegistrar.registerRelayServer(relayHubOne.address, 21, 22, splitUrl2, { from: relay1 })
        await evmMineMany(2)
        await relayRegistrar.registerRelayServer(relayHubOne.address, 121, 122, splitUrl2, { from: relay1 })
        lastSeenBlockNumber = await web3.eth.getBlockNumber()
      })

      it('should save first registration block number and last registration block number', async () => {
        const info = await relayRegistrar.getRelayInfo(relayHubOne.address, relay1)
        expect(info.lastSeenBlockNumber).to.eql(lastSeenBlockNumber)
        expect(info.firstSeenBlockNumber).to.eql(firstSeenBlockNumber)
      })
    })
  })

  context('#readRelayInfos()', function () {
    context('with multiple relays across multiple RelayHubs', function () {
      let oldestBlock: number
      before(async function () {
        await relayHubOne.setRelayManagerStaked(relay2, true)
        await relayHubTwo.setRelayManagerStaked(relay3, true)
        await relayHubOne.setRelayManagerStaked(relay4, true)
        await relayRegistrar.registerRelayServer(relayHubOne.address, 111, 1111, splitUrl, { from: relay1 })
        await relayRegistrar.registerRelayServer(relayHubTwo.address, 111, 1111, splitUrl, { from: relay1 })
        await relayRegistrar.registerRelayServer(relayHubOne.address, 222, 2222, splitUrl, { from: relay2 })
        await evmMine()
        oldestBlock = await web3.eth.getBlockNumber()
        await relayRegistrar.registerRelayServer(relayHubTwo.address, 333, 3333, splitUrl, { from: relay3 })
        await relayRegistrar.registerRelayServer(relayHubOne.address, 444, 4444, splitUrl, { from: relay4 })
      })

      it('should read all relays relevant for this hub', async () => {
        const ret = await relayRegistrar.readRelayInfos(relayHubOne.address, 0, 5) as any
        let { info, filled } = ret
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay1Info, relay2Info, relay4Info])
        expect(filled).to.eql(3)
      })

      it('should read all relays relevant for that hub', async () => {
        const ret = await relayRegistrar.readRelayInfos(relayHubTwo.address, 0, 5) as any
        let { info, filled } = ret
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay1Info, relay3Info])
        expect(filled).to.eql(2)
      })

      it('should not include relays last re-registered before oldestBlock, but have empty elements left (leaked implementation detail)', async function () {
        const ret = await relayRegistrar.readRelayInfos(relayHubOne.address, oldestBlock, 5) as any
        let { info, filled } = ret
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay4Info, emptyInfo, emptyInfo])
        expect(filled).to.eql(1)
      })

      it('should not include relays that fail verifyRelayManagerStaked', async function () {
        await relayHubOne.setRelayManagerStaked(relay2, false)
        const ret = await relayRegistrar.readRelayInfos(relayHubOne.address, 0, 5) as any
        let { info, filled } = ret
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay1Info, relay4Info, emptyInfo])
        expect(filled).to.eql(2)
      })
    })
  })

  context('#getRelayInfo()', function () {
    let firstSeenBlockNumber: number

    before(async function () {
      await relayRegistrar.registerRelayServer(relayHubOne.address, 111, 222, splitUrl, { from: relay1 })
      firstSeenBlockNumber = await web3.eth.getBlockNumber()
    })

    it('should revert if such relay is not registered for this hub', async function () {
      await expectRevert(relayRegistrar.getRelayInfo(relayHubTwo.address, relay4), 'relayManager not found')
    })

    it('should return all the registration details', async () => {
      const info = await relayRegistrar.getRelayInfo(relayHubOne.address, relay1)
      expect(info.lastSeenBlockNumber).to.eql(firstSeenBlockNumber)
      expect(info.baseRelayFee).to.eql(111)
      expect(info.pctRelayFee).to.eql(222)
      expect(info.urlParts).to.eql(splitUrl)
      expect(info.relayManager).to.eql(relay1)
    })
  })
})
