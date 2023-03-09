import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { ReputationStoreManager } from '@opengsn/relay/dist/ReputationStoreManager'
import { constants, ContractInteractor, defaultEnvironment } from '@opengsn/common'
import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'
import {
  PaymasterStatus,
  ReputationManager,
  ReputationManagerConfiguration
} from '@opengsn/relay/dist/ReputationManager'
import { evmMineMany } from './TestUtils'

/**
 * Attention: these tests are often order and timestamp-dependent! Use debugger with caution.
 */
contract('ReputationManager', function () {
  const paymaster = constants.ZERO_ADDRESS
  const initialReputation = 2
  const throttleDelayMs = 100
  const abuseTimeWindowBlocks = 100
  const abuseBlacklistDurationBlocks = 100
  let contractInteractor: ContractInteractor
  let reputationManager: ReputationManager
  let reputationStoreManager: ReputationStoreManager
  let saveNow: any
  let currentNow: number

  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

  function mockSleep (sleepTime: number): void {
    currentNow += sleepTime
  }

  before(async function () {
    saveNow = Date.now
    currentNow = saveNow()
    Date.now = () => {
      currentNow++
      return currentNow
    }

    const logger = createServerLogger('error', '', '')
    const reputationManagerConfig: Partial<ReputationManagerConfiguration> = {
      initialReputation,
      throttleDelayMs,
      abuseTimeWindowBlocks,
      abuseBlacklistDurationBlocks
    }
    reputationStoreManager = new ReputationStoreManager({ inMemory: true }, logger)
    await reputationStoreManager.clearAll()
    reputationManager = new ReputationManager(reputationStoreManager, logger, reputationManagerConfig)
    const maxPageSize = Number.MAX_SAFE_INTEGER
    contractInteractor = new ContractInteractor({
      environment: defaultEnvironment,
      provider: ethersProvider,
      maxPageSize,
      logger
    })
    await contractInteractor.init()
  })

  after(() => {
    Date.now = saveNow
  })

  describe('getPaymasterStatus', function () {
    it('should report paymaster as THROTTLED if requesting multiple transactions too fast', async function () {
      const currentBlockNumber = await contractInteractor.getBlockNumber()
      let status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.GOOD)
      await reputationManager.updatePaymasterStatus(paymaster, false, currentBlockNumber)
      await reputationManager.onRelayRequestAccepted(paymaster)
      status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.THROTTLED)
    })

    it('should report paymaster as GOOD if enough time has passed since the last one', async function () {
      mockSleep(throttleDelayMs)
      const currentBlockNumber = await contractInteractor.getBlockNumber()
      const status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.GOOD)
    })

    it('should report paymaster as BLOCKED if the reputation falls to 0', async function () {
      const currentBlockNumber = await contractInteractor.getBlockNumber()
      let status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.GOOD)
      await reputationManager.updatePaymasterStatus(paymaster, false, currentBlockNumber)
      status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.BLOCKED)
    })

    it('should reset the paymaster reputation after abuse cool-down period', async function () {
      let currentBlockNumber = await contractInteractor.getBlockNumber()
      await reputationStoreManager.clearAll()
      await reputationStoreManager.createEntry(paymaster, initialReputation)
      await reputationStoreManager.setAbuseFlag(paymaster, currentBlockNumber)
      let status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.ABUSED)
      await evmMineMany(abuseBlacklistDurationBlocks + 1)
      currentBlockNumber = await contractInteractor.getBlockNumber()
      status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.GOOD)
    })
  })

  describe('updatePaymasterStatus', function () {
    beforeEach(async function () {
      await reputationStoreManager.clearAll()
      await reputationStoreManager.createEntry(paymaster, 100)
    })

    it('should detect an abuse if the reputation drops too fast', async function () {
      const currentBlockNumber = await contractInteractor.getBlockNumber()
      let status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.GOOD)
      for (let i = 0; i <= 20; i++) {
        await reputationManager.updatePaymasterStatus(paymaster, false, currentBlockNumber)
      }
      status = await reputationManager.getPaymasterStatus(paymaster, currentBlockNumber)
      assert.equal(status, PaymasterStatus.ABUSED)
    })

    it('should not update reputation above the specified maximum value', async function () {
      const currentBlockNumber = await contractInteractor.getBlockNumber()
      const entry = await reputationStoreManager.getEntry(paymaster)
      assert.equal(entry?.reputation, 100)
      await reputationManager.updatePaymasterStatus(paymaster, true, currentBlockNumber)
      assert.equal(entry?.reputation, 100)
    })
  })
})
