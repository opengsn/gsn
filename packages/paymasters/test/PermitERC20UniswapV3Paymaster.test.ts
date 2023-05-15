import BN from 'bn.js'
import { toBN, toWei } from 'web3-utils'
import { toChecksumAddress } from 'ethereumjs-util'
import {
  IChainlinkOracleInstance,
  IERC20MetadataInstance,
  IQuoterInstance,
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance,
  SampleRecipientInstance,
  TestHubInstance
} from '../types/truffle-contracts'

import { calculatePostGas, deployTestHub, mergeRelayRequest, revertReason } from './TestUtils'
import {
  GasAndEthConfig,
  signAndEncodeDaiPermit,
  signAndEncodeEIP2612Permit, UniswapConfig
} from '../src/PermitPaymasterUtils'
import { revert, snapshot } from '@opengsn/dev/dist/test/TestUtils'
import { expectEvent } from '@openzeppelin/test-helpers'
import { EIP712DomainType, EIP712DomainTypeWithoutVersion } from '@opengsn/common/dist/EIP712/TypedRequestData'
import {
  DAI_CONTRACT_ADDRESS,
  RelayRequest,
  UNI_CONTRACT_ADDRESS,
  USDC_CONTRACT_ADDRESS,
  WETH9_CONTRACT_ADDRESS,
  constants,
  removeHexPrefix
} from '@opengsn/common'

import {
  PERMIT_SIGNATURE_DAI,
  PERMIT_SIGNATURE_EIP2612,
  CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS,
  GSN_FORWARDER_CONTRACT_ADDRESS,
  SWAP_ROUTER_CONTRACT_ADDRESS,
  UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS,
  UNISWAP_V3_QUOTER_CONTRACT_ADDRESS,
  UNISWAP_V3_USDC_WETH_POOL_CONTRACT_ADDRESS,
  DAI_ETH_POOL_FEE,
  GAS_USED_BY_POST,
  MIN_HUB_BALANCE, MIN_SWAP_AMOUNT,
  MIN_WITHDRAWAL_AMOUNT,
  SLIPPAGE,
  TARGET_HUB_BALANCE,
  UNI_ETH_POOL_FEE,
  USDC_ETH_POOL_FEE
} from '../src/constants/MainnetPermitERC20UniswapV3PaymasterConstants'

import {
  getDaiDomainSeparator,
  getUniDomainSeparator,
  getUSDCDomainSeparator,
  detectMainnet,
  ETHER,
  GAS_PRICE,
  impersonateAccount,
  MAJOR_DAI_AND_UNI_HOLDER,
  skipWithoutFork
} from './ForkTestUtils'
import { wrapInputProviderLike } from '@opengsn/provider'

const PermitERC20UniswapV3Paymaster = artifacts.require('PermitERC20UniswapV3Paymaster')
const PermitInterfaceEIP2612 = artifacts.require('PermitInterfaceEIP2612')
const PermitInterfaceDAI = artifacts.require('PermitInterfaceDAI')
const IChainlinkOracle = artifacts.require('IChainlinkOracle')
const SampleRecipient = artifacts.require('SampleRecipient')
const IQuoter = artifacts.require('IQuoter')
const TestUniswap = artifacts.require('TestUniswap')

const MAX_POSSIBLE_GAS = 1e6
const TOKEN_PRE_CHARGE = 1000

const gasUseWithoutPost = 100000
const ethActualCharge = (gasUseWithoutPost + GAS_USED_BY_POST) * parseInt(GAS_PRICE)
const minDepositAmount = toBN(TARGET_HUB_BALANCE).sub(toBN(MIN_HUB_BALANCE)).add(toBN(ethActualCharge))

function concatHexStrings (str1: string, str2: string): string {
  return '0x' + removeHexPrefix(str1) + removeHexPrefix(str2)
}

contract('PermitERC20UniswapV3Paymaster', function ([account0, account1, relay, owner]) {
  let permitPaymaster: PermitERC20UniswapV3PaymasterInstance
  let daiPermittableToken: PermitInterfaceDAIInstance
  let uniPermittableToken: PermitInterfaceEIP2612Instance
  let usdcPermittableToken: PermitInterfaceEIP2612Instance
  let chainlinkOracleDAIETH: IChainlinkOracleInstance
  let chainlinkOracleUSDCETH: IChainlinkOracleInstance
  let chainlinkOracleUNIETH: IChainlinkOracleInstance
  let sampleRecipient: SampleRecipientInstance
  let testRelayHub: TestHubInstance
  let quoter: IQuoterInstance

  let relayRequest: RelayRequest
  let uniswapConfig: UniswapConfig
  let gasAndEthConfig: GasAndEthConfig

  let id: string

  before(async function () {
    if (!await detectMainnet()) {
      this.skip()
    }
    await impersonateAccount(MAJOR_DAI_AND_UNI_HOLDER)
    sampleRecipient = await SampleRecipient.new({ gasPrice: 22e9 })
    await sampleRecipient.setForwarder(GSN_FORWARDER_CONTRACT_ADDRESS)
    quoter = await IQuoter.at(UNISWAP_V3_QUOTER_CONTRACT_ADDRESS)
    daiPermittableToken = await PermitInterfaceDAI.at(DAI_CONTRACT_ADDRESS)
    uniPermittableToken = await PermitInterfaceEIP2612.at(UNI_CONTRACT_ADDRESS)
    usdcPermittableToken = await PermitInterfaceEIP2612.at(USDC_CONTRACT_ADDRESS)
    chainlinkOracleDAIETH = await IChainlinkOracle.at(CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS)
    chainlinkOracleUSDCETH = await IChainlinkOracle.at(CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS)
    chainlinkOracleUNIETH = await IChainlinkOracle.at(CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS)
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
    uniswapConfig = {
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
    gasAndEthConfig = {
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

  interface TokenInfo {
    priceQuote: BN
    priceDivisor: BN
    tokenActualCharge: BN
    expectedRefund: BN
    pmContext: any
    modifiedRequest: RelayRequest
    preBalance: BN
  }

  async function rechargePaymaster (
    paymaster: PermitERC20UniswapV3PaymasterInstance,
    oracle: IChainlinkOracleInstance,
    token: IERC20MetadataInstance,
    tokenAmount = minDepositAmount,
    withPreCharge = true): Promise<TokenInfo> {
    const oracleFeed = await oracle.latestAnswer()
    const priceDivisor = toBN((await paymaster.getTokenSwapData(token.address)).priceDivisor.toString())
    const priceQuote = await paymaster.toActualQuote(oracleFeed, priceDivisor)
    const decimals = await token.decimals()
    const preChargeMultiplier = toBN(10).pow(decimals)
    const tokenDepositAmount = await paymaster.weiToToken(tokenAmount, priceQuote, false)
    const tokenPreCharge = withPreCharge ? toBN(TOKEN_PRE_CHARGE).mul(preChargeMultiplier) : toBN(0)

    await token.approve(paymaster.address, constants.MAX_UINT256, { from: account0 })
    const preBalance = tokenDepositAmount.add(tokenPreCharge).muln(1.1)
    await token.transfer(paymaster.address, preBalance, { from: account0 })

    const pmContext = web3.eth.abi.encodeParameters(['address', 'address', 'uint256', 'uint256', 'bool'], [token.address, account0, priceQuote.toString(), tokenPreCharge.toString(), false])
    const modifiedRequest = mergeRelayRequest(relayRequest, {
      paymasterData: token.address
    })
    const tokenActualCharge = await paymaster.addPaymasterFee(await paymaster.weiToToken(ethActualCharge, priceQuote, false))
    const expectedRefund = tokenPreCharge.sub(tokenActualCharge)
    return { priceQuote, priceDivisor, tokenActualCharge, expectedRefund, pmContext, modifiedRequest, preBalance }
  }

  context('#preRelayedCall', function () {
    context('revert reasons', function () {
      it('should revert if approval data is provided', async function () {
        await skipWithoutFork(this)
        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              relayRequest,
              '0x',
              '0x123',
              MAX_POSSIBLE_GAS
            )
          ), /should have no approvalData/)
      })

      it('should revert if paymasterData is too short', async function () {
        await skipWithoutFork(this)
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: '0x1234'
        })

        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /must contain token address/)

        modifiedRequest.relayData.paymasterData = concatHexStrings(DAI_CONTRACT_ADDRESS, 'ff')

        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /must contain "permit" and token/)
      })

      it('should revert if token is unsupported', async function () {
        await skipWithoutFork(this)
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: testRelayHub.address
        })

        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /unsupported token/)
      })

      it('should revert if paymasterData is not an encoded call to permit method', async function () {
        await skipWithoutFork(this)
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: concatHexStrings(DAI_CONTRACT_ADDRESS, '0x12345678')
        })

        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /wrong "permit" method sig/)
      })

      it('should revert if permit call reverts', async function () {
        await skipWithoutFork(this)
        const incorrectNonce = 777
        const domainSeparator = getDaiDomainSeparator()
        const encodedCallToPermit = await signAndEncodeDaiPermit(
          account0,
          permitPaymaster.address,
          daiPermittableToken.address,
          constants.MAX_UINT256.toString(),
          (await wrapInputProviderLike(web3.currentProvider as any)).provider,
          domainSeparator,
          '_v4',
          false,
          incorrectNonce,
          true
        )
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: concatHexStrings(DAI_CONTRACT_ADDRESS, encodedCallToPermit)
        })
        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /permit call reverted:/)
      })

      it('should revert if token transferFrom reverts', async function () {
        await skipWithoutFork(this)
        await daiPermittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account1 })
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: DAI_CONTRACT_ADDRESS
        }, { from: account1 })
        const balance = await daiPermittableToken.balanceOf(account1)
        assert.equal(balance.toString(), '0')
        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /Dai\/insufficient-balance/)
      })
    })

    context('with paymasterData', function () {
      it('should execute permit method on a target DAI token', async function () {
        await skipWithoutFork(this)
        const approvalBefore = await daiPermittableToken.allowance(account0, permitPaymaster.address)
        assert.equal(approvalBefore.toString(), '0', 'unexpected approval')
        const accountBalanceBefore = await daiPermittableToken.balanceOf(account0)
        const spenderBalanceBefore = await daiPermittableToken.balanceOf(permitPaymaster.address)
        assert.equal(spenderBalanceBefore.toString(), '0', 'unexpected balance')
        const encodedCallToPermit = await signAndEncodeDaiPermit(
          account0,
          permitPaymaster.address,
          daiPermittableToken.address,
          constants.MAX_UINT256.toString(),
          (await wrapInputProviderLike(web3.currentProvider as any)).provider,
          getDaiDomainSeparator(),
          '_v4',
          false
        )
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: concatHexStrings(DAI_CONTRACT_ADDRESS, encodedCallToPermit)
        })
        await testRelayHub.callPreRC(
          modifiedRequest,
          '0x',
          '0x',
          MAX_POSSIBLE_GAS
        )

        const paymasterBalanceAfter = await daiPermittableToken.balanceOf(permitPaymaster.address)
        // it is dependant on actual cost of ether on uniswap, but pre-charge below 10¢ will be unfortunate
        assert.isAbove(parseInt(paymasterBalanceAfter.toString()), 1e17, 'unexpected balance (real-world price dependant)')

        const accountBalanceAfter = await daiPermittableToken.balanceOf(account0)
        const accountDifference = accountBalanceBefore.sub(accountBalanceAfter)
        // must have charged from this account
        assert.equal(accountDifference.toString(), paymasterBalanceAfter.toString(), 'unexpected balance')
        const latestAnswer = await chainlinkOracleDAIETH.latestAnswer()
        const maxPossibleEth = await testRelayHub.calculateCharge(MAX_POSSIBLE_GAS, relayRequest.relayData)
        const priceDivisor = toBN((await permitPaymaster.getTokenSwapData(DAI_CONTRACT_ADDRESS)).priceDivisor.toString())
        const expectedCharge = await permitPaymaster.addPaymasterFee(priceDivisor.mul(maxPossibleEth).div(latestAnswer).div(ETHER))
        assert.equal(accountDifference.toString(), paymasterBalanceAfter.toString(), 'unexpected balance')
        assert.equal(accountDifference.toString(), expectedCharge.toString(), 'unexpected charge')

        const approvalAfter = await daiPermittableToken.allowance(account0, permitPaymaster.address)
        assert.equal(approvalAfter.toString(), constants.MAX_UINT256.toString(), 'insufficient approval')
      })

      context('with EIP2612-compatible token', function () {
        before(async function () {
          if (!await detectMainnet()) {
            this.skip()
          }
        });
        ['uni', 'usdc'].forEach((tokenName) => {
          it(`should execute permit method on a target EIP2612 token (${tokenName})`, async function () {
            await skipWithoutFork(this)
            let token
            let domainSeparator
            if (tokenName === 'uni') {
              token = uniPermittableToken
              domainSeparator = getUniDomainSeparator()
            } else {
              token = usdcPermittableToken
              domainSeparator = getUSDCDomainSeparator()
            }
            const approvalBefore = await token.allowance(account0, permitPaymaster.address)
            assert.equal(approvalBefore.toString(), '0', 'unexpected approval')
            const encodedCallToPermit = await signAndEncodeEIP2612Permit(
              account0,
              permitPaymaster.address,
              token.address,
              constants.MAX_UINT256.toString(),
              constants.MAX_UINT256.toString(),
              (await wrapInputProviderLike(web3.currentProvider as any)).provider,
              domainSeparator,
              '_v4',
              false,
              domainSeparator.version == null ? EIP712DomainTypeWithoutVersion : EIP712DomainType
            )
            const modifiedRequest = mergeRelayRequest(relayRequest, {
              paymaster: permitPaymaster.address,
              paymasterData: concatHexStrings(token.address, encodedCallToPermit)
            })
            await testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )

            // note that Uni allowance is stored as uint96
            const approvalAfter = await token.allowance(account0, permitPaymaster.address)
            assert.isTrue(approvalAfter.gte(constants.MAX_UINT96), 'insufficient approval')
          })
        })
      })
    })
  })

  context('#postRelayedCall', function () {
    context('revert reasons', function () {
      it('should revert if actual charge exceeds pre-charge (i.e. bug in RelayHub)', async function () {
        await skipWithoutFork(this)
        const gasUseWithoutPost = 1e19.toString()
        let priceQuote = await chainlinkOracleDAIETH.latestAnswer()
        const priceDivisor = toBN((await permitPaymaster.getTokenSwapData(daiPermittableToken.address)).priceDivisor.toString())
        const decimals = await daiPermittableToken.decimals()
        const preChargeMultiplier = toBN(10).pow(decimals)
        priceQuote = await permitPaymaster.toActualQuote(priceQuote, priceDivisor)
        const context = web3.eth.abi.encodeParameters(['address', 'address', 'uint256', 'uint256', 'bool'], [daiPermittableToken.address, account0, priceQuote.toString(), toBN(TOKEN_PRE_CHARGE).mul(preChargeMultiplier).toString(), false])
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: DAI_CONTRACT_ADDRESS
        })
        assert.match(
          await revertReason(
            testRelayHub.callPostRC(permitPaymaster.address, context, gasUseWithoutPost, modifiedRequest.relayData)
          ), /actual charge higher/)
      })
    })

    context('success flow', function () {
      let daiPaymasterInfo: TokenInfo
      let usdcPaymasterInfo: TokenInfo
      before(async function () {
        if (!await detectMainnet()) {
          this.skip()
        }
      })
      beforeEach(async function () {
        await skipWithoutFork(this)
      })

      it('should refund sender excess tokens without refilling hub deposit when greater than minHubBalance', async function () {
        await skipWithoutFork(this)
        daiPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleDAIETH, daiPermittableToken)
        await web3.eth.sendTransaction({
          from: account0,
          to: permitPaymaster.address,
          value: TARGET_HUB_BALANCE
        })
        await permitPaymaster.refillHubDeposit(TARGET_HUB_BALANCE, { from: owner })
        const hubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
        assert.equal(hubBalance.toString(), TARGET_HUB_BALANCE)
        const res = await testRelayHub.callPostRC(permitPaymaster.address, daiPaymasterInfo.pmContext, gasUseWithoutPost, daiPaymasterInfo.modifiedRequest.relayData, { gasPrice: GAS_PRICE })
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: relayRequest.request.from,
          value: daiPaymasterInfo.expectedRefund.toString()
        })
        expectEvent(res, 'TokensCharged')
        assert.equal(res.logs.length, 2)
      })

      it('should withdraw hub balance to owner when greater than minWithdrawalAmount', async function () {
        await skipWithoutFork(this)
        daiPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleDAIETH, daiPermittableToken)
        const expectedHubBalance = toBN(TARGET_HUB_BALANCE).add(toBN(MIN_WITHDRAWAL_AMOUNT))
        await web3.eth.sendTransaction({
          from: account0,
          to: permitPaymaster.address,
          value: expectedHubBalance
        })
        await permitPaymaster.refillHubDeposit(expectedHubBalance, { from: owner })
        const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
        const paymasterBalance = toBN(await web3.eth.getBalance(permitPaymaster.address))
        assert.equal(paymasterBalance.toString(), '0')
        assert.equal(paymasterHubBalance.toString(), expectedHubBalance.toString())
        const ownerBalanceBefore = toBN(await web3.eth.getBalance(owner))
        const res = await testRelayHub.callPostRC(permitPaymaster.address, daiPaymasterInfo.pmContext, gasUseWithoutPost, daiPaymasterInfo.modifiedRequest.relayData, { gasPrice: GAS_PRICE })
        // Paymaster refunds remaining DAI tokens to sender
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: relayRequest.request.from,
          value: daiPaymasterInfo.expectedRefund.toString()
        })
        expectEvent(res, 'TokensCharged')

        // Paymaster withdraws excess hub balance to owner
        expectEvent(res, 'Withdrawn', {
          account: permitPaymaster.address,
          dest: owner,
          amount: MIN_WITHDRAWAL_AMOUNT
        })
        assert.equal(res.logs.length, 3)
        const hubBalanceAfter = await testRelayHub.balanceOf(permitPaymaster.address)
        assert.equal(hubBalanceAfter.toString(), TARGET_HUB_BALANCE)
        const ownerBalanceAfter = toBN(await web3.eth.getBalance(owner))
        assert.equal(ownerBalanceAfter.toString(), ownerBalanceBefore.add(toBN(MIN_WITHDRAWAL_AMOUNT)).toString())
      })

      context('with refilling hub deposit', function () {
        [{ desc: 'zero', value: '0' }, { desc: 'too low', value: MIN_HUB_BALANCE }].forEach((scenario) => {
          it(`should swap tokens when eth balance is ${scenario.desc}`, async function () {
            await skipWithoutFork(this)
            daiPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleDAIETH, daiPermittableToken)
            await web3.eth.sendTransaction({
              from: account0,
              to: permitPaymaster.address,
              value: MIN_HUB_BALANCE
            })
            await permitPaymaster.refillHubDeposit(MIN_HUB_BALANCE, { from: owner })
            await web3.eth.sendTransaction({
              from: account0,
              to: permitPaymaster.address,
              value: scenario.value
            })
            const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
            const paymasterBalance = toBN(await web3.eth.getBalance(permitPaymaster.address))
            assert.equal(paymasterBalance.toString(), scenario.value)
            assert.equal(paymasterHubBalance.toString(), MIN_HUB_BALANCE)
            const expectedDaiAmountIn = daiPaymasterInfo.preBalance.sub(daiPaymasterInfo.expectedRefund)
            const expectedWethAmountOutMin = await permitPaymaster.addSlippage(await permitPaymaster.tokenToWei(expectedDaiAmountIn, daiPaymasterInfo.priceQuote, false), SLIPPAGE)
            const expectedWethAmountOut = await quoter.contract.methods.quoteExactInputSingle(
              DAI_CONTRACT_ADDRESS,
              WETH9_CONTRACT_ADDRESS,
              DAI_ETH_POOL_FEE,
              expectedDaiAmountIn.toString(),
              0).call()

            const res = await testRelayHub.callPostRC(permitPaymaster.address, daiPaymasterInfo.pmContext, gasUseWithoutPost, daiPaymasterInfo.modifiedRequest.relayData, { gasPrice: GAS_PRICE })
            // res.logs.forEach(log => {
            //   // @ts-ignore
            //   log.args.value ? log.args.value = log.args.value.toString() : null
            //   log.args.amount ? log.args.amount = log.args.amount.toString() : null
            // })
            // console.log('logs are', res.logs.length, res.logs)
            assert.equal(res.logs.length, 8)
            // check correct tokens are transferred
            assert.equal(res.logs[0].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai')
            assert.equal(res.logs[2].address.toLowerCase(), WETH9_CONTRACT_ADDRESS.toLowerCase(), 'wrong weth')
            assert.equal(res.logs[3].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai again')

            // Paymaster refunds remaining DAI tokens to sender
            expectEvent(res, 'Transfer', {
              from: permitPaymaster.address,
              to: relayRequest.request.from,
              value: daiPaymasterInfo.expectedRefund.toString()
            })

            expectEvent(res, 'TokensCharged')

            const expectedRatio = expectedDaiAmountIn.div(expectedWethAmountOutMin)
            // @ts-ignore
            const actualRatio = res.logs[3].args.value.div(res.logs[2].args.value)
            assert.isTrue(actualRatio.gte(expectedRatio.muln(0.98)))
            // swap(1): transfer WETH from Pool to Router
            expectEvent(res, 'Transfer', {
              from: UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS,
              to: SWAP_ROUTER_CONTRACT_ADDRESS,
              value: expectedWethAmountOut.toString()
            })

            // swap(2): transfer DAI from Paymaster to Pool
            expectEvent(res, 'Transfer', {
              from: permitPaymaster.address,
              to: UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS,
              value: expectedDaiAmountIn.toString()
            })

            // swap(3): execute swap; note that WETH remains in a SwapRouter so it unwraps it for us
            expectEvent(res, 'Swap', {
              sender: SWAP_ROUTER_CONTRACT_ADDRESS,
              recipient: SWAP_ROUTER_CONTRACT_ADDRESS
            })

            // swap(4): SwapRouter unwraps ETH and sends it into Paymaster
            expectEvent(res, 'Withdrawal', {
              src: SWAP_ROUTER_CONTRACT_ADDRESS,
              wad: expectedWethAmountOut.toString()
            })

            expectEvent(res, 'Received', {
              sender: SWAP_ROUTER_CONTRACT_ADDRESS,
              eth: expectedWethAmountOut.toString()
            })
            assert.equal(res.logs[6].address.toLowerCase(), permitPaymaster.address.toLowerCase(), 'wrong paymaster')

            // swap(5): Paymaster deposits received ETH to RelayHub
            expectEvent(res, 'Deposited', {
              from: permitPaymaster.address,
              paymaster: permitPaymaster.address,
              amount: toBN(expectedWethAmountOut).add(toBN(scenario.value)).toString()
            })
          })
        })

        it('should not swap tokens when eth balance is sufficient', async function () {
          await skipWithoutFork(this)
          daiPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleDAIETH, daiPermittableToken)
          await web3.eth.sendTransaction({
            from: account0,
            to: permitPaymaster.address,
            value: MIN_HUB_BALANCE
          })
          await permitPaymaster.refillHubDeposit(MIN_HUB_BALANCE, { from: owner })
          await web3.eth.sendTransaction({
            from: account0,
            to: permitPaymaster.address,
            value: TARGET_HUB_BALANCE
          })
          const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
          const paymasterBalance = toBN(await web3.eth.getBalance(permitPaymaster.address))
          assert.equal(paymasterBalance.toString(), TARGET_HUB_BALANCE)
          assert.equal(paymasterHubBalance.toString(), MIN_HUB_BALANCE)

          const res = await testRelayHub.callPostRC(permitPaymaster.address, daiPaymasterInfo.pmContext, gasUseWithoutPost, daiPaymasterInfo.modifiedRequest.relayData, { gasPrice: GAS_PRICE })
          assert.equal(res.logs.length, 3)
          // check correct tokens are transferred
          assert.equal(res.logs[0].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai')
          assert.equal(res.logs[2].address.toLowerCase(), testRelayHub.address.toLowerCase(), 'wrong hub')

          // Paymaster refunds remaining DAI tokens to sender
          expectEvent(res, 'Transfer', {
            from: permitPaymaster.address,
            to: relayRequest.request.from,
            value: daiPaymasterInfo.expectedRefund.toString()
          })

          expectEvent(res, 'TokensCharged')

          expectEvent(res, 'Deposited', {
            from: permitPaymaster.address,
            paymaster: permitPaymaster.address,
            amount: paymasterBalance.toString()
          })
          const paymasterBalanceAfter = await web3.eth.getBalance(permitPaymaster.address)
          assert.equal(paymasterBalanceAfter.toString(), '0')
        })

        it('should not swap tokens with less than minSwapAmount equivalent token balance', async function () {
          await skipWithoutFork(this)
          daiPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleDAIETH, daiPermittableToken)
          await web3.eth.sendTransaction({
            from: account0,
            to: permitPaymaster.address,
            value: MIN_HUB_BALANCE
          })
          await permitPaymaster.refillHubDeposit(MIN_HUB_BALANCE, { from: owner })
          const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
          const paymasterBalance = toBN(await web3.eth.getBalance(permitPaymaster.address))
          assert.equal(paymasterBalance.toString(), '0')
          assert.equal(paymasterHubBalance.toString(), MIN_HUB_BALANCE)

          const expectedDaiAmountIn = daiPaymasterInfo.preBalance.sub(daiPaymasterInfo.expectedRefund)
          const expectedWethAmountOutMin = await permitPaymaster.addSlippage(await permitPaymaster.tokenToWei(expectedDaiAmountIn, daiPaymasterInfo.priceQuote, false), SLIPPAGE)
          const newConfig: UniswapConfig = {
            ...uniswapConfig,
            minSwapAmount: expectedWethAmountOutMin.muln(2).toString()
          }
          await permitPaymaster.setUniswapConfig(newConfig, { from: owner })
          const res = await testRelayHub.callPostRC(permitPaymaster.address, daiPaymasterInfo.pmContext, gasUseWithoutPost, daiPaymasterInfo.modifiedRequest.relayData, { gasPrice: GAS_PRICE })
          assert.equal(res.logs.length, 2)
          // check correct tokens are transferred
          assert.equal(res.logs[0].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai')

          // Paymaster refunds remaining DAI tokens to sender
          expectEvent(res, 'Transfer', {
            from: permitPaymaster.address,
            to: relayRequest.request.from,
            value: daiPaymasterInfo.expectedRefund.toString()
          })

          expectEvent(res, 'TokensCharged')

          const paymasterBalanceAfter = await web3.eth.getBalance(permitPaymaster.address)
          assert.equal(paymasterBalanceAfter.toString(), '0')
        })

        it('should not revert if uniswap reverts', async function () {
          await skipWithoutFork(this)
          daiPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleDAIETH, daiPermittableToken)
          await web3.eth.sendTransaction({
            from: account0,
            to: permitPaymaster.address,
            value: MIN_HUB_BALANCE
          })
          await permitPaymaster.refillHubDeposit(MIN_HUB_BALANCE, { from: owner })
          const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
          assert.equal(paymasterHubBalance.toString(), MIN_HUB_BALANCE)
          const paymasterBalance = toBN(await web3.eth.getBalance(permitPaymaster.address))
          assert.equal(paymasterBalance.toString(), '0')
          const expectedDaiAmountIn = daiPaymasterInfo.preBalance.sub(daiPaymasterInfo.expectedRefund)
          const expectedWethAmountOutMin = await permitPaymaster.addSlippage(await permitPaymaster.tokenToWei(expectedDaiAmountIn, daiPaymasterInfo.priceQuote, false), SLIPPAGE)

          const testUniswap = await TestUniswap.new(1, 1, { value: '1' })
          const newConfig: UniswapConfig = { ...uniswapConfig, uniswap: testUniswap.address }
          await permitPaymaster.setUniswapConfig(newConfig, { from: owner })
          assert.equal(await permitPaymaster.uniswap(), testUniswap.address)
          const res = await testRelayHub.callPostRC(permitPaymaster.address, daiPaymasterInfo.pmContext, gasUseWithoutPost, daiPaymasterInfo.modifiedRequest.relayData, { gasPrice: GAS_PRICE })
          // res.logs.forEach(log => {
          //   @ts-ignore
          //   log.args.value ? log.args.value = log.args.value.toString() : null
          //   log.args.amount ? log.args.amount = log.args.amount.toString() : null
          // })
          // console.log('logs are', res.logs.length, res.logs)
          assert.equal(res.logs.length, 3)
          // check correct tokens are transferred
          assert.equal(res.logs[0].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai')

          // Paymaster refunds remaining DAI tokens to sender
          expectEvent(res, 'Transfer', {
            from: permitPaymaster.address,
            to: relayRequest.request.from,
            value: daiPaymasterInfo.expectedRefund.toString()
          })

          expectEvent(res, 'TokensCharged')

          expectEvent(res, 'UniswapReverted', {
            tokenIn: toChecksumAddress(DAI_CONTRACT_ADDRESS),
            tokenOut: toChecksumAddress(WETH9_CONTRACT_ADDRESS),
            amountIn: expectedDaiAmountIn.toString(),
            amountOutMin: expectedWethAmountOutMin
          })
        })
      })

      context('with multiple tokens', function () {
        it('should swap multiple tokens to weth and refill hub deposit', async function () {
          await skipWithoutFork(this)
          // console.log('recharge dai')
          daiPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleDAIETH, daiPermittableToken, minDepositAmount.divn(3), false)
          // console.log('recharge uni')
          await rechargePaymaster(permitPaymaster, chainlinkOracleUNIETH, uniPermittableToken, minDepositAmount.divn(3), false)
          // console.log('recharge usdc')
          usdcPaymasterInfo = await rechargePaymaster(permitPaymaster, chainlinkOracleUSDCETH, usdcPermittableToken)

          await web3.eth.sendTransaction({
            from: account0,
            to: permitPaymaster.address,
            value: MIN_HUB_BALANCE
          })
          await permitPaymaster.refillHubDeposit(MIN_HUB_BALANCE, { from: owner })
          const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
          assert.equal(paymasterHubBalance.toString(), MIN_HUB_BALANCE)

          const paymasterEthBalance = toBN(await web3.eth.getBalance(permitPaymaster.address))
          const paymasterDaiBalance = await daiPermittableToken.balanceOf(permitPaymaster.address)
          // const paymasterUsdcBalance = await usdcPermittableToken.balanceOf(permitPaymaster.address)
          // const paymasterUniBalance = await uniPermittableToken.balanceOf(permitPaymaster.address)
          // console.log('balances dai usdc uni', paymasterDaiBalance.toString(), paymasterUsdcBalance.toString(), paymasterUniBalance.toString())
          const expectedUsdcAmountIn = usdcPaymasterInfo.preBalance.sub(usdcPaymasterInfo.expectedRefund)
          const expectedWethFromUsdc = await quoter.contract.methods.quoteExactInputSingle(
            USDC_CONTRACT_ADDRESS,
            WETH9_CONTRACT_ADDRESS,
            USDC_ETH_POOL_FEE,
            expectedUsdcAmountIn.toString(),
            0).call()
          const expectedWethFromDai = await quoter.contract.methods.quoteExactInputSingle(
            DAI_CONTRACT_ADDRESS,
            WETH9_CONTRACT_ADDRESS,
            DAI_ETH_POOL_FEE,
            paymasterDaiBalance.toString(),
            0).call()
          const res = await testRelayHub.callPostRC(permitPaymaster.address, usdcPaymasterInfo.pmContext, gasUseWithoutPost, usdcPaymasterInfo.modifiedRequest.relayData, { gasPrice: GAS_PRICE })

          // Paymaster refunds remaining USDC tokens to sender
          expectEvent(res, 'Transfer', {
            from: permitPaymaster.address,
            to: relayRequest.request.from,
            value: usdcPaymasterInfo.expectedRefund.toString()
          })
          assert.equal(res.logs[0].address.toLowerCase(), USDC_CONTRACT_ADDRESS.toLowerCase(), 'wrong udsc')

          expectEvent(res, 'TokensCharged',
            {
              tokenActualCharge: usdcPaymasterInfo.tokenActualCharge.toString(),
              ethActualCharge: ethActualCharge.toString()
            })
          assert.equal(res.logs[1].address.toLowerCase(), permitPaymaster.address.toLowerCase(), 'wrong paymaster')

          // transfer WETH from pool to router for DAI-WETH swap
          expectEvent(res, 'Transfer', {
            from: UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS,
            to: SWAP_ROUTER_CONTRACT_ADDRESS,
            value: expectedWethFromDai
          })
          assert.equal(res.logs[2].address.toLowerCase(), WETH9_CONTRACT_ADDRESS.toLowerCase(), 'wrong weth')

          // transfer DAI from paymaster to pool
          expectEvent(res, 'Transfer', {
            from: permitPaymaster.address,
            to: UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS,
            value: paymasterDaiBalance.toString()
          })
          assert.equal(res.logs[3].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai')

          // swap DAI to WETH from router
          expectEvent(res, 'Swap', {
            sender: SWAP_ROUTER_CONTRACT_ADDRESS,
            recipient: SWAP_ROUTER_CONTRACT_ADDRESS
          })
          assert.equal(res.logs[4].address.toLowerCase(), UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS.toLowerCase(), 'wrong pool')

          // transfer WETH from pool to router for USDC-WETH swap
          expectEvent(res, 'Transfer', {
            from: UNISWAP_V3_USDC_WETH_POOL_CONTRACT_ADDRESS,
            to: SWAP_ROUTER_CONTRACT_ADDRESS,
            value: expectedWethFromUsdc.toString()
          })
          assert.equal(res.logs[5].address.toLowerCase(), WETH9_CONTRACT_ADDRESS.toLowerCase(), 'wrong weth')

          // transfer USDC from paymaster to pool
          expectEvent(res, 'Transfer', {
            from: permitPaymaster.address,
            to: UNISWAP_V3_USDC_WETH_POOL_CONTRACT_ADDRESS,
            value: expectedUsdcAmountIn.toString()
          })
          assert.equal(res.logs[6].address.toLowerCase(), USDC_CONTRACT_ADDRESS.toLowerCase(), 'wrong usdc')

          // swap USDC to WETH from router to paymaster in pool
          expectEvent(res, 'Swap', {
            sender: SWAP_ROUTER_CONTRACT_ADDRESS,
            recipient: SWAP_ROUTER_CONTRACT_ADDRESS
          })
          assert.equal(res.logs[7].address.toLowerCase(), UNISWAP_V3_USDC_WETH_POOL_CONTRACT_ADDRESS.toLowerCase(), 'wrong pool')

          // SwapRouter unwraps ETH and sends it into Paymaster
          const totalWethReceived = paymasterEthBalance.add(toBN(expectedWethFromUsdc)).add(toBN(expectedWethFromDai))
          expectEvent(res, 'Withdrawal', {
            src: SWAP_ROUTER_CONTRACT_ADDRESS,
            wad: totalWethReceived.toString()
          })
          assert.isTrue(totalWethReceived.gte(minDepositAmount))
          assert.equal(res.logs[8].address.toLowerCase(), WETH9_CONTRACT_ADDRESS.toLowerCase(), 'wrong weth')

          expectEvent(res, 'Received', {
            sender: SWAP_ROUTER_CONTRACT_ADDRESS,
            eth: totalWethReceived.toString()
          })
          assert.equal(res.logs[9].address.toLowerCase(), permitPaymaster.address.toLowerCase(), 'wrong paymaster')

          // Paymaster deposits received ETH to RelayHub
          expectEvent(res, 'Deposited', {
            from: permitPaymaster.address,
            paymaster: permitPaymaster.address,
            amount: totalWethReceived.toString()
          })
          assert.equal(res.logs[10].address.toLowerCase(), testRelayHub.address.toLowerCase(), 'wrong hub')

          assert.equal(res.logs.length, 11)
        })
      })
    })
  })

  context('#transferToken', function () {
    it('should revert if called not from the trusted forwarder', async function () {
      await skipWithoutFork(this)
    })
    it('should transfer tokens from sender to recipient', async function () {
      await skipWithoutFork(this)
    })
  })

  context('calculate postRelayCall gas usage', function () {
    it('calculate', async function () {
      await skipWithoutFork(this)
      const uniswapConfig: UniswapConfig = {
        uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
        weth: WETH9_CONTRACT_ADDRESS,
        minSwapAmount: 0,
        tokens: [DAI_CONTRACT_ADDRESS],
        priceFeeds: [CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS],
        uniswapPoolFees: [DAI_ETH_POOL_FEE],
        permitMethodSignatures: [PERMIT_SIGNATURE_DAI],
        slippages: [SLIPPAGE],
        reverseQuotes: [false]
      }
      const gasAndEthConfig: GasAndEthConfig = {
        gasUsedByPost: 0,
        minHubBalance: MIN_HUB_BALANCE,
        targetHubBalance: TARGET_HUB_BALANCE,
        minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
        paymasterFee: 5
      }
      const permitPaymasterZeroGUBP = await PermitERC20UniswapV3Paymaster.new(uniswapConfig, gasAndEthConfig, GSN_FORWARDER_CONTRACT_ADDRESS, testRelayHub.address)
      const daiPaymasterInfo = await rechargePaymaster(permitPaymasterZeroGUBP, chainlinkOracleDAIETH, daiPermittableToken)
      const context = web3.eth.abi.encodeParameters(['address', 'address', 'uint256', 'uint256', 'bool'], [daiPermittableToken.address, account0, daiPaymasterInfo.priceQuote.toString(), daiPaymasterInfo.preBalance.toString(), false])
      const postGasUse = await calculatePostGas(daiPermittableToken, permitPaymasterZeroGUBP, daiPermittableToken.address, account0, context)
      assert.closeTo(postGasUse.toNumber(), GAS_USED_BY_POST, 5000)
    })
  })

  context('#relayCall', function () {
  })
})
