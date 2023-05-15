import { StaticJsonRpcProvider, JsonRpcProvider } from '@ethersproject/providers'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { evmMine, evmMineMany } from './TestUtils'
import { ContractInteractor, LoggerInterface, GSNContractsDeployment, defaultEnvironment } from '@opengsn/common'
import { HttpProvider } from 'web3-core'
import { ProfilingProvider } from '@opengsn/common/dist/dev/ProfilingProvider'
import { ServerTestEnvironment } from './ServerTestEnvironment'
import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'

contract('RelayServerRequestsProfiling', function (accounts) {
  const refreshStateTimeoutBlocks = 2
  const callsPerStateRefresh = 13
  const callsPerBlock = 0
  const callsPerTransaction = 10

  let ethersProvider: JsonRpcProvider
  let provider: ProfilingProvider
  let relayServer: RelayServer
  let env: ServerTestEnvironment
  let logger: LoggerInterface

  before(async function () {
    logger = createServerLogger('error', '', '')
    // @ts-ignore
    const currentProviderHost = web3.currentProvider.host
    ethersProvider = new StaticJsonRpcProvider(currentProviderHost)
    provider = new ProfilingProvider(currentProviderHost)
    const contractFactory = async function (deployment: GSNContractsDeployment): Promise<ContractInteractor> {
      const maxPageSize = Number.MAX_SAFE_INTEGER
      const contractInteractor = new ContractInteractor({
        environment: defaultEnvironment, maxPageSize, provider, logger, deployment
      })
      await contractInteractor.init()
      return contractInteractor
    }
    env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init({}, {}, contractFactory)
    await env.newServerInstance({ refreshStateTimeoutBlocks })
    relayServer = env.relayServer
    const latestBlock = await ethersProvider.getBlock('latest')
    await relayServer._worker(latestBlock)
  })

  beforeEach(async function () {
    provider.reset()
  })

  it('should make X requests per block callback when state must be refreshed', async function () {
    await evmMineMany(5)
    const latestBlock = await ethersProvider.getBlock('latest')
    assert.isTrue(relayServer._shouldRefreshState(latestBlock))
    const receipts = await relayServer._worker(latestBlock)
    assert.equal(receipts.length, 0)
    provider.log()
    assert.equal(provider.requestsCount, callsPerStateRefresh)
  })

  it('should make X requests per block callback when nothing needs to be done', async function () {
    await evmMine()
    const latestBlock = await ethersProvider.getBlock('latest')
    assert.isFalse(relayServer._shouldRefreshState(latestBlock))
    const receipts = await relayServer._worker(latestBlock)
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
