import { ServerTestEnvironment } from './ServerTestEnvironment'
import { NetworkSimulatingProvider } from '../../src/common/dev/NetworkSimulatingProvider'
import { HttpProvider } from 'web3-core'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import ContractInteractor from '../../src/relayclient/ContractInteractor'

contract('Network Simulation for Relay Server', function (accounts) {
  let env: ServerTestEnvironment
  let provider: NetworkSimulatingProvider

  before(async function () {
    provider = new NetworkSimulatingProvider(web3.currentProvider as HttpProvider)
    const contractFactory = async function (partialConfig: Partial<GSNConfig>): Promise<ContractInteractor> {
      const contractInteractor = new ContractInteractor(provider, configureGSN(partialConfig))
      await contractInteractor.init()
      return contractInteractor
    }
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init({}, {}, contractFactory)
    await env.newServerInstance()
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
})
