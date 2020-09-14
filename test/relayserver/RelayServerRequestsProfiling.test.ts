import { RelayServer } from '../../src/relayserver/RelayServer'
import { evmMine, evmMineMany } from '../TestUtils'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { HttpProvider } from 'web3-core'
import { ProfilingProvider } from '../../src/common/dev/ProfilingProvider'
import { ServerTestEnvironment } from './ServerTestEnvironment'

contract('RelayServerRequestsProfiling', function (accounts) {
  const refreshStateTimeoutBlocks = 2
  const callsPerStateRefresh = 11
  const callsPerBlock = 0
  const callsPerTransaction = 26

  let provider: ProfilingProvider
  let relayServer: RelayServer
  let env: ServerTestEnvironment

  before(async function () {
    provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
    const contractFactory = async function (partialConfig: Partial<GSNConfig>): Promise<ContractInteractor> {
      const contractInteractor = new ContractInteractor(provider, configureGSN(partialConfig))
      await contractInteractor.init()
      return contractInteractor
    }
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init({}, {}, contractFactory)
    await env.newServerInstance({ refreshStateTimeoutBlocks })
    relayServer = env.relayServer
    const latestBlock = await web3.eth.getBlock('latest')
    await relayServer._worker(latestBlock.number)
  })

  beforeEach(async function () {
    provider.reset()
  })

  it('should make X requests per block callback when state must be refreshed', async function () {
    await evmMineMany(5)
    const latestBlock = await web3.eth.getBlock('latest')
    assert.isTrue(relayServer._shouldRefreshState(latestBlock.number))
    const receipts = await relayServer._worker(latestBlock.number)
    assert.equal(receipts.length, 0)
    provider.log()
    assert.equal(provider.requestsCount, callsPerStateRefresh)
  })

  it('should make X requests per block callback when nothing needs to be done', async function () {
    await evmMine()
    const latestBlock = await web3.eth.getBlock('latest')
    assert.isFalse(relayServer._shouldRefreshState(latestBlock.number))
    const receipts = await relayServer._worker(latestBlock.number)
    assert.equal(receipts.length, 0)
    provider.log()
    assert.equal(provider.requestsCount, callsPerBlock)
  })

  describe('relay transaction', function () {
    before(async function () {
      provider.reset()
    })

    it('should make X requests per relay transaction request', async function () {
      await env.relayTransaction()
      provider.log()
      assert.equal(provider.requestsCount, callsPerTransaction)
    })
  })
})
