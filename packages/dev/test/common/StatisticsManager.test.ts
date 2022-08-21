import { HttpProvider } from 'web3-core'

import { StatisticsManager } from '@opengsn/common/dist/statistics/StatisticsManager'
import { HttpClient, HttpWrapper, toNumber } from '@opengsn/common'

import { ServerTestEnvironment } from '../ServerTestEnvironment'
import { TestPaymasterConfigurableMisbehaviorInstance } from '@opengsn/contracts/types/truffle-contracts'
import { evmMine } from '../TestUtils'

const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

contract('StatisticsManager', function (accounts) {
  let statusLogic: StatisticsManager
  let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance

  before(async function () {
    const env = new ServerTestEnvironment(web3.currentProvider as HttpProvider, accounts)
    await env.init()

    // add misbehaving paymaster
    misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
    await misbehavingPaymaster.setRelayHub(env.relayHub.address)
    await misbehavingPaymaster.setTrustedForwarder(env.forwarder.address)
    await env.relayHub.depositFor(misbehavingPaymaster.address, {
      from: accounts[0],
      value: 1e18.toString(),
      gasPrice: 1e9
    })
    // create 3 relays
    await env.newServerInstance()
    const relayToUnregister = env.relayServer.managerAddress
    await env.newServerInstance()
    await env.newServerInstance()
    let currentBlockNumber = await web3.eth.getBlockNumber()
    const block = await web3.eth.getBlock(currentBlockNumber)
    const currentBlockTimestamp = toNumber(block.timestamp)

    // unregister 1 relay
    await env.stakeManager.unlockStake(relayToUnregister, { from: accounts[4] })

    // second registration
    await env.relayServer.registrationManager.attemptRegistration(currentBlockNumber, block.hash, currentBlockTimestamp)

    // three transactions to relay, one transaction to be rejected
    await env.relayServer.createRelayTransaction(await env.createRelayHttpRequest())
    await env.relayServer.createRelayTransaction(await env.createRelayHttpRequest())
    await env.relayServer.createRelayTransaction(await env.createRelayHttpRequest())
    await misbehavingPaymaster.setRevertPreRelayCallOnEvenBlocks(true)
    currentBlockNumber = await web3.eth.getBlockNumber()
    if (currentBlockNumber % 2 !== 0) {
      await evmMine()
    }

    await env.relayServer.createRelayTransaction(await env.createRelayHttpRequest({}, { paymasterAddress: misbehavingPaymaster.address }))

    const httpClient = new HttpClient(new HttpWrapper(), env.relayServer.logger)
    statusLogic = new StatisticsManager(env.contractInteractor, httpClient, env.relayServer.logger)
  })

  // TODO: cover more code paths
  describe('on active GSN deployment', function () {
    it('should gather network statistics', async function () {
      const statistics = await statusLogic.gatherStatistics()
      // console.log(new CommandLineStatisticsPresenter(defaultCommandLineStatisticsPresenterConfig).getStatisticsStringPresentation(statistics))
      assert.equal(statistics.relayServers.length, 3)
      assert.equal(statistics.paymasters.length, 2)
    })
  })
})
