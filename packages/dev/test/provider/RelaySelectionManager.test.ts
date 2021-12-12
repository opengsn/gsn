import chaiAsPromised from 'chai-as-promised'
import sinon, { SinonStub } from 'sinon'
import { HttpProvider } from 'web3-core'

import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { HttpWrapper } from '@opengsn/common/dist/HttpWrapper'
import { PingResponse } from '@opengsn/common/dist/PingResponse'
import { RelaySelectionManager } from '@opengsn/provider/dist/RelaySelectionManager'
import { DefaultRelayFilter, KnownRelaysManager } from '@opengsn/provider/dist/KnownRelaysManager'
import { GasPricePingFilter } from '@opengsn/provider/dist/RelayClient'
import { PartialRelayInfo, RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { PingFilter } from '@opengsn/common/dist/types/Aliases'
import { RelayInfoUrl, RelayRegisteredEventInfo } from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { configureGSN, deployHub } from '../TestUtils'
import { createClientLogger } from '@opengsn/provider/dist/ClientWinstonLogger'
import { register, stake } from './KnownRelaysManager.test'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'

const { expect, assert } = require('chai').use(chaiAsPromised)

contract('RelaySelectionManager', function (accounts) {
  const sliceSize = 3

  let httpClient: HttpClient
  let contractInteractor: ContractInteractor
  let knownRelaysManager: KnownRelaysManager
  let stubGetRelaysSorted: SinonStub

  const logger = createClientLogger({ logLevel: 'error' })

  const errors = new Map<string, Error>()
  const config = configureGSN({
    sliceSize
  })
  const eventInfo = {
    relayManager: '',
    relayUrl: '',
    baseRelayFee: '1',
    pctRelayFee: '1'
  }
  const pingResponse: PingResponse = {
    ownerAddress: '',
    relayWorkerAddress: '',
    relayManagerAddress: '',
    relayHubAddress: '',
    minGasPrice: '1',
    maxAcceptanceBudget: 1e10.toString(),
    ready: true,
    version: '1'
  }
  const winner = {
    pingResponse,
    relayInfo: eventInfo
  }
  const transactionDetails = {
    from: '',
    data: '',
    to: '',
    forwarder: '',
    paymaster: ''
  }

  let stubPingResponse: SinonStub
  describe('#selectNextRelay()', function () {
    let relaySelectionManager: RelaySelectionManager
    let stubRaceToSuccess: SinonStub
    let stubGetNextSlice: SinonStub

    before(async function () {
      const maxPageSize = Number.MAX_SAFE_INTEGER
      contractInteractor = await new ContractInteractor({
        provider: web3.currentProvider as HttpProvider,
        maxPageSize,
        logger
      }).init()
      httpClient = new HttpClient(new HttpWrapper(), this.logger)
      knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, configureGSN({}), DefaultRelayFilter)
      stubGetRelaysSorted = sinon.stub(knownRelaysManager, 'getRelaysSortedForTransaction')
      stubGetRelaysSorted.returns(Promise.resolve([[eventInfo]]))
      relaySelectionManager = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config).init()
      stubRaceToSuccess = sinon.stub(relaySelectionManager, '_raceToSuccess')
      stubGetNextSlice = sinon.stub(relaySelectionManager, '_getNextSlice')
      // unless this is stubbed, promises will not be handled and exception will be thrown somewhere
      // @ts-ignore
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
      assert.equal(nextRelay, winner)
    })

    describe('with preferred relay URL', function () {
      const preferredRelayUrl = 'preferredRelayUrl'
      const relayManager = accounts[1]
      let relaySelectionManager: RelaySelectionManager
      let stubRaceToSuccess: SinonStub
      let stubGetNextSlice: SinonStub
      let relayHub: any

      before(async function () {
        const StakeManager = artifacts.require('StakeManager')
        const Penalizer = artifacts.require('Penalizer')
        const stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
        const penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
        relayHub = await deployHub(stakeManager.address, penalizer.address)
        await stake(stakeManager, relayHub, relayManager, accounts[0])
        await register(relayHub, relayManager, accounts[2], preferredRelayUrl, '666', '77')

        await contractInteractor.initDeployment({
          relayHubAddress: relayHub.address,
          stakeManagerAddress: stakeManager.address,
          penalizerAddress: penalizer.address
        })

        relaySelectionManager =
          await new RelaySelectionManager(
            transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config).init()
        stubRaceToSuccess = sinon.stub(relaySelectionManager, '_raceToSuccess')
        stubGetNextSlice = sinon.stub(relaySelectionManager, '_getNextSlice')
      })

      it('should fill in the details if the relay was known only by URL', async function () {
        const urlInfo: RelayInfoUrl = { relayUrl: preferredRelayUrl }
        const pingResponse: PingResponse = {
          relayWorkerAddress: relayManager,
          relayManagerAddress: relayManager,
          relayHubAddress: relayManager,
          minGasPrice: '1',
          ownerAddress: accounts[0],
          maxAcceptanceBudget: 1e10.toString(),
          ready: true,
          version: ''
        }
        const winner: PartialRelayInfo = {
          pingResponse,
          relayInfo: urlInfo
        }

        stubGetNextSlice.returns([urlInfo])
        stubRaceToSuccess.returns(Promise.resolve({
          winner,
          errors
        }))
        stubGetRelaysSorted.returns(Promise.resolve([[urlInfo]]))
        const nextRelay: RelayInfo = (await relaySelectionManager.selectNextRelay())!
        assert.equal(nextRelay.relayInfo.relayUrl, preferredRelayUrl)
        assert.equal(nextRelay.relayInfo.relayManager, relayManager)
        assert.equal(nextRelay.relayInfo.baseRelayFee, '666')
        assert.equal(nextRelay.relayInfo.pctRelayFee, '77')
      })
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
    it('should return \'relaySliceSize\' relays if available on the highest priority level', async function () {
      stubGetRelaysSorted.returns(Promise.resolve([[winner.relayInfo, winner.relayInfo, winner.relayInfo, winner.relayInfo, winner.relayInfo]]))
      for (let i = 1; i < 5; i++) {
        const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, configureGSN({
          sliceSize: i
        })).init()
        const returned = await rsm._getNextSlice()
        assert.equal(returned.length, i)
      }
    })

    it('should return all remaining relays if less then \'relaySliceSize\' remains on current priority level', async function () {
      const relaysLeft = [[winner.relayInfo, winner.relayInfo]]
      stubGetRelaysSorted.returns(Promise.resolve(relaysLeft))
      const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, configureGSN({
        sliceSize: 7
      })).init()
      const returned = await rsm._getNextSlice()
      assert.deepEqual(returned, relaysLeft[0])
    })

    it('should start returning relays from lower priority level if higher level is empty', async function () {
      // Create stub array of distinct relay URLs (URL is used as mapping key)
      const relayInfoGenerator = (e: RelayRegisteredEventInfo, i: number, a: RelayRegisteredEventInfo[]): RelayRegisteredEventInfo => {
        return {
          ...e,
          relayUrl: `relay ${i} of ${a.length}`
        }
      }

      const relaysLeft = [Array(2).fill(winner).map(relayInfoGenerator), Array(3).fill(winner).map(relayInfoGenerator)]
      stubGetRelaysSorted.returns(Promise.resolve(relaysLeft))
      const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, configureGSN({
        sliceSize: 7
      })).init()
      // Initial request only returns the top preference relays
      const returned1 = await rsm._getNextSlice()
      assert.equal(returned1.length, 2)
      // Pretend all relays failed to ping
      let errors = new Map(returned1.map(info => [info.relayUrl, new Error('fake error')]))
      rsm._handleRaceResults({ errors })
      const returned2 = await rsm._getNextSlice()
      assert.equal(returned2.length, 3)
      errors = new Map(returned2.map(info => [info.relayUrl, new Error('fake error')]))
      rsm._handleRaceResults({ errors })
      const returned3 = await rsm._getNextSlice()
      assert.equal(returned3.length, 0)
    })
  })

  describe('#_getRelayAddressPing()', function () {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const emptyFilter: PingFilter = (): void => { }

    before(function () {
      stubPingResponse = sinon.stub(httpClient, 'getPingResponse')
    })

    it('should throw if the relay is not ready', async function () {
      stubPingResponse.returns(Promise.resolve(Object.assign({}, pingResponse, { ready: false })))
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, emptyFilter, logger, config)
      const promise = rsm._getRelayAddressPing(eventInfo)
      await expect(promise).to.be.eventually.rejectedWith('Relay not ready')
    })

    // TODO: change the way filtering is implemented
    it('should call filter and not catch exceptions in it', async function () {
      const message = 'Filter Error Message'
      const filter: PingFilter = (): void => { throw new Error(message) }
      stubPingResponse.returns(Promise.resolve(pingResponse))
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, filter, logger, config)
      const promise = rsm._getRelayAddressPing(eventInfo)
      await expect(promise).to.be.eventually.rejectedWith(message)
    })

    it('should return the relay info if it pinged as ready and passed filter successfully', async function () {
      stubPingResponse.returns(Promise.resolve(pingResponse))
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, emptyFilter, logger, config)
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
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'slowRelay' })
      }
      const fastRelay = {
        pingResponse,
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'fastRelay' })
      }
      const fastFailRelay = {
        pingResponse,
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'fastFailRelay' })
      }
      const slowFailRelay = {
        pingResponse,
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'slowFailRelay' })
      }
      const slowPromise = new Promise<PingResponse>((resolve) => {
        setTimeout(() => { resolve(pingResponse) }, 1500)
      })
      const fastPromise = new Promise<PingResponse>((resolve) => {
        setTimeout(() => { resolve(pingResponse) }, 300)
      })
      const fastFailPromise = new Promise<PingResponse>((resolve, reject) => {
        setTimeout(() => {
          reject(new Error(fastFailedMessage))
        }, 180)
      })
      const slowFailPromise = new Promise<PingResponse>((resolve, reject) => {
        setTimeout(() => {
          reject(new Error(slowFailedMessage))
        }, 1800)
      })
      const fastFailedMessage = 'Fast Failed Promise'
      const slowFailedMessage = 'Slow Failed Promise'
      const relays = [slowRelay.relayInfo, fastRelay.relayInfo, slowFailRelay.relayInfo, fastFailRelay.relayInfo]
      stubPingResponse.callsFake(async (relayUrl: string): Promise<PingResponse> => {
        switch (relayUrl) {
          case slowRelay.relayInfo.relayUrl:
            return await slowPromise
          case fastRelay.relayInfo.relayUrl:
            return await fastPromise
          case slowFailRelay.relayInfo.relayUrl:
            return await slowFailPromise
          case fastFailRelay.relayInfo.relayUrl:
            return await fastFailPromise
        }
        throw new Error('Non test relay pinged')
      })
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config)
      const raceResults = await rsm._raceToSuccess(relays)
      assert.equal(raceResults.winner?.relayInfo.relayUrl, 'fastRelay')
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
      relayInfo: Object.assign({}, eventInfo, { relayUrl: winnerRelayUrl })
    }
    const message = 'some failure message'
    const failureRelayEventInfo = Object.assign({}, eventInfo, { relayUrl: failureRelayUrl })
    const otherRelayEventInfo = Object.assign({}, eventInfo, { relayUrl: otherRelayUrl })
    it('should remove all relays featured in race results', async function () {
      sinon.stub(knownRelaysManager, 'refresh')
      stubGetRelaysSorted.returns(Promise.resolve([[winner.relayInfo, failureRelayEventInfo, otherRelayEventInfo]]))
      const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config).init()
      // initialize 'remainingRelays' field by calling '_getNextSlice'
      await rsm._getNextSlice()
      const errors = new Map<string, Error>()
      errors.set(failureRelayUrl, new Error(message))
      const raceResults = {
        winner,
        errors
      }
      // @ts-ignore
      let remainingRelays = rsm.remainingRelays
      assert.equal(remainingRelays?.length, 1)
      assert.equal(remainingRelays[0].length, 3)
      assert.equal(remainingRelays[0][0].relayUrl, winnerRelayUrl)
      assert.equal(remainingRelays[0][1].relayUrl, failureRelayUrl)
      assert.equal(remainingRelays[0][2].relayUrl, otherRelayUrl)
      rsm._handleRaceResults(raceResults)
      // @ts-ignore
      remainingRelays = rsm.remainingRelays
      assert.equal(remainingRelays?.length, 1)
      assert.equal(remainingRelays[0][0].relayUrl, otherRelayUrl)
    })
  })
})
