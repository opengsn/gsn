import chaiAsPromised from 'chai-as-promised'
import sinon, { SinonStub } from 'sinon'
import { toBN } from 'web3-utils'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

import {
  Address,
  ContractInteractor,
  GsnTransactionDetails,
  HttpClient,
  HttpWrapper,
  PartialRelayInfo,
  PingFilter,
  PingResponse,
  RegistrarRelayInfo,
  RelayInfo,
  RelayInfoUrl,
  WaitForSuccessResults,
  constants,
  defaultEnvironment,
  toHex
} from '@opengsn/common'

import { RelaySelectionManager } from '@opengsn/provider/dist/RelaySelectionManager'
import { DefaultRelayFilter, KnownRelaysManager } from '@opengsn/provider/dist/KnownRelaysManager'
import { GasPricePingFilter } from '@opengsn/provider/dist/RelayClient'

import { configureGSN, deployHub } from '../TestUtils'
import { createClientLogger } from '@opengsn/logger/dist/ClientWinstonLogger'
import { register, stake } from './KnownRelaysManager.test'

import { ether } from '@openzeppelin/test-helpers'

const { expect, assert } = require('chai').use(chaiAsPromised)

contract('RelaySelectionManager', function (accounts) {
  const relayHubAddress = constants.BURN_ADDRESS
  const waitForSuccessSliceSize = 3

  let httpClient: HttpClient
  let contractInteractor: ContractInteractor
  let knownRelaysManager: KnownRelaysManager
  let stubGetRelaysShuffled: SinonStub

  const logger = createClientLogger({ logLevel: 'error' })

  const errors = new Map<string, Error>()
  const config = configureGSN({
    waitForSuccessSliceSize
  })
  const eventInfo: RegistrarRelayInfo = {
    firstSeenBlockNumber: toBN(0),
    lastSeenBlockNumber: toBN(0),
    firstSeenTimestamp: toBN(0),
    lastSeenTimestamp: toBN(0),
    relayManager: '',
    relayUrl: 'http://relayUrl'
  }
  const pingResponse: PingResponse = {
    ownerAddress: '',
    relayWorkerAddress: '',
    relayManagerAddress: '',
    relayHubAddress,
    minMaxFeePerGas: '1',
    maxMaxFeePerGas: Number.MAX_SAFE_INTEGER.toString(),
    minMaxPriorityFeePerGas: '1',
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
    paymaster: '',
    maxFeePerGas: '100',
    maxPriorityFeePerGas: '100'
  }

  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

  let stubPingResponse: SinonStub
  describe('#selectNextRelay()', function () {
    let relaySelectionManager: RelaySelectionManager
    let stubWaitForSuccess: SinonStub<[relays: RelayInfoUrl[], relayHub: Address, paymaster?: Address], Promise<WaitForSuccessResults<PartialRelayInfo>>>
    let stubGetNextSlice: SinonStub

    before(async function () {
      const maxPageSize = Number.MAX_SAFE_INTEGER
      contractInteractor = await new ContractInteractor({
        environment: defaultEnvironment,
        provider: ethersProvider,
        maxPageSize,
        logger
      }).init()
      httpClient = new HttpClient(new HttpWrapper(), this.logger)
      knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, configureGSN({}), DefaultRelayFilter)
      stubGetRelaysShuffled = sinon.stub(knownRelaysManager, 'getRelaysShuffledForTransaction')
      stubGetRelaysShuffled.returns(Promise.resolve([[eventInfo]]))
      relaySelectionManager = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config).init()
      stubWaitForSuccess = sinon.stub(relaySelectionManager, '_waitForSuccess')
      stubGetNextSlice = sinon.stub(relaySelectionManager, '_getNextSlice')
      // unless this is stubbed, promises will not be handled and exception will be thrown somewhere
      // @ts-ignore
      sinon.stub(relaySelectionManager, '_getRelayAddressPing').returns(Promise.resolve(winner))
    })

    afterEach(function () {
      stubGetNextSlice.reset()
      stubWaitForSuccess.reset()
    })

    it('should return the first relay to ping', async function () {
      stubGetNextSlice.returns([eventInfo])
      stubWaitForSuccess
        .onFirstCall()
        .returns(Promise.resolve({ errors, results: [] }))
        .onSecondCall()
        .returns(Promise.resolve({
          // winner,
          results: [winner],
          errors
        }))
      const nextRelay = await relaySelectionManager.selectNextRelay(relayHubAddress)
      assert.equal(nextRelay?.relayInfo, winner)
      assert.equal(nextRelay?.updatedGasFees.maxFeePerGas, transactionDetails.maxFeePerGas)
      assert.equal(nextRelay?.updatedGasFees.maxPriorityFeePerGas, transactionDetails.maxPriorityFeePerGas)
      assert.equal(nextRelay?.maxDeltaPercent, 0)
    })

    describe('with preferred relay URL', function () {
      const preferredRelayUrl = 'http://preferredRelayUrl.test'
      const relayManager = accounts[1]
      let relaySelectionManager: RelaySelectionManager
      let stubWaitForSuccess: SinonStub
      let stubGetNextSlice: SinonStub
      let relayHub: any

      before(async function () {
        const TestToken = artifacts.require('TestToken')
        const StakeManager = artifacts.require('StakeManager')
        const Penalizer = artifacts.require('Penalizer')
        const testToken = await TestToken.new()
        const stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
        const penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
        relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, ether('1').toString())
        await stake(testToken, stakeManager, relayHub, relayManager, accounts[0])
        await register(relayHub, relayManager, accounts[2], preferredRelayUrl, '666', '77')

        await contractInteractor.initDeployment({
          relayHubAddress: relayHub.address,
          relayRegistrarAddress: await relayHub.getRelayRegistrar(),
          stakeManagerAddress: stakeManager.address,
          penalizerAddress: penalizer.address
        })

        relaySelectionManager =
          await new RelaySelectionManager(
            transactionDetails, knownRelaysManager, httpClient, () => {}, logger, config).init()
        stubWaitForSuccess = sinon.stub(relaySelectionManager, '_waitForSuccess')
        stubGetNextSlice = sinon.stub(relaySelectionManager, '_getNextSlice')

        await knownRelaysManager.refresh()
      })

      it('should fill in the details if the relay was known only by URL', async function () {
        const urlInfo: RelayInfoUrl = { relayUrl: preferredRelayUrl }
        const pingResponse: PingResponse = {
          relayWorkerAddress: relayManager,
          relayManagerAddress: relayManager,
          relayHubAddress: relayHub.address,
          minMaxFeePerGas: '1',
          maxMaxFeePerGas: Number.MAX_SAFE_INTEGER.toString(),
          minMaxPriorityFeePerGas: '1',
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
        stubWaitForSuccess.returns(Promise.resolve({
          // winner,
          results: [winner],
          errors
        }))
        stubGetRelaysShuffled.returns(Promise.resolve([[urlInfo]]))
        const { relayInfo: nextRelay } = (await relaySelectionManager.selectNextRelay(relayHub.address))! as any as { relayInfo: RelayInfo }
        assert.equal(nextRelay.relayInfo.relayUrl, preferredRelayUrl)
        assert.equal(nextRelay.relayInfo.relayManager, relayManager)
      })
    })

    it('should return null if no relay could ping', async function () {
      stubGetNextSlice
        .onFirstCall()
        .returns([eventInfo])
        .onSecondCall()
        .returns([])
      stubWaitForSuccess
        .returns(Promise.resolve({ errors, results: [] }))
      const nextRelay = await relaySelectionManager.selectNextRelay(relayHubAddress)
      assert.isUndefined(nextRelay)
    })
  })

  describe('#_getNextSlice()', function () {
    it('should return \'relaySliceSize\' relays if available on the highest priority level', async function () {
      stubGetRelaysShuffled.returns(Promise.resolve([[winner.relayInfo, winner.relayInfo, winner.relayInfo, winner.relayInfo, winner.relayInfo]]))
      for (let i = 1; i < 5; i++) {
        const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, configureGSN({
          waitForSuccessSliceSize: i
        })).init()
        const returned = await rsm._getNextSlice()
        assert.equal(returned.length, i)
      }
    })

    it('should return all remaining relays if less then \'relaySliceSize\' remains on current priority level', async function () {
      const relaysLeft = [[winner.relayInfo, winner.relayInfo]]
      stubGetRelaysShuffled.returns(Promise.resolve(relaysLeft))
      const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, configureGSN({
        waitForSuccessSliceSize: 7
      })).init()
      const returned = await rsm._getNextSlice()
      assert.deepEqual(returned, relaysLeft[0])
    })

    it('should start returning relays from lower priority level if higher level is empty', async function () {
      // Create stub array of distinct relay URLs (URL is used as mapping key)
      const relayInfoGenerator = (e: RegistrarRelayInfo, i: number, a: RegistrarRelayInfo[]): RegistrarRelayInfo => {
        return {
          ...e,
          relayUrl: `http://relay_${i}_of_${a.length}`
        }
      }

      const relaysLeft = [Array(2).fill(winner).map(relayInfoGenerator), Array(3).fill(winner).map(relayInfoGenerator)]
      stubGetRelaysShuffled.returns(Promise.resolve(relaysLeft))
      const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, configureGSN({
        waitForSuccessSliceSize: 7
      })).init()
      // Initial request only returns the top preference relays
      const returned1 = await rsm._getNextSlice()
      assert.equal(returned1.length, 2)
      // Pretend all relays failed to ping
      let errors = new Map(returned1.map(info => [info.relayUrl, new Error('fake error')]))
      rsm._handleWaitForSuccessResults({ errors, results: [] }, [])
      const returned2 = await rsm._getNextSlice()
      assert.equal(returned2.length, 3)
      errors = new Map(returned2.map(info => [info.relayUrl, new Error('fake error')]))
      rsm._handleWaitForSuccessResults({ errors, results: [] }, [])
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
      const promise = rsm._getRelayAddressPing(eventInfo, relayHubAddress)
      await expect(promise).to.be.eventually.rejectedWith('Relay not ready')
    })

    // TODO: change the way filtering is implemented
    it('should call filter and not catch exceptions in it', async function () {
      const message = 'Filter Error Message'
      const filter: PingFilter = (): void => { throw new Error(message) }
      stubPingResponse.returns(Promise.resolve(pingResponse))
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, filter, logger, config)
      const promise = rsm._getRelayAddressPing(eventInfo, relayHubAddress)
      await expect(promise).to.be.eventually.rejectedWith(message)
    })

    it('should return the relay info if it pinged as ready and passed filter successfully', async function () {
      stubPingResponse.returns(Promise.resolve(pingResponse))
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, emptyFilter, logger, config)
      const relayInfo = await rsm._getRelayAddressPing(eventInfo, relayHubAddress)
      assert.deepEqual(relayInfo, winner)
    })

    it('should throw if the Relay Server responded with a different RelayHub address', async function () {
      const pingResponseWrongHub = Object.assign({}, pingResponse, { relayHubAddress: constants.ZERO_ADDRESS })
      stubPingResponse.returns(Promise.resolve(pingResponseWrongHub))
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, () => {}, logger, config)
      const promise = rsm._getRelayAddressPing(eventInfo, relayHubAddress)
      await expect(promise).to.be.eventually.rejectedWith(`Client is using RelayHub ${constants.BURN_ADDRESS} while the server responded with RelayHub address ${constants.ZERO_ADDRESS}`)
    })
  })

  describe('#_waitForSuccess()', function () {
    // Note that promises must be created and passed to the 'waitForSuccess' in the same, synchronous block.
    // Otherwise, rejections will not be handled and mocha will crash.
    it('should return those who successfully resolved and all that rejected by that time', async function () {
      const slowRelay = {
        pingResponse,
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'http://slowRelay' })
      }
      const fastRelay = {
        pingResponse,
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'http://fastRelay' })
      }
      const fastFailRelay = {
        pingResponse,
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'http://fastFailRelay' })
      }
      const slowFailRelay = {
        pingResponse,
        relayInfo: Object.assign({}, eventInfo, { relayUrl: 'http://slowFailRelay' })
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
        }, 5800)
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
      const rsm = new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, () => {}, logger, config)
      const raceResults = await rsm._waitForSuccess(relays, relayHubAddress)

      assert.equal(raceResults.results.length, 2)
      assert.equal(raceResults.results[0].relayInfo.relayUrl, 'http://fastRelay')
      assert.equal(raceResults.results[1].relayInfo.relayUrl, 'http://slowRelay')
      assert.equal(raceResults.errors.size, 1)
      assert.equal(raceResults.errors.get('http://fastFailRelay')?.message, fastFailedMessage)
    })
  })

  describe('#_handleRaceResults()', function () {
    const winnerRelayUrl = 'http://winnerRelayUrl.com'
    const failureRelayUrl = 'http://failureRelayUrl.com'
    const otherRelayUrl = 'http://otherRelayUrl.com'
    const winner = {
      pingResponse,
      relayInfo: Object.assign({}, eventInfo, { relayUrl: winnerRelayUrl })
    }
    const message = 'some failure message'
    const failureRelayEventInfo = Object.assign({}, eventInfo, { relayUrl: failureRelayUrl })
    const otherRelayEventInfo = Object.assign({}, eventInfo, { relayUrl: otherRelayUrl })
    it('should remove all relays featured in race results', async function () {
      sinon.stub(knownRelaysManager, 'refresh')
      stubGetRelaysShuffled.returns(Promise.resolve([[winner.relayInfo, failureRelayEventInfo, otherRelayEventInfo]]))
      const rsm = await new RelaySelectionManager(transactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config).init()
      // initialize 'remainingRelays' field by calling '_getNextSlice'
      await rsm._getNextSlice()
      const errors = new Map<string, Error>()
      errors.set(failureRelayUrl, new Error(message))
      const raceResults = {
        results: [winner],
        errors
      }
      // @ts-ignore
      let remainingRelays = rsm.remainingRelays
      assert.equal(remainingRelays?.length, 1)
      assert.equal(remainingRelays[0].length, 3)
      assert.equal(remainingRelays[0][0].relayUrl, winnerRelayUrl)
      assert.equal(remainingRelays[0][1].relayUrl, failureRelayUrl)
      assert.equal(remainingRelays[0][2].relayUrl, otherRelayUrl)
      rsm._handleWaitForSuccessResults(raceResults, [], winner)
      // @ts-ignore
      remainingRelays = rsm.remainingRelays
      assert.equal(remainingRelays?.length, 1)
      assert.equal(remainingRelays[0][0].relayUrl, otherRelayUrl)
    })
  })

  describe('#selectWinnerByAdjustingFees', function () {
    const MAX_FEE_PER_GAS_CLIENT = 200000
    const MAX_PRIO_FEE_PER_GAS_CLIENT = 100000

    let relaySelectionManager: RelaySelectionManager
    let originalTransactionDetails: GsnTransactionDetails
    let relayInfo: RelayInfo
    let relayInfo1: RelayInfo
    let relayInfo2: RelayInfo
    let relayInfo3: RelayInfo

    before(async function () {
      relayInfo = {
        relayInfo: eventInfo,
        pingResponse
      }

      relayInfo1 = Object.assign(
        {}, relayInfo, {
          relayInfo: Object.assign({}, relayInfo.relayInfo, { relayUrl: 'http://relayUrl1' }),
          pingResponse: Object.assign({}, relayInfo.pingResponse, {
            minMaxFeePerGas: MAX_FEE_PER_GAS_CLIENT + 60000,
            minMaxPriorityFeePerGas: MAX_PRIO_FEE_PER_GAS_CLIENT + 70000
          })
        })
      relayInfo2 = Object.assign(
        {}, relayInfo, {
          relayInfo: Object.assign({}, relayInfo.relayInfo, { relayUrl: 'http://relayUrl2' }),
          pingResponse: Object.assign({}, relayInfo.pingResponse, {
            minMaxFeePerGas: MAX_FEE_PER_GAS_CLIENT + 7777,
            minMaxPriorityFeePerGas: MAX_PRIO_FEE_PER_GAS_CLIENT + 8888
          })
        })
      relayInfo3 = Object.assign(
        {}, relayInfo, {
          relayInfo: Object.assign({}, relayInfo.relayInfo, { relayUrl: 'http://relayUrl3' }),
          pingResponse: Object.assign({}, relayInfo.pingResponse, {
            minMaxFeePerGas: MAX_FEE_PER_GAS_CLIENT + 50000,
            minMaxPriorityFeePerGas: MAX_PRIO_FEE_PER_GAS_CLIENT + 50000
          })
        })
      knownRelaysManager = new KnownRelaysManager(contractInteractor, logger, configureGSN({}), DefaultRelayFilter)
      stubGetRelaysShuffled = sinon.stub(knownRelaysManager, 'getRelaysShuffledForTransaction')
      stubGetRelaysShuffled.returns(Promise.resolve([[eventInfo]]))

      originalTransactionDetails = Object.assign({}, transactionDetails, {
        maxFeePerGas: toHex(MAX_FEE_PER_GAS_CLIENT),
        maxPriorityFeePerGas: toHex(MAX_PRIO_FEE_PER_GAS_CLIENT)
      })
      relayInfo.pingResponse.maxMaxFeePerGas = '100000000'
      relayInfo.pingResponse.minMaxFeePerGas = (MAX_FEE_PER_GAS_CLIENT / 2).toString()
      relayInfo.pingResponse.minMaxPriorityFeePerGas = (MAX_PRIO_FEE_PER_GAS_CLIENT / 2).toString()
      relaySelectionManager = await new RelaySelectionManager(originalTransactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config).init()
    })

    it('should use original fees if they are above Relay Server minimums', async function () {
      const fakePingResults: WaitForSuccessResults<PartialRelayInfo> = {
        results: [relayInfo],
        errors: new Map()
      }
      const { winner } = relaySelectionManager.selectWinnerByAdjustingFees(fakePingResults)
      assert.isOk(winner != null)
      assert.equal(winner?.updatedGasFees.maxFeePerGas, originalTransactionDetails.maxFeePerGas)
      assert.equal(winner?.updatedGasFees.maxPriorityFeePerGas, originalTransactionDetails.maxPriorityFeePerGas)
    })

    it('should accept cheaper Relay Server whose fees are close enough', async function () {
      const fakePingResults: WaitForSuccessResults<PartialRelayInfo> = {
        // relayInfo2 is the closest one and is sandwiched in the middle
        results: [relayInfo1, relayInfo2, relayInfo3],
        errors: new Map()
      }
      const { winner } = relaySelectionManager.selectWinnerByAdjustingFees(fakePingResults)
      assert.isOk(winner != null)
      assert.equal(winner?.updatedGasFees.maxFeePerGas, toHex(relayInfo2.pingResponse.minMaxFeePerGas))
      assert.equal(winner?.updatedGasFees.maxPriorityFeePerGas, toHex(relayInfo2.pingResponse.minMaxPriorityFeePerGas))
    })

    it('should reject Relay Server fees if not close enough', async function () {
      relayInfo.pingResponse.minMaxFeePerGas = '10000000'
      relayInfo.pingResponse.minMaxPriorityFeePerGas = '10000000'
      const fakePingResults: WaitForSuccessResults<PartialRelayInfo> = {
        results: [relayInfo],
        errors: new Map()
      }
      assert.equal(Array.from(relaySelectionManager.priceErrors.keys()).length, 0)
      const { winner: adjustedRelayRequest, skippedRelays } = relaySelectionManager.selectWinnerByAdjustingFees(fakePingResults)
      assert.isOk(adjustedRelayRequest == null)
      assert.equal(skippedRelays.length, 1)
      assert.equal(Array.from(relaySelectionManager.priceErrors.keys()).length, 1)
      assert.include(relaySelectionManager.priceErrors.get(skippedRelays[0])?.message, 'Skipped relay TX=')
    })

    // TODO: this is not a great test as it re-implements order of calls in RelaySelectionManager under test
    it('should remove skipped relays from the remaining relays', async function () {
      // make the second relay be the bad guy
      relayInfo.pingResponse.minMaxFeePerGas = '1'
      relayInfo.pingResponse.minMaxPriorityFeePerGas = '1'
      relayInfo1.pingResponse.minMaxFeePerGas = '10000000'
      relayInfo1.pingResponse.minMaxPriorityFeePerGas = '10000000'
      stubGetRelaysShuffled.returns(Promise.resolve([
        [
          eventInfo,
          Object.assign({}, eventInfo, { relayUrl: 'http://relayUrl1' }),
          Object.assign({}, eventInfo, { relayUrl: 'http://relayUrl2' }),
          Object.assign({}, eventInfo, { relayUrl: 'http://relayUrl3' })
        ]
      ]))
      const relaySelectionManager = await new RelaySelectionManager(originalTransactionDetails, knownRelaysManager, httpClient, GasPricePingFilter, logger, config).init()
      const fakePingResults: WaitForSuccessResults<PartialRelayInfo> = {
        results: [relayInfo, relayInfo1, relayInfo2, relayInfo3],
        errors: new Map()
      }
      const { skippedRelays } = relaySelectionManager.selectWinnerByAdjustingFees(fakePingResults)
      assert.equal(skippedRelays.length, 1)
      assert.equal(skippedRelays[0], relayInfo1.relayInfo.relayUrl)
      // not passing the winner as we want to see only the skipped one be removed
      relaySelectionManager._handleWaitForSuccessResults(fakePingResults, skippedRelays, undefined)
      const returned3 = relaySelectionManager._getNextSlice()
      assert.equal(returned3.length, 3)
      assert.equal(returned3[0].relayUrl, relayInfo.relayInfo.relayUrl)
      assert.equal(returned3[1].relayUrl, relayInfo2.relayInfo.relayUrl)
      assert.equal(returned3[2].relayUrl, relayInfo3.relayInfo.relayUrl)
    })
  })
})
