import { GsnTestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { AccountKeypair } from '@opengsn/provider/dist/AccountManager'
import { Address } from '@opengsn/common/dist/types/Aliases'
import { expectEvent } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'
import abi from 'web3-eth-abi'

import {
  ProxyDeployingPaymasterInstance,
  ProxyFactoryInstance,
  TestCounterInstance,
  TestTokenInstance
} from '@opengsn/paymasters/types/truffle-contracts'
import ProxyRelayProvider from '../src/ProxyRelayProvider'
import { GSNConfig } from '@opengsn/provider'

const RelayHub = artifacts.require('RelayHub')
const TestToken = artifacts.require('TestToken')
const TestCounter = artifacts.require('TestCounter')
const TestUniswap = artifacts.require('TestUniswap')
const ProxyFactory = artifacts.require('ProxyFactory')
const ProxyDeployingPaymaster = artifacts.require('ProxyDeployingPaymaster')

contract('ProxyRelayProvider', function () {
  let token: TestTokenInstance
  let proxyFactory: ProxyFactoryInstance
  let paymaster: ProxyDeployingPaymasterInstance
  let proxyRelayProvider: ProxyRelayProvider

  before(async function () {
    proxyFactory = await ProxyFactory.new()
    const uniswap = await TestUniswap.new(2, 1, {
      value: (5e18).toString(),
      gas: 1e7
    })
    proxyFactory = await ProxyFactory.new()
    token = await TestToken.at(await uniswap.tokenAddress())
    paymaster = await ProxyDeployingPaymaster.new([uniswap.address], proxyFactory.address)
    const host = (web3.currentProvider as HttpProvider).host
    const {
      httpServer,
      contractsDeployment: {
        relayHubAddress,
        forwarderAddress
      }
    } = await GsnTestEnvironment.startGsn(host)

    // TODO: fix
    // @ts-ignore
    httpServer.relayService?.config.maxAcceptanceBudget = 1e15.toString()

    const hub = await RelayHub.at(relayHubAddress!)
    await paymaster.setRelayHub(hub.address)
    await paymaster.setTrustedForwarder(forwarderAddress!)
    await hub.depositFor(paymaster.address, {
      value: 1e18.toString()
    })
    const gsnConfig: Partial<GSNConfig> = {
      loggerConfiguration: {
        logLevel: 'error'
      },
      paymasterAddress: paymaster.address
    }
    proxyRelayProvider = await ProxyRelayProvider.newProxyRelayProvider(
      proxyFactory.address,
      {
        provider: web3.currentProvider as HttpProvider,
        config: gsnConfig,
        overrideDependencies: {
          asyncPaymasterData: async () => {
            // @ts-ignore
            return abi.encodeParameters(['address'], [uniswap.address])
          }
        }
      }
    ).init()
  })

  context('#_ethSendTransaction()', function () {
    let counter: TestCounterInstance
    let gaslessAccount: AccountKeypair
    let proxyAddress: Address

    before(async function () {
      counter = await TestCounter.new()
      // @ts-ignore
      TestCounter.web3.setProvider(proxyRelayProvider)
      gaslessAccount = proxyRelayProvider.newAccount()
      proxyAddress = await proxyRelayProvider.calculateProxyAddress(gaslessAccount.address)

      await token.mint(1e18.toString())
      await token.transfer(proxyAddress, 1e18.toString())
    })

    it('should relay transparently', async function () {
      const countBefore = await counter.count()
      assert.strictEqual(countBefore.toNumber(), 0)

      const tx1 = await counter.increment({
        from: gaslessAccount.address,
        gasPrice: 1
      })

      await expectEvent.inTransaction(tx1.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })

      const countAfter1 = await counter.count()
      assert.strictEqual(countAfter1.toNumber(), 1)

      const tx2 = await counter.increment({
        from: gaslessAccount.address,
        gasPrice: 1
      })
      const countAfter2 = await counter.count()
      assert.strictEqual(countAfter2.toNumber(), 2)
      await expectEvent.not.inTransaction(tx2.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })
      await expectEvent.inTransaction(tx2.tx, TestToken, 'Transfer')
    })
  })
})
