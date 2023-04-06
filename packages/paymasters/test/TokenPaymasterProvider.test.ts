import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { ContractFactory } from 'ethers'
import { HttpProvider } from 'web3-core'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { expectEvent } from '@openzeppelin/test-helpers'
import { toWei } from 'web3-utils'

import { deployTestHub, mergeRelayRequest } from './TestUtils'
import { constants } from '@opengsn/common/dist/Constants'
import {
  defaultEnvironment,
  GSNConfig,
  removeHexPrefix,
  RelayRequest,
  DAI_CONTRACT_ADDRESS,
  UNI_CONTRACT_ADDRESS,
  USDC_CONTRACT_ADDRESS,
  WETH9_CONTRACT_ADDRESS
} from '@opengsn/common'
import {
  ForwarderInstance,
  PenalizerInstance,
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance,
  RelayHubInstance,
  SampleRecipientInstance,
  StakeManagerInstance,
  TestHubInstance,
  TestTokenInstance
} from '../types/truffle-contracts'
import { deployHub, revert, snapshot, startRelay, stopRelay } from '@opengsn/dev/dist/test/TestUtils'

import {
  GasAndEthConfig,
  UniswapConfig,
  TokenPaymasterProvider,
  CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS,
  DAI_ETH_POOL_FEE,
  GAS_USED_BY_POST,
  GSN_FORWARDER_CONTRACT_ADDRESS,
  MIN_HUB_BALANCE,
  MIN_SWAP_AMOUNT,
  MIN_WITHDRAWAL_AMOUNT,
  PERMIT_SELECTOR_DAI,
  PERMIT_SELECTOR_EIP2612,
  PERMIT_SIGNATURE_DAI,
  PERMIT_SIGNATURE_EIP2612,
  SLIPPAGE,
  SWAP_ROUTER_CONTRACT_ADDRESS,
  TARGET_HUB_BALANCE,
  UNI_ETH_POOL_FEE,
  USDC_ETH_POOL_FEE
} from '../src'

import {
  detectMainnet,
  ETHER,
  GAS_PRICE,
  impersonateAccount,
  MAJOR_DAI_AND_UNI_HOLDER,
  skipWithoutFork
} from './ForkTestUtils'

import { ChildProcessWithoutNullStreams } from 'child_process'
import { TokenPaymasterEthersWrapper } from '../src/WrapContract'

const PermitERC20UniswapV3Paymaster = artifacts.require('PermitERC20UniswapV3Paymaster')
const PermitInterfaceEIP2612 = artifacts.require('PermitInterfaceEIP2612')
const PermitInterfaceDAI = artifacts.require('PermitInterfaceDAI')
const SampleRecipient = artifacts.require('SampleRecipient')

const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestToken = artifacts.require('TestToken')

const { expect, assert } = chai.use(chaiAsPromised)

contract('TokenPaymasterProvider', function ([account0, relay, owner]) {
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const provider = new StaticJsonRpcProvider(currentProviderHost)

  let permitPaymaster: PermitERC20UniswapV3PaymasterInstance
  let daiPermittableToken: PermitInterfaceDAIInstance
  let uniPermittableToken: PermitInterfaceEIP2612Instance
  let usdcPermittableToken: PermitInterfaceEIP2612Instance
  let sampleRecipient: SampleRecipientInstance
  let testRelayHub: TestHubInstance

  let relayRequest: RelayRequest

  let id: string

  before(async function () {
    if (!await detectMainnet()) {
      this.skip()
    }
    await impersonateAccount(MAJOR_DAI_AND_UNI_HOLDER)
    sampleRecipient = await SampleRecipient.new({ gasPrice: 22e9 })
    await sampleRecipient.setForwarder(GSN_FORWARDER_CONTRACT_ADDRESS)
    daiPermittableToken = await PermitInterfaceDAI.at(DAI_CONTRACT_ADDRESS)
    uniPermittableToken = await PermitInterfaceEIP2612.at(UNI_CONTRACT_ADDRESS)
    usdcPermittableToken = await PermitInterfaceEIP2612.at(USDC_CONTRACT_ADDRESS)
    testRelayHub = await deployTestHub() as TestHubInstance
    // in case the MAJOR_DAI_AND_UNI_HOLDER account does not have ETH on actual mainnet
    await web3.eth.sendTransaction({
      from: account0,
      to: MAJOR_DAI_AND_UNI_HOLDER,
      value: 1e18
    })
    // we cannot sign on behalf of an impersonated account - transfer tokens to an account we control
    await daiPermittableToken.transfer(account0, toWei('100000', 'ether'), { from: MAJOR_DAI_AND_UNI_HOLDER })
    await uniPermittableToken.transfer(account0, toWei('100000', 'ether'), { from: MAJOR_DAI_AND_UNI_HOLDER })
    await usdcPermittableToken.transfer(account0, toWei('0.0001', 'ether'), { from: MAJOR_DAI_AND_UNI_HOLDER })
    const uniswapConfig: UniswapConfig = {
      uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
      weth: WETH9_CONTRACT_ADDRESS,
      minSwapAmount: MIN_SWAP_AMOUNT,
      tokens: [DAI_CONTRACT_ADDRESS, USDC_CONTRACT_ADDRESS, UNI_CONTRACT_ADDRESS],
      priceFeeds: [CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS, CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS, CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS],
      uniswapPoolFees: [DAI_ETH_POOL_FEE, USDC_ETH_POOL_FEE, UNI_ETH_POOL_FEE],
      permitMethodSignatures: [PERMIT_SIGNATURE_DAI, PERMIT_SIGNATURE_EIP2612, PERMIT_SIGNATURE_EIP2612],
      slippages: [SLIPPAGE, SLIPPAGE, SLIPPAGE],
      reverseQuotes: [false, false, false]
    }
    const gasAndEthConfig: GasAndEthConfig = {
      gasUsedByPost: GAS_USED_BY_POST,
      minHubBalance: MIN_HUB_BALANCE,
      targetHubBalance: TARGET_HUB_BALANCE,
      minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
      paymasterFee: 5
    }
    permitPaymaster = await PermitERC20UniswapV3Paymaster.new(uniswapConfig, gasAndEthConfig, GSN_FORWARDER_CONTRACT_ADDRESS, testRelayHub.address, { from: owner })
    relayRequest = {
      relayData: {
        relayWorker: relay,
        paymaster: permitPaymaster.address,
        forwarder: GSN_FORWARDER_CONTRACT_ADDRESS,
        transactionCalldataGasUsed: '0',
        maxFeePerGas: GAS_PRICE,
        maxPriorityFeePerGas: GAS_PRICE,
        paymasterData: '0x',
        clientId: '1'
      },
      request: {
        data: sampleRecipient.contract.methods.something().encodeABI(),
        nonce: '0',
        value: '0',
        validUntilTime: '0',
        from: account0,
        to: sampleRecipient.address,
        gas: 1e6.toString()
      }
    }
  })

  beforeEach(async function () {
    id = (await snapshot()).result
  })

  afterEach(async function () {
    await revert(id)
  })

  let tokenPaymasterProvider: TokenPaymasterProvider
  context('initialization', function () {
    it('should initialize provider with token address', async function () {
      await skipWithoutFork(this)

      const gsnConfig: Partial<GSNConfig> = {
        paymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'error' }
      }
      tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider
      })
      await tokenPaymasterProvider.init(USDC_CONTRACT_ADDRESS)
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor.token.address, USDC_CONTRACT_ADDRESS)
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor.paymaster.address, permitPaymaster.address)
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor.tokenSwapData?.permitMethodSelector, PERMIT_SELECTOR_EIP2612)
    })

    it('should throw if given unsupported token', async function () {
      await skipWithoutFork(this)

      const gsnConfig: Partial<GSNConfig> = {
        paymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'error' }
      }
      tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider
      })
      await tokenPaymasterProvider.init(USDC_CONTRACT_ADDRESS)
      const promise = tokenPaymasterProvider.setToken(owner)
      await expect(promise).to.be.eventually.rejectedWith(`token ${owner.toLowerCase()} reported as not supported by paymaster ${permitPaymaster.address}`)
    })

    it('should be able to change used token', async function () {
      await skipWithoutFork(this)

      const gsnConfig: Partial<GSNConfig> = {
        paymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'error' }
      }
      tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider
      })
      await tokenPaymasterProvider.init(USDC_CONTRACT_ADDRESS)
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor.tokenAddress, USDC_CONTRACT_ADDRESS)

      // changing selected token
      await tokenPaymasterProvider.setToken(DAI_CONTRACT_ADDRESS)
      // @ts-ignore
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor.tokenAddress, DAI_CONTRACT_ADDRESS)
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor.tokenSwapData?.permitMethodSelector, PERMIT_SELECTOR_DAI)
    })
  })

  context('#autoSelectToken()', function () {
    it('should select a token with the highest balance value converted to Ether', async function () {
      await skipWithoutFork(this)
      const gsnConfig: Partial<GSNConfig> = {
        paymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'error' }
      }
      const tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider
      })
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor, undefined)
      await tokenPaymasterProvider.init()
      assert.equal(tokenPaymasterProvider.tokenPaymasterInteractor.token.address, USDC_CONTRACT_ADDRESS)
    })

    it.skip('should select a token with approval if it has balance', function () {
      // TODO: this is a little tricky so not implementing it for now
      assert.fail()
    })
  })

  context('#_buildPaymasterData()', function () {
    it('should throw if paymaster address in provider doesn\'t match relayRequest', async function () {
      await skipWithoutFork(this)
      const gsnConfig: Partial<GSNConfig> = {
        paymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'error' }
      }
      tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider
      })
      await tokenPaymasterProvider.init(USDC_CONTRACT_ADDRESS)
      const promise = tokenPaymasterProvider._buildPaymasterData(mergeRelayRequest(relayRequest, { paymaster: '0x' }))
      await expect(promise).to.be.eventually.rejectedWith('Paymaster address mismatch')
    })

    it('should build paymaster data without permit method', async function () {
      await skipWithoutFork(this)
      const gsnConfig: Partial<GSNConfig> = {
        paymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'error' }
      }
      tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider
      })
      await tokenPaymasterProvider.init(USDC_CONTRACT_ADDRESS)
      await usdcPermittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
      const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
      assert.equal(paymasterData, USDC_CONTRACT_ADDRESS)
    })

    context('with permit method', function () {
      it('should build paymaster data for dai', async function () {
        await skipWithoutFork(this)
        const gsnConfig: Partial<GSNConfig> = {
          paymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' }
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider
        })
        await tokenPaymasterProvider.init(DAI_CONTRACT_ADDRESS)
        const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
        assert.equal(paymasterData.slice(0, 42), DAI_CONTRACT_ADDRESS)
        assert.equal(paymasterData.slice(42, 50), removeHexPrefix(PERMIT_SELECTOR_DAI))
      })

      it('should build paymaster data for usdc', async function () {
        await skipWithoutFork(this)
        const gsnConfig: Partial<GSNConfig> = {
          paymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' }
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider
        })
        await tokenPaymasterProvider.init(USDC_CONTRACT_ADDRESS)
        const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
        assert.equal(paymasterData.slice(0, 42), USDC_CONTRACT_ADDRESS)
        assert.equal(paymasterData.slice(42, 50), removeHexPrefix(PERMIT_SELECTOR_EIP2612))
      })

      it('should build paymaster data for uni', async function () {
        await skipWithoutFork(this)
        const gsnConfig: Partial<GSNConfig> = {
          paymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' }
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider
        })
        await tokenPaymasterProvider.init(UNI_CONTRACT_ADDRESS)
        const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
        assert.equal(paymasterData.slice(0, 42), UNI_CONTRACT_ADDRESS)
        assert.equal(paymasterData.slice(42, 50), removeHexPrefix(PERMIT_SELECTOR_EIP2612))
      })
    })
  })

  context('relay flow', function () {
    let testToken: TestTokenInstance
    let relayProcess: ChildProcessWithoutNullStreams
    let gsnConfig: Partial<GSNConfig>
    let relayHub: RelayHubInstance
    let forwarderInstance: ForwarderInstance

    beforeEach(async function () {
      await skipWithoutFork(this)

      const stake = ETHER
      testToken = await TestToken.new()
      const stakeManager: StakeManagerInstance = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
      const penalizer: PenalizerInstance = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString())
      forwarderInstance = await Forwarder.at(GSN_FORWARDER_CONTRACT_ADDRESS)
      // await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, forwarderInstance)
      await sampleRecipient.setForwarder(forwarderInstance.address)

      await permitPaymaster.setTrustedForwarder(forwarderInstance.address, { from: owner })
      await permitPaymaster.setRelayHub(relayHub.address, { from: owner })
      await web3.eth.sendTransaction({
        from: account0,
        to: permitPaymaster.address,
        value: stake
      })
      await permitPaymaster.refillHubDeposit(stake, { from: owner })

      gsnConfig = {
        paymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'error' },
        jsonStringifyRequest: false
      }

      await testToken.mint(stake, { from: owner })
      await testToken.approve(stakeManager.address, stake, { from: owner })
      relayProcess = await startRelay(relayHub.address, testToken, stakeManager, {
        relaylog: process.env.relaylog,
        initialReputation: 100,
        stake: stake.toString(),
        relayOwner: owner,
        ethereumNodeUrl: (web3.currentProvider as HttpProvider).host
      })
    })

    afterEach(async function () {
      stopRelay(relayProcess)
    })

    it('should relay transparently', async function () {
      await skipWithoutFork(this)
      tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider
      })
      await tokenPaymasterProvider.init()

      // @ts-ignore
      const origProvider = SampleRecipient.web3.currentProvider
      // @ts-ignore
      SampleRecipient.web3.setProvider(tokenPaymasterProvider)
      const res = await sampleRecipient.something({ gasPrice: 50e9, gas: 3e5, from: account0 })
      // const receipt = await web3.eth.getTransactionReceipt(res.receipt.actualTransactionHash)
      const hubLogs = await relayHub.getPastEvents('TransactionRelayed', { fromBlock: res.receipt.blockNumber })
      expectEvent(res, 'Sender', {
        _msgSenderFunc: account0,
        sender: forwarderInstance.address
      })
      assert.equal(hubLogs.length, 1)
      assert.equal(hubLogs[0].event, 'TransactionRelayed')
      assert.equal(hubLogs[0].returnValues.from, account0)
      assert.equal(hubLogs[0].returnValues.to, sampleRecipient.address)
      assert.equal(hubLogs[0].returnValues.status, '0')
      assert.equal(hubLogs[0].returnValues.paymaster, permitPaymaster.address)

      // @ts-ignore
      SampleRecipient.web3.setProvider(origProvider)
    })

    it('should wrap ethers.js Contract instance with TokenPaymasterProvider', async function () {
      await skipWithoutFork(this)
      this.timeout(60000)
      const ethersProvider = new StaticJsonRpcProvider((web3.currentProvider as any).host)
      const signer = ethersProvider.getSigner()
      // @ts-ignores
      const factory = await new ContractFactory(SampleRecipient.abi, SampleRecipient.bytecode, signer)
      const recipient = await factory.attach(sampleRecipient.address)
      const wrappedGsnRecipient = await TokenPaymasterEthersWrapper.wrapContract(recipient, gsnConfig)
      const signerAddress = await signer.getAddress()
      const balanceBefore = await web3.eth.getBalance(signerAddress)
      const ret = await wrappedGsnRecipient.something({ gasPrice: 1e10 })
      const rcpt = await ret.wait()
      const balanceAfter = await web3.eth.getBalance(signerAddress)
      assert.equal(balanceBefore.toString(), balanceAfter.toString())
      expectEvent.inLogs(rcpt.events, 'Sender', { _msgSenderFunc: signerAddress, sender: forwarderInstance.address })
    })
  })
})
