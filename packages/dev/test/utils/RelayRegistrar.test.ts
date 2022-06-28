import { RelayRegistrarInstance, TestRelayHubForRegistrarInstance } from '@opengsn/contracts'
import { expect } from 'chai'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'

import { constants, splitRelayUrlForRegistrar, toNumber } from '@opengsn/common'

import { cleanValue } from './chaiHelper'
import { evmMine, evmMineMany, revert, setNextBlockTimestamp, snapshot } from '../TestUtils'

const TestRelayHubForRegistrar = artifacts.require('TestRelayHubForRegistrar')
const RelayRegistrar = artifacts.require('RelayRegistrar')

// note that due to being very dependent on timestamps, this test does a lot of manual snapshot/reverting
contract('RelayRegistrar', function ([_, relay1, relay2, relay3, relay4]) {
  const splitUrl1 = splitRelayUrlForRegistrar('http://relay1')
  const splitUrl2 = splitRelayUrlForRegistrar('http://relay2')
  const splitUrl4 = splitRelayUrlForRegistrar('http://relay4')
  const relay1Info = {
    relayManager: relay1,
    urlParts: splitUrl1
  }
  const relay2Info = {
    relayManager: relay2,
    urlParts: splitUrl2
  }
  const relay3Info = {
    relayManager: relay3,
    urlParts: splitUrl1
  }
  const relay4Info = {
    relayManager: relay4,
    urlParts: splitUrl4
  }

  // remove block number, to make the test deterministic..
  function cleanBlockNumbers (info: any): void {
    info.forEach((item: any) => {
      delete item.lastSeenBlockNumber
      delete item.firstSeenBlockNumber
      delete item.lastSeenTimestamp
      delete item.firstSeenTimestamp
    })
  }

  let id: string
  let relayHubOne: TestRelayHubForRegistrarInstance
  let relayHubTwo: TestRelayHubForRegistrarInstance
  let relayRegistrar: RelayRegistrarInstance
  let firstSeenTimestamp: string | number
  let lastSeenTimestamp: number
  let firstSeenBlockNumber: number
  let lastSeenBlockNumber: number

  before(async function () {
    relayHubOne = await TestRelayHubForRegistrar.new()
    relayHubTwo = await TestRelayHubForRegistrar.new()
    await relayHubOne.setRelayManagerStaked(relay1, true)
    await relayHubTwo.setRelayManagerStaked(relay1, true)
    relayRegistrar = await RelayRegistrar.new(constants.yearInSec)
    id = (await snapshot()).result
  })

  afterEach(async function () {
    await revert(id)
    id = (await snapshot()).result
  })

  context('#registerRelayServer()', function () {
    it('should fail to register if the Relay Manager does not get approved by the RelayHub', async function () {
      await relayHubOne.setRelayManagerStaked(relay1, false)
      await expectRevert(relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl1, { from: relay1 }), 'onRelayServerRegistered no stake')
    })

    it('should store the relay details on-chain and emit an event', async function () {
      const { tx } = await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl1, { from: relay1 })
      await expectEvent.inTransaction(tx, RelayRegistrar, 'RelayServerRegistered', {
        relayManager: relay1,
        relayUrl: splitUrl1
      })
      let info = await relayRegistrar.getRelayInfo(relayHubOne.address, relay1)
      info = cleanValue(info)
      cleanBlockNumbers([info])
      expect(info).to.eql(relay1Info)
    })

    context('with multiple re-registrations by a single relay', function () {
      before(async function () {
        await expectRevert(relayRegistrar.getRelayInfo(relayHubOne.address, relay1), 'relayManager not found')
        const { receipt } = await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl1, { from: relay1 })
        const block = await web3.eth.getBlock(receipt.blockNumber)
        firstSeenTimestamp = block.timestamp
        firstSeenBlockNumber = await web3.eth.getBlockNumber()
        await evmMineMany(2)
        await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl2, { from: relay1 })
        await evmMineMany(2)
        lastSeenTimestamp = toNumber(firstSeenTimestamp) + 7000
        await setNextBlockTimestamp(lastSeenTimestamp)
        await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl2, { from: relay1 })
        lastSeenBlockNumber = await web3.eth.getBlockNumber()
      })

      it('should save first registration block number and last registration block number', async () => {
        const info = await relayRegistrar.getRelayInfo(relayHubOne.address, relay1)
        expect(info.lastSeenBlockNumber).to.eql(lastSeenBlockNumber)
        expect(info.firstSeenBlockNumber).to.eql(firstSeenBlockNumber)
        expect(info.lastSeenTimestamp).to.eql(lastSeenTimestamp)
        expect(info.firstSeenTimestamp).to.eql(firstSeenTimestamp)
      })
    })
  })

  context('#readRelayInfos()', function () {
    context('with multiple relays across multiple RelayHubs', function () {
      let oldestBlockNumber: number
      let oldestBlockTimestamp: number
      before(async function () {
        await relayHubOne.setRelayManagerStaked(relay2, true)
        await relayHubTwo.setRelayManagerStaked(relay3, true)
        await relayHubOne.setRelayManagerStaked(relay4, true)
        await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl1, { from: relay1 })
        await relayRegistrar.registerRelayServer(relayHubTwo.address, splitUrl1, { from: relay1 })
        await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl2, { from: relay2 })
        await evmMine()
        oldestBlockNumber = await web3.eth.getBlockNumber()
        const block = await web3.eth.getBlock(oldestBlockNumber)
        oldestBlockTimestamp = toNumber(block.timestamp) + 7000
        await setNextBlockTimestamp(oldestBlockTimestamp)
        await relayRegistrar.registerRelayServer(relayHubTwo.address, splitUrl1, { from: relay3 })
        await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl4, { from: relay4 })
        id = (await snapshot()).result
      })

      it('should read all relays relevant for this hub', async () => {
        let info = await relayRegistrar.readRelayInfosInRange(relayHubOne.address, 0, 0, 5) as any
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay1Info, relay2Info, relay4Info])
      })

      it('should read all relays relevant for that hub', async () => {
        let info = await relayRegistrar.readRelayInfosInRange(relayHubTwo.address, 0, 0, 5) as any
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay1Info, relay3Info])
      })

      it('should not include relays last re-registered before oldestBlockNumber', async function () {
        let info = await relayRegistrar.readRelayInfosInRange(relayHubOne.address, oldestBlockNumber, 0, 5) as any
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay4Info])
      })

      it('should not include relays last re-registered before oldestBlockTimestamp', async function () {
        let info = await relayRegistrar.readRelayInfosInRange(relayHubOne.address, 0, oldestBlockTimestamp, 5) as any
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay4Info])
      })

      it('should not include relays that fail verifyRelayManagerStaked', async function () {
        await relayHubOne.setRelayManagerStaked(relay2, false)
        let info = await relayRegistrar.readRelayInfosInRange(relayHubOne.address, 0, 0, 5) as any
        info = cleanValue(info)
        cleanBlockNumbers(info)
        expect(info).to.eql([relay1Info, relay4Info])
      })
    })
  })

  context('#getRelayInfo()', function () {
    before(async function () {
      await relayRegistrar.registerRelayServer(relayHubOne.address, splitUrl1, { from: relay1 })
      id = (await snapshot()).result
    })

    it('should revert if such relay is not registered for this hub', async function () {
      await expectRevert(relayRegistrar.getRelayInfo(relayHubTwo.address, relay4), 'relayManager not found')
    })

    it('should return all the registration details', async () => {
      const info = await relayRegistrar.getRelayInfo(relayHubOne.address, relay1)
      expect(info.urlParts).to.eql(splitUrl1)
      expect(info.relayManager).to.eql(relay1)
    })
  })
})
