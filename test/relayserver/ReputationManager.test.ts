import { ReputationStoreManager } from '../../src/relayserver/ReputationStoreManager'
import { constants } from '../../src/common/Constants'
import { createServerLogger } from '../../src/relayserver/ServerWinstonLogger'
import { sleep } from '../../src/common/Utils'
import {
  PaymasterStatus,
  ReputationManager,
  ReputationManagerConfiguration
} from '../../src/relayserver/ReputationManager'

/**
 * Attention: these tests are often order and timestamp-dependent! Use debugger with caution.
 */
contract('ReputationManager', function () {
  const paymaster = constants.ZERO_ADDRESS
  const initialReputation = 2
  const throttleDelayMs = 100
  const abuseTimeWindowMs = 1000
  const abuseBlockDurationMs = 1000
  let reputationManager: ReputationManager
  let reputationStoreManager: ReputationStoreManager

  before(async function () {
    const logger = createServerLogger('error', '', '')
    const reputationManagerConfig: Partial<ReputationManagerConfiguration> = {
      initialReputation,
      throttleDelayMs,
      abuseTimeWindowMs,
      abuseBlockDurationMs
    }
    reputationStoreManager = new ReputationStoreManager({}, logger)
    await reputationStoreManager.clearAll()
    reputationManager = new ReputationManager(reputationStoreManager, logger, reputationManagerConfig)
  })

  describe('getPaymasterStatus', function () {
    it('should report paymaster as THROTTLED if requesting multiple transactions too fast', async function () {
      let status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.GOOD)
      await reputationManager.updatePaymasterStatus(paymaster, false)
      await reputationManager.onRelayRequestAccepted(paymaster)
      status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.THROTTLED)
    })

    it('should report paymaster as GOOD if enough time has passed since the last one', async function () {
      await sleep(throttleDelayMs)
      const status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.GOOD)
    })

    it('should report paymaster as BLOCKED if the reputation falls to 0', async function () {
      let status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.GOOD)
      await reputationManager.updatePaymasterStatus(paymaster, false)
      status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.BLOCKED)
    })

    it('should reset the paymaster reputation after abuse cool-down period', async function () {
      await reputationStoreManager.clearAll()
      await reputationStoreManager.createEntry(paymaster, initialReputation)
      await reputationStoreManager.setAbuseFlag(paymaster)
      let status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.ABUSED)
      await sleep(2 * abuseBlockDurationMs)
      status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.GOOD)
    })
  })

  describe('updatePaymasterStatus', function () {
    beforeEach(async function () {
      await reputationStoreManager.clearAll()
      await reputationStoreManager.createEntry(paymaster, 100)
    })

    it('should detect an abuse if the reputation drops too fast', async function () {
      let status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.GOOD)
      for (let i = 0; i <= 20; i++) {
        await reputationManager.updatePaymasterStatus(paymaster, false)
      }
      status = await reputationManager.getPaymasterStatus(paymaster)
      assert.equal(status, PaymasterStatus.ABUSED)
    })

    it('should not update reputation above the specified maximum value', async function () {
      const entry = await reputationStoreManager.getEntry(paymaster)
      assert.equal(entry?.reputation, 100)
      await reputationManager.updatePaymasterStatus(paymaster, true)
      assert.equal(entry?.reputation, 100)
    })
  })
})
