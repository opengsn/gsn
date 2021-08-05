import { HttpProvider } from 'web3-core'
import { TxOptions } from '@ethereumjs/tx'
import { PrefixedHexString } from 'ethereumjs-util'
import { toBN, toHex } from 'web3-utils'

import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { LoggerInterface } from '@opengsn/common/dist/LoggerInterface'
import { NetworkSimulatingProvider } from '@opengsn/common/dist/dev/NetworkSimulatingProvider'
import { ServerTestEnvironment } from './ServerTestEnvironment'
import { SignedTransactionDetails } from '@opengsn/relay/dist/TransactionManager'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { createClientLogger } from '@opengsn/provider/dist/ClientWinstonLogger'
import { evmMine, evmMineMany, revert, snapshot } from './TestUtils'
import { signedTransactionToHash } from '@opengsn/common/dist/Utils'
import { GSNContractsDeployment } from '@opengsn/common/dist/GSNContractsDeployment'

contract('Network Simulation for Relay Server', function (accounts) {
  const pendingTransactionTimeoutBlocks = 5

  let logger: LoggerInterface
  let env: ServerTestEnvironment
  let provider: NetworkSimulatingProvider

  before(async function () {
    logger = createClientLogger({ logLevel: 'error' })
    provider = new NetworkSimulatingProvider(web3.currentProvider as HttpProvider)
    const maxPageSize = Number.MAX_SAFE_INTEGER
    const contractFactory = async function (deployment: GSNContractsDeployment): Promise<ContractInteractor> {
      const contractInteractor = new ContractInteractor({
        maxPageSize,
        provider,
        logger,
        deployment
      })
      await contractInteractor.init()
      return contractInteractor
    }
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    const clientConfig: Partial<GSNConfig> = { maxRelayNonceGap: 5 }
    await env.init(clientConfig, {}, contractFactory)
    await env.newServerInstance({ pendingTransactionTimeoutBlocks })
    provider.setDelayTransactions(true)
  })

  describe('without automated mining', function () {
    beforeEach(async function () {
      await env.clearServerStorage()
    })

    it('should resolve once the transaction is broadcast', async function () {
      assert.equal(provider.mempool.size, 0)
      const { txHash } = await env.relayTransaction(false)
      assert.equal(provider.mempool.size, 1)
      const receipt = await env.web3.eth.getTransactionReceipt(txHash)
      assert.isNull(receipt)
      await provider.mineTransaction(txHash)
      assert.equal(provider.mempool.size, 0)
      await env.assertTransactionRelayed(txHash)
    })

    it('should broadcast multiple transactions at once', async function () {
      assert.equal(provider.mempool.size, 0)
      // cannot use the same sender as it will create same request with same forwarder nonce, etc
      const overrideDetails = { from: accounts[1] }
      // noinspection ES6MissingAwait - done on purpose
      const promises = [env.relayTransaction(false), env.relayTransaction(false, overrideDetails)]
      const txs = await Promise.all(promises)
      assert.equal(provider.mempool.size, 2)
      await provider.mineTransaction(txs[0].txHash)
      await env.assertTransactionRelayed(txs[0].txHash)
      await provider.mineTransaction(txs[1].txHash)
      await env.assertTransactionRelayed(txs[1].txHash, overrideDetails)
    })
  })

  describe('boosting stuck pending transactions', function () {
    const gasPriceBelowMarket = toHex(20e9)
    const gasPriceAboveMarket = toHex(30e9)
    const expectedGasPriceAfterBoost = toBN(gasPriceBelowMarket).muln(12).divn(10).toString()
    const stuckTransactionsCount = 5
    const fairlyPricedTransactionIndex = 3
    const originalTxHashes: string[] = []
    const overrideParamsPerTx = new Map<PrefixedHexString, Partial<GsnTransactionDetails>>()

    let rawTxOptions: TxOptions

    before(async function () {
      await env.relayServer.txStoreManager.clearAll()
      await sendMultipleRelayedTransactions()
    })

    describe('first time boosting stuck transactions', function () {
      let id: string

      before(async () => {
        id = (await snapshot()).result
      })

      after(async () => {
        await revert(id)
      })

      it('should not boost and resend transactions if not that many blocks passed since it was sent', async function () {
        const latestBlock = await env.web3.eth.getBlock('latest')
        const allBoostedTransactions = await env.relayServer._boostStuckPendingTransactions(latestBlock.number)
        assert.equal(allBoostedTransactions.size, 0)
        const storedTxs = await env.relayServer.txStoreManager.getAll()
        assert.equal(storedTxs.length, stuckTransactionsCount)
        for (let i = 0; i < stuckTransactionsCount; i++) {
          assert.equal(storedTxs[i].txId, originalTxHashes[i])
        }
      })

      it('should boost and resend underpriced transactions if the oldest one does not get mined after being sent for a long time', async function () {
        // Increase time by mining necessary amount of blocks
        await evmMineMany(pendingTransactionTimeoutBlocks)

        const latestBlock = await env.web3.eth.getBlock('latest')
        const allBoostedTransactions = await env.relayServer._boostStuckPendingTransactions(latestBlock.number)

        // NOTE: this is needed for the 'repeated boosting' test
        for (const [originalTxHash, signedTransactionDetails] of allBoostedTransactions) {
          overrideParamsPerTx.set(signedTransactionDetails.transactionHash, overrideParamsPerTx.get(originalTxHash)!)
        }

        // Tx #3 should not be changed
        assert.equal(allBoostedTransactions.size, stuckTransactionsCount - 1)
        await assertGasPrice(allBoostedTransactions, expectedGasPriceAfterBoost)
      })
    })

    describe('repeated boosting', function () {
      const expectedGasPriceAfterSecondBoost = toBN(expectedGasPriceAfterBoost).muln(12).divn(10).toString()

      before('boosting transaction', async function () {
        await env.relayServer.txStoreManager.clearAll()
        await env.relayServer.transactionManager._initNonces()
        await sendMultipleRelayedTransactions()
        await evmMineMany(pendingTransactionTimeoutBlocks)
        const latestBlock = await env.web3.eth.getBlock('latest')
        const allBoostedTransactions = await env.relayServer._boostStuckPendingTransactions(latestBlock.number)
        assert.equal(allBoostedTransactions.size, stuckTransactionsCount - 1)
      })

      it('should not resend the transaction if not enough blocks passed since it was boosted', async function () {
        await evmMineMany(pendingTransactionTimeoutBlocks - 1)
        const latestBlock = await env.web3.eth.getBlock('latest')
        const allBoostedTransactions = await env.relayServer._boostStuckPendingTransactions(latestBlock.number)
        assert.equal(allBoostedTransactions.size, 0)
      })

      it('should boost transactions that are not mined after being boosted another time', async function () {
        await evmMine()
        const latestBlock = await env.web3.eth.getBlock('latest')
        const allBoostedTransactions = await env.relayServer._boostStuckPendingTransactions(latestBlock.number)
        assert.equal(allBoostedTransactions.size, stuckTransactionsCount - 1)
        await assertGasPrice(allBoostedTransactions, expectedGasPriceAfterSecondBoost)
      })
    })

    async function sendMultipleRelayedTransactions (): Promise<void> {
      for (let i = 0; i < stuckTransactionsCount; i++) {
        // Transaction #3 will have a sufficient gas price and shall not be boosted
        // All transaction must come from different senders or else will be rejected on 'nonce mismatch'
        const overrideTxParams: Partial<GsnTransactionDetails> = {
          from: accounts[i],
          gasPrice: i === fairlyPricedTransactionIndex ? gasPriceAboveMarket : gasPriceBelowMarket
        }
        const { signedTx } = await env.relayTransaction(false, overrideTxParams)
        rawTxOptions = env.relayServer.transactionManager.rawTxOptions
        const transactionHash = signedTransactionToHash(signedTx, rawTxOptions)
        originalTxHashes.push(transactionHash)
        overrideParamsPerTx.set(transactionHash, overrideTxParams)
      }
    }

    async function assertGasPrice (signedTransactions: Map<PrefixedHexString, SignedTransactionDetails>, expectedGasPriceAfterBoost: string): Promise<void> {
      let i = 0
      for (const [originalTxHash, signedTransactionDetails] of signedTransactions) {
        if (i === fairlyPricedTransactionIndex) {
          await provider.mineTransaction(originalTxHashes[fairlyPricedTransactionIndex])
        }
        await provider.mineTransaction(signedTransactionDetails.transactionHash)
        const minedTx = await env.web3.eth.getTransaction(signedTransactionDetails.transactionHash)
        const actualTxGasPrice = toBN(minedTx.gasPrice).toString()
        assert.equal(actualTxGasPrice, expectedGasPriceAfterBoost)
        const overrideDetails = overrideParamsPerTx.get(originalTxHash)
        await env.assertTransactionRelayed(signedTransactionDetails.transactionHash, overrideDetails)
        i++
      }
    }
  })
})
