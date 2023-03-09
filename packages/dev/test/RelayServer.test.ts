/* global artifacts describe */
// @ts-ignore
import { HttpProvider } from 'web3-core'
import { toBN, toHex } from 'web3-utils'
import chai from 'chai'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import { StaticJsonRpcProvider, Block } from '@ethersproject/providers'

import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { SendTransactionDetails, SignedTransactionDetails } from '@opengsn/relay/dist/TransactionManager'
import { ServerConfigParams } from '@opengsn/relay/dist/ServerConfigParams'
import { TestPaymasterConfigurableMisbehaviorInstance } from '@opengsn/contracts/types/truffle-contracts'
import {
  GsnTransactionDetails,
  RelayTransactionRequest,
  TransactionType,
  defaultEnvironment,
  sleep,
  toNumber
} from '@opengsn/common'

import { evmMine, evmMineMany, INCORRECT_ECDSA_SIGNATURE, increaseTime, revert, snapshot } from './TestUtils'
import { LocalhostOne, ServerTestEnvironment } from './ServerTestEnvironment'

import { assertRelayAdded, getTemporaryWorkdirs, getTotalTxCosts } from './ServerTestUtils'
import { PrefixedHexString } from 'ethereumjs-util'
import { ServerAction } from '@opengsn/relay/dist/StoredTransaction'

const { expect, assert } = chai.use(chaiAsPromised).use(sinonChai)

const TestRelayHub = artifacts.require('TestRelayHub')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

contract('RelayServer', function (accounts: Truffle.Accounts) {
  const registrationRateSeconds = 500
  const alertedDelaySeconds = 0

  let id: string
  let globalId: string
  let env: ServerTestEnvironment

  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

  beforeEach(async function () {
    globalId = (await snapshot()).result
    const relayClientConfig: Partial<GSNConfig> = {
      preferredRelays: [LocalhostOne],
      maxRelayNonceGap: 0
    }

    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init(relayClientConfig, undefined, undefined, TestRelayHub, registrationRateSeconds)
    const overrideParams: Partial<ServerConfigParams> = {
      alertedDelaySeconds
    }
    await env.newServerInstance(overrideParams)
    await env.clearServerStorage()
  })

  afterEach(async function () {
    await revert(globalId)
    await env.clearServerStorage()
  })

  describe('#init()', function () {
    it('should initialize relay params', async function () {
      const env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
      await env.init({}, undefined, undefined, TestRelayHub)
      env.newServerInstanceNoFunding()
      const relayServerToInit = env.relayServer
      const chainId = await env.web3.eth.getChainId()
      const networkId = await env.web3.eth.net.getId()
      assert.notEqual(relayServerToInit.chainId, chainId)
      assert.notEqual(relayServerToInit.networkId, networkId)
      assert.isTrue(relayServerToInit.shouldRefreshBalances)
      assert.equal(relayServerToInit.isReady(), false)
      const initTrustedPaymastersSpy = sinon.spy(relayServerToInit, '_initTrustedPaymasters')
      const registrationManagerSpy = sinon.spy(relayServerToInit.registrationManager, 'init')
      const transactionManagerSpy = sinon.spy(relayServerToInit.transactionManager, 'init')
      await relayServerToInit.init()
      sinon.assert.callOrder(
        transactionManagerSpy,
        initTrustedPaymastersSpy,
        registrationManagerSpy
      )
      sinon.restore()
      assert.equal(relayServerToInit.isReady(), false, 'relay should not be ready yet')
      assert.equal(relayServerToInit.chainId, chainId)
      assert.equal(relayServerToInit.networkId, networkId)
      // @ts-ignore
      expect(relayServerToInit.txStoreManager.txstore._autocompactionIntervalId).to.exist
    })
  })

  describe('#_worker()', function () {
    it('should return immediately if shouldn\'t refresh state', async function () {
      await env.newServerInstance({})
      await evmMineMany(1)
      const latestBlock = await ethersProvider.getBlock('latest')
      const serverSpy = sinon.spy(env.relayServer)
      await env.relayServer._worker(latestBlock)
      sinon.assert.callOrder(
        serverSpy._shouldRefreshState
      )
      sinon.assert.notCalled(
        serverSpy.withdrawToOwnerIfNeeded
      )
      sinon.restore()
    })
    it('should call all maintenance functions to refresh state', async function () {
      await env.newServerInstance({})
      await evmMineMany(env.relayServer.config.refreshStateTimeoutBlocks + 1)
      const latestBlock = await ethersProvider.getBlock('latest')
      const serverSpy = sinon.spy(env.relayServer)
      await env.relayServer._worker(latestBlock)
      sinon.assert.callOrder(
        serverSpy._shouldRefreshState,
        serverSpy.withdrawToOwnerIfNeeded,
        serverSpy._refreshGasFees,
        serverSpy._refreshAndCheckBalances,
        serverSpy._handleChanges
      )
      sinon.restore()
    })
    it('should call all maintenance functions if not ready', async function () {
      await env.newServerInstance({})
      await evmMineMany(1)
      const latestBlock = await ethersProvider.getBlock('latest')
      const serverSpy = sinon.spy(env.relayServer)
      env.relayServer.setReadyState(false)
      await env.relayServer._worker(latestBlock)
      sinon.assert.callOrder(
        serverSpy._shouldRefreshState,
        serverSpy.withdrawToOwnerIfNeeded,
        serverSpy._refreshGasFees,
        serverSpy._refreshAndCheckBalances,
        serverSpy._handleChanges
      )
      sinon.restore()
    })
  })

  describe('#_handleChanges()', function () {
    it('should call all maintenance functions on happy flow', async function () {
      await env.newServerInstance()
      await evmMineMany(1)
      const latestBlock = await ethersProvider.getBlock('latest')
      const serverSpy = sinon.spy(env.relayServer)
      const registrationSpy = sinon.spy(env.relayServer.registrationManager)
      const tmSpy = sinon.spy(env.relayServer.transactionManager)
      await env.relayServer._handleChanges(latestBlock)
      sinon.assert.callOrder(
        serverSpy.getAllHubEventsSinceLastScan,
        registrationSpy.handlePastEvents,
        tmSpy.fillMinedBlockDetailsForTransactions,
        tmSpy.removeArchivedTransactions,
        serverSpy._boostStuckPendingTransactions,
        registrationSpy.isRegistered,
        serverSpy.handlePastHubEvents,
        serverSpy.replenishServer,
        serverSpy._refreshAndCheckBalances
      )
      sinon.restore()
    })
  })

  describe('#isReady after exception', () => {
    let relayServer: RelayServer
    beforeEach(async () => {
      relayServer = env.relayServer
      // force "ready
      assert.equal(relayServer.isReady(), true)
      const stub = sinon.stub(relayServer.contractInteractor, 'getBlock').rejects(Error('simulate getBlock failed'))
      try {
        await relayServer.intervalHandler()
      } finally {
        // remove stub
        stub.restore()
      }
    })

    it('should set "deferReadiness" after exception', async () => {
      assert.equal(relayServer.isReady(), false)
    })

    it('should become ready after processing a block', async () => {
      await evmMineMany(1)
      await relayServer.intervalHandler()
      assert.equal(relayServer.isReady(), true)
    })
  })

  describe('readiness info', function () {
    let clock: sinon.SinonFakeTimers
    const time = 10000
    beforeEach(async function () {
      await env.newServerInstanceNoFunding()
      await env.fundServer()
      await env.relayServer.init()
      clock = sinon.useFakeTimers(Date.now())
    })
    afterEach(function () {
      clock.restore()
    })

    it('should set readiness info in constructor', async function () {
      const now = Date.now()
      assert.closeTo(env.relayServer.readinessInfo.runningSince, now, 3000)
      assert.equal(env.relayServer.readinessInfo.currentStateTimestamp, env.relayServer.readinessInfo.runningSince)
      assert.equal(env.relayServer.readinessInfo.totalReadyTime, 0)
      assert.equal(env.relayServer.readinessInfo.totalNotReadyTime, 0)

      const statsResponse = env.relayServer.statsHandler()
      assert.equal(statsResponse.runningSince, env.relayServer.readinessInfo.runningSince)
      assert.equal(statsResponse.currentStateTimestamp, env.relayServer.readinessInfo.currentStateTimestamp)
      assert.equal(statsResponse.totalUptime, statsResponse.totalReadyTime + statsResponse.totalNotReadyTime)
      assert.isTrue(statsResponse.totalUptime > 0)
      assert.equal(statsResponse.totalReadinessChanges, 0)
    })

    it('should keep readiness info when setting to not ready', async function () {
      env.relayServer.setReadyState(false)
      clock.tick(time)
      assert.equal(env.relayServer.readinessInfo.totalReadyTime, 0)
      assert.equal(env.relayServer.readinessInfo.currentStateTimestamp - env.relayServer.readinessInfo.runningSince,
        env.relayServer.readinessInfo.totalReadyTime + env.relayServer.readinessInfo.totalNotReadyTime)

      const statsResponse = env.relayServer.statsHandler()
      assert.equal(statsResponse.runningSince, env.relayServer.readinessInfo.runningSince)
      assert.equal(statsResponse.currentStateTimestamp, env.relayServer.readinessInfo.currentStateTimestamp)
      assert.equal(statsResponse.totalUptime, statsResponse.totalReadyTime + statsResponse.totalNotReadyTime)
      assert.isTrue(statsResponse.totalUptime >= time)
      assert.isTrue(statsResponse.totalNotReadyTime >= time)
      assert.isTrue(statsResponse.totalReadyTime < time)
      assert.equal(statsResponse.totalReadinessChanges, 0)
    })

    it('should keep readiness info when setting to ready', async function () {
      env.relayServer.setReadyState(true)
      clock.tick(time)
      assert.equal(env.relayServer.readinessInfo.currentStateTimestamp - env.relayServer.readinessInfo.runningSince,
        env.relayServer.readinessInfo.totalReadyTime + env.relayServer.readinessInfo.totalNotReadyTime)
      assert.closeTo(env.relayServer.readinessInfo.totalNotReadyTime, 0, 1000)
      // Only one interval, and it's from first uptime until last state change
      assert.equal(env.relayServer.readinessInfo.totalReadinessChanges, 1)

      const statsResponse = env.relayServer.statsHandler()
      assert.equal(statsResponse.runningSince, env.relayServer.readinessInfo.runningSince)
      assert.equal(statsResponse.currentStateTimestamp, env.relayServer.readinessInfo.currentStateTimestamp)
      assert.equal(statsResponse.totalUptime, statsResponse.totalReadyTime + statsResponse.totalNotReadyTime)
      assert.isTrue(statsResponse.totalUptime >= time)
      assert.isTrue(statsResponse.totalReadyTime >= time)
      assert.isTrue(statsResponse.totalNotReadyTime < time)
      assert.equal(statsResponse.totalReadinessChanges, 1)
    })

    it('should keep readiness info when setting new readiness states', async function () {
      env.relayServer.setReadyState(false)
      clock.tick(time)
      env.relayServer.setReadyState(false)
      clock.tick(time)
      env.relayServer.setReadyState(true)
      clock.tick(time)
      env.relayServer.setReadyState(false)
      clock.tick(time)
      env.relayServer.setReadyState(true)
      clock.tick(time)
      env.relayServer.setReadyState(false)
      assert.equal(env.relayServer.readinessInfo.totalReadyTime, time * 2)
      assert.equal(env.relayServer.readinessInfo.totalReadinessChanges, 4)
      assert.equal(env.relayServer.readinessInfo.currentStateTimestamp - env.relayServer.readinessInfo.runningSince,
        env.relayServer.readinessInfo.totalReadyTime + env.relayServer.readinessInfo.totalNotReadyTime)

      const statsResponse = env.relayServer.statsHandler()
      assert.equal(statsResponse.totalReadinessChanges, 4)
      assert.isTrue(statsResponse.totalUptime >= 5 * time)
      assert.equal(statsResponse.totalReadyTime, time * 2)
      assert.isTrue(statsResponse.totalNotReadyTime >= 3 * time)
    })
  })

  describe('validation', function () {
    const blacklistedPaymaster = '0xdeadfaceffff'
    beforeEach(async function () {
      await env.newServerInstance({ blacklistedPaymasters: [blacklistedPaymaster] })
    })
    describe('#validateInput()', function () {
      it('should fail to relay with wrong relay worker', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.relayWorker = accounts[1]
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          assert.include(e.message, `Wrong worker address: ${accounts[1]}`)
        }
      })

      it('should fail to relay with low maxPriorityFeePerGas', async function () {
        const wrongPriorityFee = env.relayServer.minMaxPriorityFeePerGas - 1
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.maxPriorityFeePerGas = wrongPriorityFee.toString()
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `priorityFee given ${wrongPriorityFee} too low. Minimum maxPriorityFee server accepts: ${env.relayServer.minMaxPriorityFeePerGas}`)
        }
      })

      it('should fail to relay with low maxFeePerGas', async function () {
        const wrongFeePerGas = env.relayServer.minMaxFeePerGas - 1
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.maxFeePerGas = wrongFeePerGas.toString()
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `maxFeePerGas given ${wrongFeePerGas} too low. Minimum maxFeePerGas server accepts: ${env.relayServer.minMaxFeePerGas}`)
        }
      })

      it('should fail to relay with maxPriorityFeePerGas > maxFeePerGas', async function () {
        const req = await env.createRelayHttpRequest({ maxFeePerGas: toHex(1e9), maxPriorityFeePerGas: toHex(1e10) })
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `maxFee ${req.relayRequest.relayData.maxFeePerGas} cannot be lower than priorityFee ${req.relayRequest.relayData.maxPriorityFeePerGas}`)
        }
      })

      it('should fail to relay with high maxPriorityFeePerGas', async function () {
        const wrongFee = parseInt(env.relayServer.config.maxMaxFeePerGas) + 1
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.maxFeePerGas = wrongFee.toString()
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `maxFee given ${wrongFee} too high : ${env.relayServer.config.maxMaxFeePerGas}`)
        }
      })

      it('should fail to relay legacy tx with maxPriorityFeePerGas != maxFeePerGas', async function () {
        const req = await env.createRelayHttpRequest({ maxFeePerGas: toHex(1e9), maxPriorityFeePerGas: toHex(1e10) })
        try {
          env.relayServer.transactionType = TransactionType.LEGACY
          env.relayServer.validateRequestTxType(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            'Current network (1337) does not support EIP-1559 transactions.')
        }
      })

      it('should fail to relay with wrong hub address', async function () {
        const wrongHubAddress = '0xdeadface'
        const req = await env.createRelayHttpRequest()
        req.metadata.relayHubAddress = wrongHubAddress
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `Wrong hub address.\nRelay server's hub address: ${env.relayServer.config.relayHubAddress}, request's hub address: ${wrongHubAddress}\n`)
        }
      })

      it('should fail to relay request too close to expiration', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.request.validUntilTime = '1234567890'
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            'Request expired (or too close): expired at (Fri, 13 Feb 2009 23:31:30 GMT), we expect it to be valid until')
        }
      })

      it('should fail to relay with blacklisted paymaster', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.paymaster = blacklistedPaymaster
        try {
          env.relayServer.validateInput(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message,
            `Paymaster ${blacklistedPaymaster} is blacklisted!`)
        }
      })

      describe('in private mode with "url" set to empty string', function () {
        const whitelistedPaymaster = '0xdeadface0000'
        const notWhitelistedPaymaster = '0xdeadfaceaaaa'
        const notWhitelistedRecipient = '0xdeadfacebbbb'

        beforeEach(function () {
          env.relayServer.config.url = ''
          env.relayServer.config.whitelistedPaymasters = [whitelistedPaymaster]
          // recipient address is checked for whitelist second so it does not matter for the test
          env.relayServer.config.whitelistedRecipients = [whitelistedPaymaster]
        })

        it('should fail to relay in private mode with Recipient not in a whitelist', async function () {
          const req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.paymaster = whitelistedPaymaster
          req.relayRequest.request.to = notWhitelistedRecipient
          expect(() => env.relayServer.validateInput(req)).to.throw(`Recipient ${notWhitelistedRecipient} is not whitelisted!`)
        })

        it('should fail to relay in private mode with Paymaster not in a whitelist', async function () {
          const req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.paymaster = notWhitelistedPaymaster
          expect(() => env.relayServer.validateInput(req)).to.throw(`Paymaster ${notWhitelistedPaymaster} is not whitelisted!`)
        })

        it('should validate request in private mode with empty Paymaster and Recipient whitelists', async function () {
          const req = await env.createRelayHttpRequest()
          env.relayServer.config.whitelistedPaymasters = []
          env.relayServer.config.whitelistedRecipients = []
          env.relayServer.validateInput(req)
        })
      })
    })

    describe('#validateRelayFees()', function () {
      describe('with trusted paymaster', function () {
        beforeEach(async function () {
          await env.relayServer._initTrustedPaymasters([env.paymaster.address])
        })

        afterEach(async function () {
          await env.relayServer._initTrustedPaymasters([])
        })

        it('#_isTrustedPaymaster', function () {
          assert.isFalse(env.relayServer._isTrustedPaymaster(accounts[1]), 'identify untrusted paymaster')
          assert.isTrue(env.relayServer._isTrustedPaymaster(env.paymaster.address), 'identify trusted paymaster')
        })
      })

      describe('#validateMaxNonce()', function () {
        beforeEach(async function () {
          // this is a new worker account - create transaction
          await evmMineMany(1)
          const latestBlock = await ethersProvider.getBlock('latest')
          await env.relayServer._worker(latestBlock)
          const signer = env.relayServer.workerAddress
          await env.relayServer.transactionManager.sendTransaction({
            signer,
            serverAction: ServerAction.VALUE_TRANSFER,
            destination: accounts[0],
            creationBlockNumber: 0,
            creationBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
            creationBlockTimestamp: 0
          })
          await env.relayServer._refreshAndCheckBalances()
        })

        it('should not throw with relayMaxNonce above current nonce', async function () {
          await env.relayServer.validateMaxNonce(1000)
        })

        it('should throw exception with relayMaxNonce below current nonce', async function () {
          try {
            await env.relayServer.validateMaxNonce(0)
            assert.fail()
          } catch (e: any) {
            assert.include(e.message, 'Unacceptable relayMaxNonce:')
          }
        })
      })
    })

    describe('#_refreshAndCheckBalances()', function () {
      beforeEach(async function () {
        await env.newServerInstance()
      })
      it('should not refresh balances or change readiness if balances are high', async function () {
        assert.isFalse(env.relayServer.shouldRefreshBalances)
        const managerBalance = await env.relayServer.getManagerBalance()
        const workerBalance = await env.relayServer.getWorkerBalance(0)
        assert.isTrue(managerBalance.gte(toBN(env.relayServer.config.managerMinBalance)))
        assert.isTrue(workerBalance.gte(toBN(env.relayServer.config.workerMinBalance)))

        assert.isTrue(env.relayServer.isReady())
        await env.relayServer._refreshAndCheckBalances()
        assert.isTrue(env.relayServer.isReady())
        assert.isFalse(env.relayServer.shouldRefreshBalances)

        env.relayServer.setReadyState(false)
        assert.isFalse(env.relayServer.isReady())
        await env.relayServer._refreshAndCheckBalances()
        assert.isFalse(env.relayServer.isReady())
        assert.isFalse(env.relayServer.shouldRefreshBalances)
      })
      it('should refresh and set readiness to false if manager balance is lower than half the min', async function () {
        assert.isTrue(env.relayServer.isReady())
        env.relayServer.shouldRefreshBalances = true
        const workerBalance = await env.relayServer.getWorkerBalance(0)
        assert.isTrue(workerBalance.gte(toBN(env.relayServer.config.workerMinBalance)))
        sinon.stub(env.relayServer.registrationManager.balanceRequired, 'currentValue').get(() => toBN(0)).set(() => {})
        await env.relayServer._refreshAndCheckBalances()
        assert.isFalse(env.relayServer.isReady())
        assert.isTrue(env.relayServer.shouldRefreshBalances)
        sinon.restore()
      })
      it('should refresh and set readiness to false if worker balance is lower than half the min', async function () {
        assert.isTrue(env.relayServer.isReady())
        env.relayServer.shouldRefreshBalances = true
        const managerBalance = await env.relayServer.getManagerBalance()
        assert.isTrue(managerBalance.gte(toBN(env.relayServer.config.managerMinBalance)))
        sinon.stub(env.relayServer.workerBalanceRequired, 'currentValue').get(() => toBN(0)).set(() => {})
        await env.relayServer._refreshAndCheckBalances()
        assert.isFalse(env.relayServer.isReady())
        assert.isTrue(env.relayServer.shouldRefreshBalances)
        sinon.restore()
      })
      it('should refresh balances but not change readiness if manager balance is higher than half the min but lower than min', async function () {
        assert.isTrue(env.relayServer.isReady())
        env.relayServer.shouldRefreshBalances = true
        const workerBalance = await env.relayServer.getWorkerBalance(0)
        assert.isTrue(workerBalance.gte(toBN(env.relayServer.config.workerMinBalance)))
        sinon.stub(env.relayServer.registrationManager.balanceRequired, 'currentValue').get(() => toBN(env.relayServer.config.managerMinBalance).divn(2).addn(1e6)).set(() => {})
        await env.relayServer._refreshAndCheckBalances()
        assert.isTrue(env.relayServer.isReady(), 'isReady wrong')
        assert.isTrue(env.relayServer.shouldRefreshBalances, 'shouldRefreshBalances wrong')
        sinon.restore()
      })
      it('should refresh balances but not change readiness if worker balance is higher than half the min but lower than min', async function () {
        assert.isTrue(env.relayServer.isReady())
        env.relayServer.shouldRefreshBalances = true
        const managerBalance = await env.relayServer.getManagerBalance()
        assert.isTrue(managerBalance.gte(toBN(env.relayServer.config.managerMinBalance)))
        sinon.stub(env.relayServer.workerBalanceRequired, 'currentValue').get(() => toBN(env.relayServer.config.workerMinBalance).divn(2).addn(1e6)).set(() => {})
        await env.relayServer._refreshAndCheckBalances()
        assert.isTrue(env.relayServer.isReady(), 'isReady wrong')
        assert.isTrue(env.relayServer.shouldRefreshBalances, 'shouldRefreshBalances wrong')
        sinon.restore()
      })
    })

    describe('#_refreshGasFees()', function () {
      it('should set min gas price to network average * gas price factor', async function () {
        env.relayServer.minMaxPriorityFeePerGas = 0
        await env.relayServer._refreshGasFees()
        const priorityFee = parseInt((await env.relayServer.contractInteractor.getGasFees(5, 50)).priorityFeePerGas)
        assert.equal(env.relayServer.minMaxPriorityFeePerGas, env.relayServer.config.gasPriceFactor * priorityFee)
      })
      it('should fix zero minMaxPriorityFeePerGas only if config.defaultPriorityFee is greater than zero', async function () {
        let defaultPriorityFee = '0'
        env.relayServer.config.defaultPriorityFee = defaultPriorityFee
        env.relayServer.minMaxPriorityFeePerGas = 0
        sinon.stub(env.relayServer.contractInteractor, 'getGasFees').returns(Promise.resolve({
          priorityFeePerGas: '0',
          baseFeePerGas: '0'
        }))
        const spy = sinon.spy(env.relayServer.logger, 'debug')
        await env.relayServer._refreshGasFees()
        sinon.assert.notCalled(spy)
        assert.equal(env.relayServer.minMaxPriorityFeePerGas, 0)

        defaultPriorityFee = '1234'
        env.relayServer.config.defaultPriorityFee = defaultPriorityFee
        await env.relayServer._refreshGasFees()
        sinon.assert.calledWith(spy, `Priority fee received from node is 0. Setting priority fee to ${defaultPriorityFee}`)
        sinon.restore()
        assert.equal(env.relayServer.minMaxPriorityFeePerGas, parseInt(defaultPriorityFee))
      })
      it('should throw when min gas price is higher than max', async function () {
        await env.relayServer._refreshGasFees()
        const originalMaxPrice = env.relayServer.config.maxMaxFeePerGas
        env.relayServer.config.maxMaxFeePerGas = (env.relayServer.minMaxPriorityFeePerGas - 1).toString()
        try {
          await env.relayServer._refreshGasFees()
          assert.fail()
        } catch (e: any) {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          assert.include(e.message,
            `network maxPriorityFeePerGas ${env.relayServer.minMaxPriorityFeePerGas} is higher than config.maxMaxFeePerGas ${env.relayServer.config.maxMaxFeePerGas}`)
        } finally {
          env.relayServer.config.maxMaxFeePerGas = originalMaxPrice
        }
      })
    })

    describe('#validatePaymasterGasAndDataLimits()', function () {
      it('should fail to relay with invalid paymaster', async function () {
        const req = await env.createRelayHttpRequest()
        req.relayRequest.relayData.paymaster = accounts[1]
        try {
          await env.relayServer.calculateAndValidatePaymasterGasAndDataLimits(req)
          assert.fail()
        } catch (e: any) {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          assert.include(e.message, `not a valid paymaster contract: ${accounts[1]}`)
        }
      })

      it('should fail to relay with high maxPossibleGas', async function () {
        const req = await env.createRelayHttpRequest()
        const origMaxGas = env.relayServer.maxGasLimit
        env.relayServer.maxGasLimit = 1
        try {
          await env.relayServer.calculateAndValidatePaymasterGasAndDataLimits(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message, 'exceeds maxGasLimit')
        } finally {
          env.relayServer.maxGasLimit = origMaxGas
        }
      })

      it('should fail to relay when paymaster\'s balance too low', async function () {
        id = (await snapshot()).result
        const req = await env.createRelayHttpRequest()
        try {
          await env.paymaster.withdrawAll(accounts[0])
          await env.relayServer.calculateAndValidatePaymasterGasAndDataLimits(req)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message, 'paymaster balance too low')
        } finally {
          await revert(id)
        }
      })

      describe('relay max exposure to paymaster rejections', function () {
        const paymasterExpectedAcceptanceBudget = 150000
        let rejectingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
        let req: RelayTransactionRequest

        beforeEach(async function () {
          rejectingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
          await rejectingPaymaster.setTrustedForwarder(env.forwarder.address)
          await rejectingPaymaster.setRelayHub(env.relayHub.address)
          await rejectingPaymaster.deposit({ value: env.web3.utils.toWei('1', 'ether') })
          req = await env.createRelayHttpRequest()
          req.relayRequest.relayData.paymaster = rejectingPaymaster.address
        })

        it('should reject a transaction from paymaster returning above configured max exposure', async function () {
          await rejectingPaymaster.setGreedyAcceptanceBudget(true)
          try {
            await env.relayServer.calculateAndValidatePaymasterGasAndDataLimits(req)
            assert.fail()
          } catch (e: any) {
            assert.include(e.message, 'paymaster acceptance budget + msg.data gas cost too high')
          }
        })

        it('should reject a request if a transactionCalldataGasUsed  is too low', async function () {
          req.relayRequest.relayData.transactionCalldataGasUsed = '500'
          try {
            await env.relayServer.calculateAndValidatePaymasterGasAndDataLimits(req)
            assert.fail()
          } catch (e: any) {
            assert.include(e.message, 'Refusing to relay a transaction due to calldata cost. Client signed transactionCalldataGasUsed: 500')
          }
        })

        it('should accept a transaction from paymaster returning below configured max exposure', async function () {
          await rejectingPaymaster.setGreedyAcceptanceBudget(false)
          const gasLimits = await rejectingPaymaster.getGasAndDataLimits()
          assert.equal(toNumber(gasLimits.acceptanceBudget), paymasterExpectedAcceptanceBudget)
          await env.relayServer.calculateAndValidatePaymasterGasAndDataLimits(req)
        })

        it('should accept a transaction from trusted paymaster returning above configured max exposure', async function () {
          await rejectingPaymaster.setGreedyAcceptanceBudget(true)
          const req = await env.createRelayHttpRequest()
          try {
            await env.relayServer._initTrustedPaymasters([rejectingPaymaster.address])
            const gasLimits = await rejectingPaymaster.getGasAndDataLimits()
            assert.equal(toNumber(gasLimits.acceptanceBudget), paymasterExpectedAcceptanceBudget * 9)
            await env.relayServer.calculateAndValidatePaymasterGasAndDataLimits(req)
          } finally {
            await env.relayServer._initTrustedPaymasters([])
          }
        })
      })
    })

    describe('#validateViewCallSucceeds()', function () {
      it('should fail to relay rejected transaction', async function () {
        const req = await env.createRelayHttpRequest()
        req.metadata.signature = INCORRECT_ECDSA_SIGNATURE
        try {
          await env.relayServer.validateViewCallSucceeds(req, 200000, 2000000)
          assert.fail()
        } catch (e: any) {
          assert.include(e.message, 'Paymaster rejected in server: FWD: signature mismatch')
        }
      })
    })
  })

  describe('#createRelayTransaction()', function () {
    beforeEach(async function () {
      await env.clearServerStorage()
    })

    async function fixTxDetails (details: Partial<GsnTransactionDetails>, type: number): Promise<void> {
      if (type === TransactionType.TYPE_TWO) {
        const { baseFeePerGas, priorityFeePerGas } = await env.relayServer.contractInteractor.getGasFees(5, 50)
        details.maxFeePerGas = toHex(parseInt(baseFeePerGas) + parseInt(priorityFeePerGas))
        details.maxPriorityFeePerGas = toHex(priorityFeePerGas)
        assert.isTrue(details.maxFeePerGas > details.maxPriorityFeePerGas)
      }
    }

    const options = [
      { title: 'legacy', type: TransactionType.LEGACY },
      { title: 'type 2', type: TransactionType.TYPE_TWO }
    ]
    options.forEach(params => {
      it(`should relay ${params.title} transaction without paymaster reputation`, async function () {
        const overrideDetails: Partial<GsnTransactionDetails> = {}
        await fixTxDetails(overrideDetails, params.type)
        const req = await env.createRelayHttpRequest(overrideDetails)
        const txMgrSpy = sinon.spy(env.relayServer.transactionManager)
        const serverSpy = sinon.spy(env.relayServer)

        assert.equal((await env.relayServer.txStoreManager.getAll()).length, 0)
        await env.relayServer._refreshGasFees()
        await env.relayServer.createRelayTransaction(req)
        const pendingTransactions = await env.relayServer.txStoreManager.getAll()
        assert.equal(pendingTransactions.length, 1)
        assert.equal(pendingTransactions[0].serverAction, ServerAction.RELAY_CALL)
        sinon.assert.callOrder(
          serverSpy.isReady,
          serverSpy.validateRequestTxType,
          serverSpy.validateInput,
          serverSpy.validateGasFees,
          serverSpy.validateMaxNonce,
          serverSpy.calculateAndValidatePaymasterGasAndDataLimits,
          serverSpy.validateViewCallSucceeds,
          txMgrSpy.sendTransaction,
          serverSpy.replenishServer
        )
        sinon.restore()
      })

      it(`should relay ${params.title} transaction without paymaster reputation`, async function () {
        await env.newServerInstance({ runPaymasterReputations: true })
        await env.clearServerStorage()
        const overrideDetails: Partial<GsnTransactionDetails> = {}
        await fixTxDetails(overrideDetails, params.type)
        const req = await env.createRelayHttpRequest()
        const txMgrSpy = sinon.spy(env.relayServer.transactionManager)
        const repSpy = sinon.spy(env.relayServer.reputationManager)
        const serverSpy = sinon.spy(env.relayServer)

        assert.equal((await env.relayServer.txStoreManager.getAll()).length, 0)
        await env.relayServer.createRelayTransaction(req)
        const pendingTransactions = await env.relayServer.txStoreManager.getAll()
        assert.equal(pendingTransactions.length, 1)
        assert.equal(pendingTransactions[0].serverAction, ServerAction.RELAY_CALL)
        sinon.assert.callOrder(
          serverSpy.isReady,
          serverSpy.validateRequestTxType,
          serverSpy.validateInput,
          serverSpy.validateGasFees,
          serverSpy.validateMaxNonce,
          serverSpy.validatePaymasterReputation,
          serverSpy.calculateAndValidatePaymasterGasAndDataLimits,
          serverSpy.validateViewCallSucceeds,
          repSpy.onRelayRequestAccepted,
          txMgrSpy.sendTransaction,
          serverSpy.replenishServer
        )
        sinon.restore()
      })
    })

    it('should return nonceGapFilled map containing transactions between relayLastKnownNonce and signed nonce', async function () {
      const workerAddress = env.relayServer.transactionManager.workersKeyManager.getAddress(0)
      const relayNonce = await web3.eth.getTransactionCount(workerAddress)
      const txs = []
      for (let i = 0; i < 10; i++) {
        const req = await env.createRelayHttpRequest()
        const { signedTx } = await env.relayServer.createRelayTransaction(req)
        txs.push(signedTx)
      }
      const req = await env.createRelayHttpRequest()
      req.metadata.relayLastKnownNonce = req.metadata.relayLastKnownNonce - 10
      const res = await env.relayServer.createRelayTransaction(req)
      assert.equal(Object.entries(res.nonceGapFilled).length, 10)
      for (let i = 0; i < 10; i++) {
        const nonce = relayNonce + i
        assert.isNotNull(res.nonceGapFilled[nonce])
        assert.equal(txs[i], res.nonceGapFilled[nonce])
      }
    })
  })

  describe('withdrawToOwnerIfNeeded', function () {
    let currentBlockNumber: number
    let currentBlockHash: string
    let currentBlockTimestamp: number
    const withdrawToOwnerOnBalance = 3e18
    beforeEach(async function () {
      await env.newServerInstance({ withdrawToOwnerOnBalance }, getTemporaryWorkdirs())
      assert.equal(env.relayServer.config.withdrawToOwnerOnBalance, withdrawToOwnerOnBalance)
      const latestBlock = await env.web3.eth.getBlock('latest')
      currentBlockNumber = latestBlock.number
      currentBlockHash = latestBlock.hash
      currentBlockTimestamp = toNumber(latestBlock.timestamp)
    })
    afterEach(async function () {
      sinon.restore()
    })
    it('should not withdraw if relayer is not ready', async function () {
      env.relayServer.setReadyState(false)
      const serverSpy = sinon.spy(env.relayServer)
      const txHashes = await env.relayServer.withdrawToOwnerIfNeeded(currentBlockNumber, currentBlockHash, currentBlockTimestamp)
      assert.deepEqual(txHashes, [])
      sinon.assert.calledOnce(serverSpy.isReady)
      assert.isFalse(serverSpy.isReady.returnValues[0])
    })

    it('should not withdraw if withdrawToOwnerOnBalance is not given', async function () {
      await env.newServerInstance({}, getTemporaryWorkdirs())
      assert.equal(env.relayServer.config.withdrawToOwnerOnBalance, undefined)
      const serverSpy = sinon.spy(env.relayServer)
      const txHashes = await env.relayServer.withdrawToOwnerIfNeeded(currentBlockNumber, currentBlockHash, currentBlockTimestamp)
      assert.deepEqual(txHashes, [])
      sinon.assert.calledOnce(serverSpy.isReady)
      assert.isTrue(serverSpy.isReady.returnValues[0])
    })

    it('should withdraw to owner when hub balance is sufficient', async function () {
      await env.relayHub.depositFor(env.relayServer.managerAddress, { value: 2e18.toString() })
      await env.relayHub.depositFor(env.relayServer.managerAddress, { value: 2e18.toString() })
      const owner = env.relayServer.config.ownerAddress
      const balanceBefore = toBN(await env.web3.eth.getBalance(owner))
      const serverSpy = sinon.spy(env.relayServer)
      const sendBalanceSpy = sinon.spy(env.relayServer.registrationManager, '_sendManagerHubBalanceToOwner')
      const loggerSpy = sinon.spy(env.relayServer.logger, 'info')
      const managerTargetBalance = toBN(env.relayServer.config.managerTargetBalance)
      const workerTargetBalance = toBN(env.relayServer.config.workerTargetBalance)
      const reserveBalance = managerTargetBalance.add(workerTargetBalance)
      const managerHubBalanceBefore = await env.relayHub.balanceOf(env.relayServer.managerAddress)
      assert.isTrue(managerHubBalanceBefore.gte(toBN(withdrawToOwnerOnBalance).add(reserveBalance)))
      const withdrawalAmount = managerHubBalanceBefore.sub(reserveBalance)
      const txHashes = await env.relayServer.withdrawToOwnerIfNeeded(currentBlockNumber, currentBlockHash, currentBlockTimestamp)
      const balanceAfter = await env.web3.eth.getBalance(owner)
      assert.deepEqual(txHashes.length, 1)
      assert.equal(balanceBefore.add(withdrawalAmount).toString(), balanceAfter)
      sinon.assert.callOrder(
        serverSpy.isReady,
        sendBalanceSpy,
        loggerSpy
      )
      sinon.assert.calledWith(loggerSpy, `Withdrew ${withdrawalAmount.toString()} to owner`)
      sinon.assert.calledWith(sendBalanceSpy, currentBlockNumber, currentBlockHash, currentBlockTimestamp, withdrawalAmount)
    })

    it('should not withdraw to owner when hub balance is too low', async function () {
      await env.relayHub.depositFor(env.relayServer.managerAddress, { value: 2e18.toString() })
      await env.relayHub.depositFor(env.relayServer.managerAddress, { value: 1e18.toString() })
      const owner = env.relayServer.config.ownerAddress
      const balanceBefore = toBN(await env.web3.eth.getBalance(owner))
      const serverSpy = sinon.spy(env.relayServer)
      const sendBalanceSpy = sinon.spy(env.relayServer.registrationManager, '_sendManagerHubBalanceToOwner')
      const loggerSpy = sinon.spy(env.relayServer.logger, 'info')
      const managerTargetBalance = toBN(env.relayServer.config.managerTargetBalance)
      const workerTargetBalance = toBN(env.relayServer.config.workerTargetBalance)
      const reserveBalance = managerTargetBalance.add(workerTargetBalance)
      const managerHubBalanceBefore = await env.relayHub.balanceOf(env.relayServer.managerAddress)
      assert.isTrue(managerHubBalanceBefore.gte(toBN(withdrawToOwnerOnBalance)))
      assert.isTrue(managerHubBalanceBefore.lt(toBN(withdrawToOwnerOnBalance).add(reserveBalance)))
      const txHashes = await env.relayServer.withdrawToOwnerIfNeeded(currentBlockNumber, currentBlockHash, currentBlockTimestamp)
      const balanceAfter = await env.web3.eth.getBalance(owner)
      assert.deepEqual(txHashes.length, 0)
      assert.equal(balanceBefore.toString(), balanceAfter)
      sinon.assert.callOrder(
        serverSpy.isReady
      )
      sinon.assert.notCalled(loggerSpy)
      sinon.assert.notCalled(sendBalanceSpy)
    })
  })

  describe('relay workers/manager rebalancing', function () {
    let relayServer: RelayServer
    const workerIndex = 0
    const gasPrice = 1e9.toString()
    let beforeDescribeId: string
    // web3 estimate seems to add '1 gas' somewhere
    const txCost = toBN((defaultEnvironment.mintxgascost + 1) * parseInt(gasPrice))

    async function depleteWorker (): Promise<void> {
      relayServer = env.relayServer
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.workerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: accounts[0],
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        creationBlockNumber: 0,
        creationBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        creationBlockTimestamp: 0,
        value: toHex(workerBalanceBefore.sub(txCost))
      })
      await relayServer._refreshAndCheckBalances()
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.lt(toBN(relayServer.config.workerMinBalance)),
        'worker balance should be lower than min balance')
    }

    // TODO: not needed, worker is not funded at this point!
    beforeEach('deplete worker balance', async function () {
      beforeDescribeId = (await snapshot()).result
      await env.newServerInstance({ recentActionAvoidRepeatDistanceBlocks: 0 })
      await depleteWorker()
    })

    afterEach(async function () {
      await revert(beforeDescribeId)
    })

    beforeEach(async function () {
      id = (await snapshot()).result
      await env.clearServerStorage()
    })

    afterEach(async function () {
      await revert(id)
      relayServer.transactionManager._initNonces()
      await env.clearServerStorage()
      sinon.restore()
    })

    it('should not replenish when all balances are sufficient', async function () {
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: relayServer.config.managerTargetBalance
      })
      await env.web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.workerAddress, value: relayServer.config.workerTargetBalance })
      await relayServer._refreshAndCheckBalances()
      const currentBlockNumber = await env.web3.eth.getBlockNumber()
      const receipts = await relayServer.replenishServer(workerIndex, 0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
      assert.deepEqual(receipts, [])
      assert.equal(currentBlockNumber, await env.web3.eth.getBlockNumber())
    })

    it('should withdraw hub balance to manager first, then use eth balance to fund workers', async function () {
      await env.relayHub.depositFor(relayServer.managerAddress, { value: 1e18.toString() })
      const managerEthBalanceFirst = await relayServer.getManagerBalance()
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        creationBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        creationBlockTimestamp: 0,
        destination: accounts[0],
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        value: toHex(managerEthBalanceFirst.sub(txCost))
      })
      //  web3 estimate seems to add '1 gas' somewhere
      assert.equal((await relayServer.getManagerBalance()).toString(), '1000000000')
      await env.web3.eth.sendTransaction(
        { from: accounts[0], to: relayServer.managerAddress, value: relayServer.config.managerTargetBalance - 1e10 })
      await relayServer._refreshAndCheckBalances()
      const managerHubBalanceBefore = await env.relayHub.balanceOf(relayServer.managerAddress)
      const managerEthBalanceBefore = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance.toString()).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.gte(refill), 'manager hub balance should be sufficient to replenish worker')
      assert.isTrue(managerEthBalanceBefore.lt(toBN(relayServer.config.managerTargetBalance.toString())),
        'manager eth balance should be lower than target to withdraw hub balance')
      const receipts = await relayServer.replenishServer(workerIndex, 0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
      const totalTxCosts = await getTotalTxCosts(receipts, await env.web3.eth.getGasPrice())
      const managerHubBalanceAfter = await env.relayHub.balanceOf(relayServer.managerAddress)
      assert.isTrue(managerHubBalanceAfter.eqn(0), 'manager hub balance should be zero')
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
      const managerEthBalanceAfter = await relayServer.getManagerBalance()
      assert.isTrue(managerEthBalanceAfter.eq(managerEthBalanceBefore.add(managerHubBalanceBefore).sub(refill).sub(totalTxCosts)),
        'manager eth balance should increase by hub balance minus txs costs')
    })

    it('should fund from manager eth balance when sufficient without withdrawing from hub when balance too low', async function () {
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: 1e18
      })
      await relayServer._refreshAndCheckBalances()
      const managerHubBalanceBefore = await env.relayHub.balanceOf(relayServer.managerAddress)
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.gte(refill), 'manager eth balance should be sufficient to replenish worker')
      await relayServer.replenishServer(workerIndex, 0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
    })

    it('should log error when both eth and hub balances are too low', async function () {
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        creationBlockNumber: 0,
        creationBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        creationBlockTimestamp: 0,
        destination: accounts[0],
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        value: toHex((await relayServer.getManagerBalance()).sub(txCost))
      })
      await relayServer._refreshAndCheckBalances()
      const managerHubBalanceBefore = await env.relayHub.balanceOf(relayServer.managerAddress)
      const managerEthBalance = await relayServer.getManagerBalance()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalanceBefore.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.lt(refill), 'manager eth balance should be insufficient to replenish worker')
      const spy = sinon.spy(env.relayServer.logger, 'error')
      await relayServer.replenishServer(workerIndex, 0, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
      sinon.assert.calledWith(spy, `== replenishServer: can't replenish: balance too low ${managerEthBalance.toString()} refill=${refill.toString()}`)
    })

    it('should withdraw hub balance if manager balance is above min but isn\'t enough to replenish worker', async function () {
      const desiredBalance = toBN(relayServer.config.workerTargetBalance).muln(0.8)
      let managerHubBalance = await env.relayHub.balanceOf(relayServer.managerAddress)
      const block = await env.web3.eth.getBlock('latest')
      await env.relayServer._withdrawHubDeposit(managerHubBalance, block.number, block.hash, toNumber(block.timestamp))
      let managerEthBalance = await env.relayServer.getManagerBalance()
      await relayServer.transactionManager.sendTransaction({
        signer: relayServer.managerAddress,
        serverAction: ServerAction.VALUE_TRANSFER,
        destination: accounts[0],
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        creationBlockNumber: 0,
        creationBlockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        creationBlockTimestamp: 0,
        value: toHex(managerEthBalance.sub(txCost))
      })
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.managerAddress,
        value: desiredBalance
      })
      await env.relayHub.depositFor(env.relayServer.managerAddress, { value: desiredBalance })
      await env.clearServerStorage()
      managerEthBalance = await relayServer.getManagerBalance()
      managerHubBalance = await env.relayHub.balanceOf(relayServer.managerAddress)
      assert.equal(managerEthBalance.sub(toBN(1e9.toString())).toString(), desiredBalance.toString())
      assert.equal(managerHubBalance.toString(), desiredBalance.toString())

      // When worker has at least min balance, do not do anything
      await env.web3.eth.sendTransaction({
        from: accounts[0],
        to: relayServer.workerAddress,
        value: relayServer.config.workerMinBalance
      })
      await relayServer._refreshAndCheckBalances()
      const blockNumber = await env.web3.eth.getBlockNumber()
      const txHashes = await relayServer.replenishServer(workerIndex, blockNumber, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
      assert.equal(txHashes.length, 0)
      managerEthBalance = await relayServer.getManagerBalance()
      managerHubBalance = await env.relayHub.balanceOf(relayServer.managerAddress)
      assert.equal(managerEthBalance.sub(toBN(1e9.toString())).toString(), desiredBalance.toString())
      assert.equal(managerHubBalance.toString(), desiredBalance.toString())
      const workerBalance = await relayServer.getWorkerBalance(workerIndex)
      assert.equal(workerBalance.sub(toBN(1e9.toString())).toString(), env.relayServer.config.workerMinBalance.toString())

      // When worker has less than min balance, replenish it
      await depleteWorker()
      const workerBalanceBefore = await relayServer.getWorkerBalance(workerIndex)
      const refill = toBN(relayServer.config.workerTargetBalance).sub(workerBalanceBefore)
      assert.isTrue(managerHubBalance.gt(toBN(relayServer.config.managerMinBalance)), 'manager balance should be at least min balance')
      assert.isTrue(managerHubBalance.lt(refill), 'manager hub balance should be insufficient to replenish worker')
      assert.isTrue(managerEthBalance.lt(refill), 'manager eth balance should be insufficient to replenish worker')
      await relayServer.replenishServer(workerIndex, blockNumber, '0x0000000000000000000000000000000000000000000000000000000000000000', 0)
      const workerBalanceAfter = await relayServer.getWorkerBalance(workerIndex)
      managerHubBalance = await env.relayHub.balanceOf(relayServer.managerAddress)
      assert.equal(managerHubBalance.toString(), '0')
      assert.isTrue(workerBalanceAfter.eq(workerBalanceBefore.add(refill)),
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `workerBalanceAfter (${workerBalanceAfter.toString()}) != workerBalanceBefore (${workerBalanceBefore.toString()}) + refill (${refill.toString()}`)
    })
  })

  describe('server keepalive re-registration', function () {
    const refreshStateTimeoutBlocks = 1
    let relayServer: RelayServer
    let latestBlock: Block
    let receipts: string[]

    async function checkRegistration (shouldRegister: boolean): Promise<void> {
      latestBlock = await ethersProvider.getBlock('latest')
      receipts = await relayServer._worker(latestBlock)
      expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any,
        shouldRegister)
      if (shouldRegister) {
        await assertRelayAdded(receipts, relayServer, false)
        latestBlock = await ethersProvider.getBlock('latest')
        receipts = await relayServer._worker(latestBlock)
        expect(relayServer.registrationManager.handlePastEvents).to.have.been.calledWith(sinon.match.any, sinon.match.any, sinon.match.any, sinon.match.any,
          false)
      }
      assert.equal(receipts.length, 0, 'should not re-register if already registered')
    }

    beforeEach(async function () {
      id = (await snapshot()).result
      await env.newServerInstance({
        refreshStateTimeoutBlocks
      })
      relayServer = env.relayServer
      sinon.spy(relayServer.registrationManager, 'handlePastEvents')

      await checkRegistration(false)
      await increaseTime(registrationRateSeconds + 1)
      await evmMineMany(relayServer.config.recentActionAvoidRepeatDistanceBlocks + 1)
      await checkRegistration(true)
    })

    afterEach(async function () {
      await revert(id)
      sinon.restore()
    })

    it('should re-register server if registrationRateSeconds passed from register tx regardless of other txs', async function () {
      // When no other tx happened
      await increaseTime(registrationRateSeconds + 1)
      await evmMineMany(relayServer.config.recentActionAvoidRepeatDistanceBlocks + 1)
      await checkRegistration(true)
      // When relayed call txs were sent inside the registrationBlockRate window, but no register tx,
      // server should still re-register
      for (let i = 1; i < registrationRateSeconds - 1; i += 1000) {
        const req = await env.createRelayHttpRequest()
        await relayServer.createRelayTransaction(req)
        await checkRegistration(false)
      }
      await increaseTime(registrationRateSeconds + 1)
      await evmMineMany(relayServer.config.recentActionAvoidRepeatDistanceBlocks + 1)
      await evmMine()
      await checkRegistration(true)
    })
  })

  describe('listener task', function () {
    let relayServer: RelayServer
    let origWorker: (block: Block) => Promise<PrefixedHexString[]>
    let started: boolean
    beforeEach(function () {
      relayServer = env.relayServer
      origWorker = relayServer._worker
      started = false
      relayServer._worker = async function () {
        await Promise.resolve()
        started = true
        this.emit('error', new Error('GOTCHA'))
        return []
      }
    })
    afterEach(function () {
      relayServer._worker = origWorker
    })
    it.skip('should start block listener', async function () {
      relayServer.start()
      await evmMine()
      await sleep(200)
      assert.isTrue(started, 'could not start task correctly')
    })
    it.skip('should stop block listener', async function () {
      relayServer.stop()
      await evmMine()
      await sleep(200)
      assert.isFalse(started, 'could not stop task correctly')
    })
  })

  describe('alerted state as griefing mitigation', function () {
    const alertedDelaySeconds = 100
    const refreshStateTimeoutBlocks = 1
    let rejectingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
    let newServer: RelayServer

    beforeEach('should enter an alerted state for a configured blocks delay after paymaster rejecting an on-chain tx', async function () {
      id = (await snapshot()).result
      await env.newServerInstance({
        alertedDelaySeconds,
        refreshStateTimeoutBlocks
      })
      newServer = env.relayServer
      rejectingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
      await rejectingPaymaster.setTrustedForwarder(env.forwarder.address)
      await rejectingPaymaster.setRelayHub(env.relayHub.address)
      await rejectingPaymaster.deposit({ value: env.web3.utils.toWei('1', 'ether') })
      await attackTheServer(newServer)
    })
    afterEach(async function () {
      await revert(id)
      newServer.transactionManager._initNonces()
    })

    async function attackTheServer (server: RelayServer): Promise<void> {
      const _sendTransactionOrig = server.transactionManager.sendTransaction
      server.transactionManager.sendTransaction = async function (
        {
          signer,
          method,
          destination,
          value = '0x',
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas
        }: SendTransactionDetails): Promise<SignedTransactionDetails> {
        await rejectingPaymaster.setRevertPreRelayCall(true)
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/return-await
        return (await _sendTransactionOrig.call(server.transactionManager, ...arguments))
      }
      const req = await env.createRelayHttpRequest({}, { paymasterAddress: rejectingPaymaster.address })
      await env.relayServer.createRelayTransaction(req)
      // await relayTransaction(relayTransactionParams2, options2, { paymaster: rejectingPaymaster.address }, false)
      const currentBlock = await ethersProvider.getBlock('latest')
      await server._worker(currentBlock)
      assert.isTrue(server.alerted, 'server not alerted')
      assert.equal(server.alertedByTransactionBlockTimestamp, currentBlock.timestamp, 'server alerted block incorrect')
    }

    it('should delay transactions in alerted state', async function () {
      newServer.config.minAlertedDelayMS = 300
      newServer.config.maxAlertedDelayMS = 350
      const timeBefore = Date.now()
      const req = await env.createRelayHttpRequest()
      await env.relayServer.createRelayTransaction(req)
      // await relayTransaction(relayTransactionParams, options)
      const timeAfter = Date.now()
      assert.isTrue((timeAfter - timeBefore) > 300, 'checking that enough time passed')
    })

    it('should exit alerted state after the configured blocks delay', async function () {
      await increaseTime(newServer.config.alertedDelaySeconds - 1)
      let latestBlock = await ethersProvider.getBlock('latest')
      await newServer._worker(latestBlock)
      assert.isTrue(newServer.alerted, 'server not alerted')
      await evmMineMany(2)
      latestBlock = await ethersProvider.getBlock('latest')
      await newServer._worker(latestBlock)
      assert.isFalse(newServer.alerted, 'server alerted')
    })
  })
})
