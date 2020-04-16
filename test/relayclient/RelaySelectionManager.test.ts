import chaiAsPromised from 'chai-as-promised'
import sinon, { SinonStub } from 'sinon'
import { HttpProvider } from 'web3-core'
import RelayClient, { GasPricePingFilter } from '../../src/relayclient/RelayClient'
import RelaySelectionManager from '../../src/relayclient/RelaySelectionManager'
import { configureGSN } from '../../src/relayclient/GSNConfigurator'
import { PingFilter } from '../../src/relayclient/types/Aliases'
import RelayInfo from '../../src/relayclient/types/RelayInfo'

const { expect, assert } = require('chai').use(chaiAsPromised)

contract('RelaySelectionManager', function () {
  const sliceSize = 3
  const verbose = false
  const dependencyTree = RelayClient.getDefaultDependencies(web3.currentProvider as HttpProvider, configureGSN({}))
  const stubGetRelaysSorted = sinon.stub(dependencyTree.knownRelaysManager, 'getRelaysSorted')
  const errors = new Map<string, Error>()
  const config = {
    sliceSize,
    verbose
  }
  const eventInfo = {
    relayManager: '',
    relayUrl: '',
    baseRelayFee: '1',
    pctRelayFee: '1'
  }
  const pingResponse = {
    RelayServerAddress: '',
    MinGasPrice: '1',
    Ready: true,
    Version: '1'
  }
  const winner = {
    pingResponse,
    eventInfo
  }
  const transactionDetails = {
    from: '',
    data: '',
    to: '',
    forwarder: '',
    paymaster: ''
  }

  describe('#selectNextRelay()', function () {
    let relaySelectionManager: RelaySelectionManager
    let stubRaceToSuccess: SinonStub
    let stubGetNextSlice: SinonStub

    before(function () {
      relaySelectionManager = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, GasPricePingFilter, config)
      stubRaceToSuccess = sinon.stub(relaySelectionManager, '_raceToSuccess')
      stubGetNextSlice = sinon.stub(relaySelectionManager, '_getNextSlice')
      // unless this is stubbed, promises will not be handled and exception will be thrown somewhere
      sinon.stub(relaySelectionManager, '_getRelayAddressPing').returns(Promise.resolve(winner))
    })

    afterEach(function () {
      stubGetNextSlice.reset()
      stubRaceToSuccess.reset()
    })

    it('should return the first relay to ping', async function () {
      stubGetNextSlice.returns([eventInfo])
      stubRaceToSuccess
        .onFirstCall()
        .returns(Promise.resolve({ errors }))
        .onSecondCall()
        .returns(Promise.resolve({
          winner,
          errors
        }))
      const nextRelay = await relaySelectionManager.selectNextRelay()
      assert.equal(nextRelay!, winner)
    })

    it('should return null if no relay could ping', async function () {
      stubGetNextSlice
        .onFirstCall()
        .returns([eventInfo])
        .onSecondCall()
        .returns([])
      stubRaceToSuccess
        .returns(Promise.resolve({ errors }))
      const nextRelay = await relaySelectionManager.selectNextRelay()
      assert.isUndefined(nextRelay)
    })
  })

  describe('#_getNextSlice()', function () {
    it('should return \'relaySliceSize\' relays if available', function () {
      stubGetRelaysSorted.returns([winner.eventInfo, winner.eventInfo, winner.eventInfo, winner.eventInfo, winner.eventInfo])
      for (let i = 1; i < 5; i++) {
        const rsm = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, GasPricePingFilter, {
          sliceSize: i,
          verbose
        })
        const returned = rsm._getNextSlice()
        assert.equal(returned.length, i)
      }
    })

    it('should return all remaining relays if less then \'relaySliceSize\' remains', function () {
      const relaysLeft = [winner.eventInfo, winner.eventInfo]
      stubGetRelaysSorted.returns(relaysLeft)
      const rsm = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, GasPricePingFilter, {
        sliceSize: 7,
        verbose
      })
      const returned = rsm._getNextSlice()
      assert.deepEqual(returned, relaysLeft)
    })
  })

  describe('#_getRelayAddressPing()', function () {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const emptyFilter: PingFilter = (): void => { }

    let stubPingResponse: SinonStub

    before(function () {
      stubPingResponse = sinon.stub(dependencyTree.httpClient, 'getPingResponse')
    })

    it('should throw if the relay is not ready', async function () {
      stubPingResponse.returns(Promise.resolve(Object.assign({}, pingResponse, { Ready: false })))
      const rsm = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, emptyFilter, config)
      const promise = rsm._getRelayAddressPing(eventInfo)
      await expect(promise).to.be.eventually.rejectedWith('Relay not ready')
    })

    // TODO: change the way filtering is implemented
    it('should call filter and not catch exceptions in it', async function () {
      const message = 'Filter Error Message'
      const filter: PingFilter = (): void => { throw new Error(message) }
      stubPingResponse.returns(Promise.resolve(pingResponse))
      const rsm = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, filter, config)
      const promise = rsm._getRelayAddressPing(eventInfo)
      await expect(promise).to.be.eventually.rejectedWith(message)
    })

    it('should return the relay info if it pinged as ready and passed filter successfully', async function () {
      stubPingResponse.returns(Promise.resolve(pingResponse))
      const rsm = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, emptyFilter, config)
      const relayInfo = await rsm._getRelayAddressPing(eventInfo)
      assert.deepEqual(relayInfo, winner)
    })
  })

  describe('#_raceToSuccess()', function () {
    // Note that promises must be created and passed to the 'raceToSuccess' in the same, synchronous block.
    // Otherwise, rejections will not be handled and mocha will crash.
    it('only first to resolve and all that rejected by that time', async function () {
      const slowRelay = {
        pingResponse,
        eventInfo: Object.assign({}, eventInfo, { relayUrl: 'slowRelay' })
      }
      const fastRelay = {
        pingResponse,
        eventInfo: Object.assign({}, eventInfo, { relayUrl: 'fastRelay' })
      }
      const fastFailRelay = {
        pingResponse,
        eventInfo: Object.assign({}, eventInfo, { relayUrl: 'fastFailRelay' })
      }
      const slowFailRelay = {
        pingResponse,
        eventInfo: Object.assign({}, eventInfo, { relayUrl: 'slowFailRelay' })
      }
      const slowPromise = new Promise<RelayInfo>((resolve) => {
        setTimeout(() => { resolve(slowRelay) }, 1500)
      })
      const fastPromise = new Promise<RelayInfo>((resolve) => {
        setTimeout(() => { resolve(fastRelay) }, 300)
      })
      const fastFailPromise = new Promise<RelayInfo>((resolve, reject) => {
        setTimeout(() => {
          reject(new Error(fastFailedMessage))
        }, 180)
      })
      const slowFailPromise = new Promise<RelayInfo>((resolve, reject) => {
        setTimeout(() => {
          reject(new Error(slowFailedMessage))
        }, 1800)
      })
      const fastFailedMessage = 'Fast Failed Promise'
      const slowFailedMessage = 'Slow Failed Promise'
      const promises = [{
        relayRegisteredEventInfo: slowRelay.eventInfo,
        promise: slowPromise
      }, {
        relayRegisteredEventInfo: fastRelay.eventInfo,
        promise: fastPromise
      }, {
        relayRegisteredEventInfo: slowFailRelay.eventInfo,
        promise: slowFailPromise
      }, {
        relayRegisteredEventInfo: fastFailRelay.eventInfo,
        promise: fastFailPromise
      }]

      const rsm = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, GasPricePingFilter, config)
      const raceResults = await rsm._raceToSuccess(promises)
      assert.equal(raceResults.winner?.eventInfo.relayUrl, 'fastRelay')
      assert.equal(raceResults.errors.size, 1)
      assert.equal(raceResults.errors.get('fastFailRelay')?.message, fastFailedMessage)
    })
  })

  describe('#_handleRaceResults()', function () {
    const winnerRelayUrl = 'winnerRelayUrl'
    const failureRelayUrl = 'failureRelayUrl'
    const otherRelayUrl = 'otherRelayUrl'
    const winner = {
      pingResponse,
      eventInfo: Object.assign({}, eventInfo, { relayUrl: winnerRelayUrl })
    }
    const message = 'some failure message'
    const failureRelayEventInfo = Object.assign({}, eventInfo, { relayUrl: failureRelayUrl })
    const otherRelayEventInfo = Object.assign({}, eventInfo, { relayUrl: otherRelayUrl })
    it('should remove all relays featured in race results', function () {
      sinon.stub(dependencyTree.knownRelaysManager, 'refresh')
      stubGetRelaysSorted.returns([winner.eventInfo, failureRelayEventInfo, otherRelayEventInfo])
      const rsm = new RelaySelectionManager(transactionDetails, dependencyTree.knownRelaysManager, dependencyTree.httpClient, GasPricePingFilter, config)
      // initialize 'remainingRelays' field by calling '_getNextSlice'
      rsm._getNextSlice()
      const errors = new Map<string, Error>()
      errors.set(failureRelayUrl, new Error(message))
      const raceResults = {
        winner,
        errors
      }
      // @ts-ignore
      let remainingRelays = rsm.remainingRelays
      assert.equal(remainingRelays?.length, 3)
      assert.equal(remainingRelays![0].relayUrl, winnerRelayUrl)
      assert.equal(remainingRelays![1].relayUrl, failureRelayUrl)
      assert.equal(remainingRelays![2].relayUrl, otherRelayUrl)
      rsm._handleRaceResults(raceResults)
      // @ts-ignore
      remainingRelays = rsm.remainingRelays
      assert.equal(remainingRelays?.length, 1)
      assert.equal(remainingRelays![0].relayUrl, otherRelayUrl)
    })
  })
})
