import { GsnTestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { AccountKeypair } from '@opengsn/provider/dist/AccountManager'
import { Address } from '@opengsn/common/dist/types/Aliases'
import { expectEvent } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'
import abi from 'web3-eth-abi'

import {
  PermitERC20UniswapV3PaymasterInstance, ProxyFactoryInstance,
  TestCounterInstance, TestHubInstance,
  TestTokenInstance
} from '@opengsn/paymasters/types/truffle-contracts'
import { GSNConfig } from '@opengsn/provider'
import { TokenPaymasterProvider } from '../src/TokenPaymasterProvider'
import {
  CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS, CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS, CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS,
  DAI_CONTRACT_ADDRESS, GSN_FORWARDER_CONTRACT_ADDRESS, PaymasterConfig, PERMIT_SIGNATURE_DAI, PERMIT_SIGNATURE_EIP2612,
  SWAP_ROUTER_CONTRACT_ADDRESS,
  UNI_CONTRACT_ADDRESS,
  USDC_CONTRACT_ADDRESS,
  WETH9_CONTRACT_ADDRESS
} from '../src/PermitPaymasterUtils'
import { deployTestHub } from './TestUtils'
import { toBN } from 'web3-utils'
import { ProxyRelayProvider } from '../src'

const RelayHub = artifacts.require('RelayHub')
const TestToken = artifacts.require('TestToken')
const TestCounter = artifacts.require('TestCounter')
const TestUniswap = artifacts.require('TestUniswap')
const ProxyFactory = artifacts.require('ProxyFactory')
const PermitERC20UniswapV3Paymaster = artifacts.require('PermitERC20UniswapV3Paymaster')

const GAS_USED_BY_POST = 204766
const MAX_POSSIBLE_GAS = 1e6
const DAI_ETH_POOL_FEE = 500
const USDC_ETH_POOL_FEE = 500
const UNI_ETH_POOL_FEE = 3000
const MIN_HUB_BALANCE = 1e17.toString()
const TARGET_HUB_BALANCE = 1e18.toString()
const MIN_WITHDRAWAL_AMOUNT = 2e18.toString()
const ETHER = toBN(1e18.toString())


contract('TokenPaymasterProvider', function ([owner, ]) {
  let token: TestTokenInstance
  let paymaster: PermitERC20UniswapV3PaymasterInstance
  let tokenPaymasterProvider: TokenPaymasterProvider
  let proxyFactory:ProxyFactoryInstance
  let proxyRelayProvider: ProxyRelayProvider
  let testRelayHub: TestHubInstance

  before(async function () {
    testRelayHub = await deployTestHub() as TestHubInstance
    const uniswap = await TestUniswap.new(2, 1, {
      value: (5e18).toString(),
      gas: 1e7
    })
    token = await TestToken.at(await uniswap.tokenAddress())
    const config: PaymasterConfig = {
      weth: WETH9_CONTRACT_ADDRESS,
      tokens: [DAI_CONTRACT_ADDRESS, USDC_CONTRACT_ADDRESS, UNI_CONTRACT_ADDRESS],
      relayHub: testRelayHub.address,
      uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
      priceFeeds: [CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS, CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS, CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS],
      trustedForwarder: GSN_FORWARDER_CONTRACT_ADDRESS,
      uniswapPoolFees: [DAI_ETH_POOL_FEE, USDC_ETH_POOL_FEE, UNI_ETH_POOL_FEE],
      gasUsedByPost: GAS_USED_BY_POST,
      permitMethodSignatures: [PERMIT_SIGNATURE_DAI, PERMIT_SIGNATURE_EIP2612, PERMIT_SIGNATURE_EIP2612],
      minHubBalance: MIN_HUB_BALANCE,
      targetHubBalance: TARGET_HUB_BALANCE,
      minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
      paymasterFee: 5
    }
    paymaster = await PermitERC20UniswapV3Paymaster.new(config, { from: owner })
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
    // await paymaster.setRelayHub(hub.address)
    // await paymaster.setTrustedForwarder(forwarderAddress!)
    await hub.depositFor(paymaster.address, {
      value: 1e18.toString()
    })
    const gsnConfig: Partial<GSNConfig> = {
      loggerConfiguration: {
        logLevel: 'error'
      },
      maxPaymasterDataLength: 32,
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

  context('initialization', function () {
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
      const { maxFeePerGas, maxPriorityFeePerGas } = await proxyRelayProvider.calculateGasFees()
      const tx1: any = await counter.increment({
        from: gaslessAccount.address,
        maxFeePerGas,
        maxPriorityFeePerGas
      })

      await expectEvent.inTransaction(tx1.receipt.actualTransactionHash, ProxyFactory, 'ProxyDeployed', { proxyAddress })

      const countAfter1 = await counter.count()
      assert.strictEqual(countAfter1.toNumber(), 1)
      const tx2: any = await counter.increment({
        from: gaslessAccount.address,
        maxFeePerGas,
        maxPriorityFeePerGas
      })
      const countAfter2 = await counter.count()
      assert.strictEqual(countAfter2.toNumber(), 2)
      await expectEvent.not.inTransaction(tx2.receipt.actualTransactionHash, ProxyFactory, 'ProxyDeployed', { proxyAddress })
      await expectEvent.inTransaction(tx2.receipt.actualTransactionHash, TestToken, 'Transfer')
    })
  })

  context('#_buildPaymasterData()')
  context('#useToken()')
  context('Relay transparently through token paymaster provider')
})
