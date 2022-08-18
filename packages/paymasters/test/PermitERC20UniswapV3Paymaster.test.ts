import BN from 'bn.js'
import { toBN, toWei } from 'web3-utils'
import {
  ForwarderInstance,
  IChainlinkOracleInstance, IERC20MetadataInstance,
  IQuoterInstance, PenalizerInstance,
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance, RelayHubInstance,
  SampleRecipientInstance,
  StakeManagerInstance,
  TestHubInstance,
  TestTokenInstance
} from '../types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { constants } from '@opengsn/common/dist/Constants'
import { calculatePostGas, deployTestHub, mergeRelayRequest, revertReason } from './TestUtils'
import {
  CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS,
  DAI_CONTRACT_ADDRESS,
  getDaiDomainSeparator,
  getUniDomainSeparator,
  getUSDCDomainSeparator,
  GSN_FORWARDER_CONTRACT_ADDRESS,
  PaymasterConfig, PERMIT_SIGHASH_DAI, PERMIT_SIGHASH_EIP2612,
  PERMIT_SIGNATURE_DAI,
  PERMIT_SIGNATURE_EIP2612,
  signAndEncodeDaiPermit,
  signAndEncodeEIP2612Permit,
  SWAP_ROUTER_CONTRACT_ADDRESS,
  UNI_CONTRACT_ADDRESS,
  UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS,
  UNISWAP_V3_QUOTER_CONTRACT_ADDRESS,
  UNISWAP_V3_USDC_WETH_POOL_CONTRACT_ADDRESS,
  USDC_CONTRACT_ADDRESS,
  WETH9_CONTRACT_ADDRESS
} from '../src/PermitPaymasterUtils'
import { deployHub, revert, snapshot, startRelay, stopRelay } from '@opengsn/dev/dist/test/TestUtils'
import { expectEvent } from '@openzeppelin/test-helpers'
import { EIP712DomainType, EIP712DomainTypeWithoutVersion } from '@opengsn/common/dist/EIP712/TypedRequestData'
import { defaultEnvironment, removeHexPrefix } from '@opengsn/common/dist'
import { TokenPaymasterConfig, TokenPaymasterProvider } from '../src/TokenPaymasterProvider'
import { HttpProvider } from 'web3-core'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'

const PermitERC20UniswapV3Paymaster = artifacts.require('PermitERC20UniswapV3Paymaster')
const PermitInterfaceEIP2612 = artifacts.require('PermitInterfaceEIP2612')
const PermitInterfaceDAI = artifacts.require('PermitInterfaceDAI')
const IChainlinkOracle = artifacts.require('IChainlinkOracle')
const SampleRecipient = artifacts.require('SampleRecipient')
const IQuoter = artifacts.require('IQuoter')

const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestToken = artifacts.require('TestToken')
const AcceptEverythingPaymaster = artifacts.require('AcceptEverythingPaymaster')

const { expect, assert } = chai.use(chaiAsPromised)

// as we are using forked mainnet, we will need to impersonate an account with a lot of DAI & UNI
const MAJOR_DAI_AND_UNI_HOLDER = '0xF977814e90dA44bFA03b6295A0616a897441aceC' //'0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503'

const GAS_USED_BY_POST = 204766
const MAX_POSSIBLE_GAS = 1e6
const DAI_ETH_POOL_FEE = 500
const USDC_ETH_POOL_FEE = 500
const UNI_ETH_POOL_FEE = 3000
const MIN_HUB_BALANCE = 1e17.toString()
const TARGET_HUB_BALANCE = 1e18.toString()
const MIN_WITHDRAWAL_AMOUNT = 2e18.toString()
const ETHER = toBN(1e18.toString())

const TOKEN_PRE_CHARGE = 1000
const GAS_PRICE = '1000000000'

async function detectMainnet (): Promise<boolean> {
  const code = await web3.eth.getCode(DAI_CONTRACT_ADDRESS)
  return code !== '0x'
}

async function skipWithoutFork (test: any): Promise<void> {
  const isMainnet = await detectMainnet()
  if (!isMainnet) {
    test.skip()
  }
}

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

  let id: string

  before(async function () {
    if (!await detectMainnet()) {
      this.skip()
    }
    sampleRecipient = await SampleRecipient.new()
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
    permitPaymaster = await PermitERC20UniswapV3Paymaster.new(config, { from: owner })
    relayRequest = {
      relayData: {
        relayWorker: relay,
        paymaster: permitPaymaster.address,
        forwarder: GSN_FORWARDER_CONTRACT_ADDRESS,
        pctRelayFee: '0',
        baseRelayFee: '0',
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
          ), /paymasterData: must contain token address/)

        modifiedRequest.relayData.paymasterData = concatHexStrings('ff', DAI_CONTRACT_ADDRESS)

        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /paymasterData: must contain "permit" method/)
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
          paymasterData: concatHexStrings('0x123456789', DAI_CONTRACT_ADDRESS)
        })

        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /paymasterData: wrong "permit" method sig/)
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
          web3,
          domainSeparator,
          incorrectNonce,
          true
        )
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: encodedCallToPermit.concat(removeHexPrefix(DAI_CONTRACT_ADDRESS))
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
          web3
        )
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: encodedCallToPermit.concat(removeHexPrefix(DAI_CONTRACT_ADDRESS))
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
        const priceDivisor = await permitPaymaster.priceDivisors(DAI_CONTRACT_ADDRESS)
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
              web3,
              domainSeparator,
              domainSeparator.version == null ? EIP712DomainTypeWithoutVersion : EIP712DomainType
            )
            const modifiedRequest = mergeRelayRequest(relayRequest, {
              paymaster: permitPaymaster.address,
              paymasterData: encodedCallToPermit.concat(removeHexPrefix(token.address))
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
        const priceQuote = await chainlinkOracleDAIETH.latestAnswer()
        const decimals = await daiPermittableToken.decimals()
        const preChargeMultiplier = toBN(10).pow(decimals)
        const context = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), toBN(TOKEN_PRE_CHARGE).mul(preChargeMultiplier).toString()])
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
      interface TokenInfo {
        priceQuote: BN
        priceDivisor: BN
        tokenActualCharge: BN
        expectedRefund: BN
        pmContext: any
        modifiedRequest: RelayRequest
        preBalance: BN
      }
      const gasUseWithoutPost = 100000
      const ethActualCharge = (gasUseWithoutPost + GAS_USED_BY_POST) * parseInt(GAS_PRICE)
      const minDepositAmount = toBN(TARGET_HUB_BALANCE).sub(toBN(MIN_HUB_BALANCE)).add(toBN(ethActualCharge))
      let daiPaymasterInfo: TokenInfo
      let usdcPaymasterInfo: TokenInfo
      // let uniPaymasterInfo: TokenInfo
      before(async function () {
        if (!await detectMainnet()) {
          this.skip()
        }
      })
      async function rechargePaymaster (
        oracle: IChainlinkOracleInstance,
        token: IERC20MetadataInstance,
        tokenAmount = minDepositAmount,
        withPreCharge = true): Promise<TokenInfo> {
        const priceQuote = await oracle.latestAnswer()
        const priceDivisor = await permitPaymaster.priceDivisors(token.address)
        const decimals = await token.decimals()
        const preChargeMultiplier = toBN(10).pow(decimals)
        const tokenDepositAmount = tokenAmount.mul(priceDivisor).div(priceQuote).div(ETHER)
        const tokenPreCharge = withPreCharge ? toBN(TOKEN_PRE_CHARGE).mul(preChargeMultiplier) : toBN(0)

        await token.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
        const preBalance = tokenDepositAmount.add(tokenPreCharge).muln(1.1)
        await token.transfer(permitPaymaster.address, preBalance, { from: account0 })

        const pmContext = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), tokenPreCharge.toString()])
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: token.address
        })
        const tokenActualCharge = await permitPaymaster.addPaymasterFee(toBN(ethActualCharge).mul(priceDivisor).div(priceQuote).div(ETHER))
        const expectedRefund = tokenPreCharge.sub(tokenActualCharge)
        return { priceQuote, priceDivisor, tokenActualCharge, expectedRefund, pmContext, modifiedRequest, preBalance }
      }
      beforeEach(async function () {
        await skipWithoutFork(this)
      })

      it('should refund sender excess tokens without refilling hub deposit when greater than minHubBalance', async function () {
        await skipWithoutFork(this)
        daiPaymasterInfo = await rechargePaymaster(chainlinkOracleDAIETH, daiPermittableToken)
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
        daiPaymasterInfo = await rechargePaymaster(chainlinkOracleDAIETH, daiPermittableToken)
        const expectedBalance = toBN(TARGET_HUB_BALANCE).add(toBN(MIN_WITHDRAWAL_AMOUNT))
        await web3.eth.sendTransaction({
          from: account0,
          to: permitPaymaster.address,
          value: expectedBalance
        })
        await permitPaymaster.refillHubDeposit(expectedBalance, { from: owner })
        const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
        assert.equal(paymasterHubBalance.toString(), expectedBalance.toString())
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

      it('should refund sender excess tokens and refill hub deposit when lower than minHubBalance', async function () {
        await skipWithoutFork(this)
        daiPaymasterInfo = await rechargePaymaster(chainlinkOracleDAIETH, daiPermittableToken)
        await web3.eth.sendTransaction({
          from: account0,
          to: permitPaymaster.address,
          value: MIN_HUB_BALANCE
        })
        await permitPaymaster.refillHubDeposit(MIN_HUB_BALANCE, { from: owner })
        const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
        assert.equal(paymasterHubBalance.toString(), MIN_HUB_BALANCE)

        const expectedDaiAmountIn = daiPaymasterInfo.preBalance.sub(daiPaymasterInfo.expectedRefund)
        const expectedWethAmountOutMin = expectedDaiAmountIn.mul(ETHER).mul(daiPaymasterInfo.priceQuote).div(daiPaymasterInfo.priceDivisor).muln(99).divn(100)
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
          amount: minDepositAmount.toString()
        })
      })

      context('with multiple tokens', function () {
        it('should swap multiple tokens to weth and refill hub deposit', async function () {
          await skipWithoutFork(this)
          // console.log('recharge dai')
          daiPaymasterInfo = await rechargePaymaster(chainlinkOracleDAIETH, daiPermittableToken, minDepositAmount.divn(3), false)
          // console.log('recharge uni')
          await rechargePaymaster(chainlinkOracleUNIETH, uniPermittableToken, minDepositAmount.divn(3), false)
          // console.log('recharge usdc')
          usdcPaymasterInfo = await rechargePaymaster(chainlinkOracleUSDCETH, usdcPermittableToken)

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
          // res.logs.forEach(log => {
          //   // @ts-ignore
          //   log.args.value ? log.args.value = log.args.value.toString() : null
          // })
          // console.log('logs are', res.logs.length, res.logs)
          // check correct tokens are transferred
          // console.log('paymaster', permitPaymaster.address)
          // console.log('relay', relay)
          // console.log('client', usdcPaymasterInfo.modifiedRequest.request.from)
          // console.log('hub', testRelayHub.address)

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
            amount: minDepositAmount.toString()
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

  context('TokenPaymasterProvider', function () {
    let tokenPaymasterProvider: TokenPaymasterProvider
    context('initialization', function () {
      it('should initialize provider without token address', async function () {
        await skipWithoutFork(this)

        const gsnConfig: Partial<TokenPaymasterConfig> = {
          tokenPaymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' },
          // TODO remove this flag once testing against v3 test deployment
          skipErc165Check: true
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider: web3.currentProvider as HttpProvider
        })
        await tokenPaymasterProvider.init()
        assert.isTrue(tokenPaymasterProvider.config.tokenAddress == null)
        assert.equal(tokenPaymasterProvider.config.tokenPaymasterAddress, permitPaymaster.address)
        assert.equal(tokenPaymasterProvider.config.paymasterAddress, permitPaymaster.address)
        assert.isTrue(tokenPaymasterProvider.permitSignature == null)
      })
      it('should initialize provider with token address', async function () {
        await skipWithoutFork(this)

        const gsnConfig: Partial<TokenPaymasterConfig> = {
          tokenPaymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' },
          // TODO remove this flag once testing against v3 test deployment
          skipErc165Check: true,
          tokenAddress: USDC_CONTRACT_ADDRESS
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider: web3.currentProvider as HttpProvider
        })
        await tokenPaymasterProvider.init()
        assert.equal(tokenPaymasterProvider.config.tokenAddress, USDC_CONTRACT_ADDRESS)
        assert.equal(tokenPaymasterProvider.config.tokenPaymasterAddress, permitPaymaster.address)
        assert.equal(tokenPaymasterProvider.config.paymasterAddress, permitPaymaster.address)
        assert.equal(tokenPaymasterProvider.permitSignature, PERMIT_SIGNATURE_EIP2612)
      })
      it('should throw if given unsupported token', async function () {
        await skipWithoutFork(this)

        const gsnConfig: Partial<TokenPaymasterConfig> = {
          tokenPaymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' },
          // TODO remove this flag once testing against v3 test deployment
          skipErc165Check: true,
          tokenAddress: USDC_CONTRACT_ADDRESS
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider: web3.currentProvider as HttpProvider
        })
        await tokenPaymasterProvider.init()
        const promise = tokenPaymasterProvider.useToken(owner)
        await expect(promise).to.be.eventually.rejectedWith(`token ${owner} not supported`)
      })
      it('should be able to change used token', async function () {
        await skipWithoutFork(this)

        const gsnConfig: Partial<TokenPaymasterConfig> = {
          tokenPaymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' },
          // TODO remove this flag once testing against v3 test deployment
          skipErc165Check: true,
          tokenAddress: USDC_CONTRACT_ADDRESS
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider: web3.currentProvider as HttpProvider
        })
        await tokenPaymasterProvider.init()
        await tokenPaymasterProvider.useToken(DAI_CONTRACT_ADDRESS)
        assert.equal(tokenPaymasterProvider.config.tokenAddress, DAI_CONTRACT_ADDRESS)
        assert.equal(tokenPaymasterProvider.permitSignature, PERMIT_SIGNATURE_DAI)
      })
    })
    context('#_buildPaymasterData()', function () {
      it('should throw if paymaster address in provider doesn\'t match relayRequest', async function () {
        await skipWithoutFork(this)
        const gsnConfig: Partial<TokenPaymasterConfig> = {
          tokenPaymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' },
          tokenAddress: USDC_CONTRACT_ADDRESS,
          // TODO remove this flag once testing against v3 test deployment
          skipErc165Check: true
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider: web3.currentProvider as HttpProvider
        })
        await tokenPaymasterProvider.init()
        const promise = tokenPaymasterProvider._buildPaymasterData(mergeRelayRequest(relayRequest, { paymaster: '0x' }))
        await expect(promise).to.be.eventually.rejectedWith('Paymaster address mismatch')
      })
      it('should build paymaster data without permit method', async function () {
        await skipWithoutFork(this)
        const gsnConfig: Partial<TokenPaymasterConfig> = {
          tokenPaymasterAddress: permitPaymaster.address,
          loggerConfiguration: { logLevel: 'error' },
          tokenAddress: USDC_CONTRACT_ADDRESS,
          // TODO remove this flag once testing against v3 test deployment
          skipErc165Check: true
        }
        tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
          config: gsnConfig,
          provider: web3.currentProvider as HttpProvider
        })
        await tokenPaymasterProvider.init()
        await usdcPermittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
        const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
        assert.equal(paymasterData, USDC_CONTRACT_ADDRESS)
      })
      context('with permit method', function () {
        it('should build paymaster data for dai', async function () {
          await skipWithoutFork(this)
          const gsnConfig: Partial<TokenPaymasterConfig> = {
            tokenPaymasterAddress: permitPaymaster.address,
            loggerConfiguration: { logLevel: 'error' },
            tokenAddress: DAI_CONTRACT_ADDRESS,
            // TODO remove this flag once testing against v3 test deployment
            skipErc165Check: true
          }
          tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
            config: gsnConfig,
            provider: web3.currentProvider as HttpProvider
          })
          await tokenPaymasterProvider.init()
          const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
          assert.equal(paymasterData.slice(-40), removeHexPrefix(DAI_CONTRACT_ADDRESS))
          assert.equal(paymasterData.slice(0, 10), PERMIT_SIGHASH_DAI)
        })
        it('should build paymaster data for usdc', async function () {
          await skipWithoutFork(this)
          const gsnConfig: Partial<TokenPaymasterConfig> = {
            tokenPaymasterAddress: permitPaymaster.address,
            loggerConfiguration: { logLevel: 'error' },
            tokenAddress: USDC_CONTRACT_ADDRESS,
            // TODO remove this flag once testing against v3 test deployment
            skipErc165Check: true
          }
          tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
            config: gsnConfig,
            provider: web3.currentProvider as HttpProvider
          })
          await tokenPaymasterProvider.init()
          const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
          assert.equal(paymasterData.slice(-40), removeHexPrefix(USDC_CONTRACT_ADDRESS))
          assert.equal(paymasterData.slice(0, 10), PERMIT_SIGHASH_EIP2612)
        })
        it('should build paymaster data for uni', async function () {
          await skipWithoutFork(this)
          const gsnConfig: Partial<TokenPaymasterConfig> = {
            tokenPaymasterAddress: permitPaymaster.address,
            loggerConfiguration: { logLevel: 'error' },
            tokenAddress: UNI_CONTRACT_ADDRESS,
            // TODO remove this flag once testing against v3 test deployment
            skipErc165Check: true
          }
          tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
            config: gsnConfig,
            provider: web3.currentProvider as HttpProvider
          })
          await tokenPaymasterProvider.init()
          const paymasterData = await tokenPaymasterProvider._buildPaymasterData(relayRequest)
          assert.equal(paymasterData.slice(-40), removeHexPrefix(UNI_CONTRACT_ADDRESS))
          assert.equal(paymasterData.slice(0, 10), PERMIT_SIGHASH_EIP2612)
        })
      })
    })
    it('should relay transparently', async function () {
      await skipWithoutFork(this)

      const stake = ETHER
      const testToken: TestTokenInstance = await TestToken.new()
      const stakeManager: StakeManagerInstance = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
      const penalizer: PenalizerInstance = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      const relayHub: RelayHubInstance = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString())
      const forwarderInstance: ForwarderInstance = await Forwarder.new()
      const forwarderAddress = forwarderInstance.address
      await registerForwarderForGsn(forwarderInstance)
      await sampleRecipient.setForwarder(forwarderAddress)

      await permitPaymaster.setTrustedForwarder(forwarderAddress, { from: owner })
      await permitPaymaster.setRelayHub(relayHub.address, { from: owner })
      await web3.eth.sendTransaction({
        from: account0,
        to: permitPaymaster.address,
        value: stake
      })
      await permitPaymaster.refillHubDeposit(stake, { from: owner })

      const gsnConfig: Partial<TokenPaymasterConfig> = {
        tokenPaymasterAddress: permitPaymaster.address,
        loggerConfiguration: { logLevel: 'debug' },
        tokenAddress: UNI_CONTRACT_ADDRESS,
        methodSuffix: '',
        jsonStringifyRequest: false,
        // TODO remove this flag once testing against v3 test deployment
        skipErc165Check: true
      }
      tokenPaymasterProvider = TokenPaymasterProvider.newProvider({
        config: gsnConfig,
        provider: web3.currentProvider as HttpProvider
      })
      await tokenPaymasterProvider.init()

      await testToken.mint(stake, { from: owner })
      await testToken.approve(stakeManager.address, stake, { from: owner })
      console.log('wtf starting relay')
      const relayProcess = await startRelay(relayHub.address, testToken, stakeManager, {
        relaylog: process.env.relaylog,
        initialReputation: 100,
        stake: stake.toString(),
        relayOwner: owner,
        ethereumNodeUrl: (web3.currentProvider as HttpProvider).host
      })
      console.log('wtf relay started', await web3.eth.getNodeInfo())
      // @ts-ignore
      SampleRecipient.web3.setProvider(tokenPaymasterProvider)
      // sampleRecipient = await SampleRecipient.new()
      try {
        const res = await sampleRecipient.something({ gasPrice: 50e9, gas: 3e5, from: account0 })
        // const receipt = await web3.eth.getTransactionReceipt(res.receipt.actualTransactionHash)
        const hubLogs = await relayHub.getPastEvents('TransactionRelayed', { fromBlock: res.receipt.blockNumber })
        expectEvent(res, 'Sender', {
          _msgSenderFunc: account0,
          sender: forwarderAddress
        })
        assert.equal(hubLogs.length, 1)
        assert.equal(hubLogs[0].event, 'TransactionRelayed')
        assert.equal(hubLogs[0].returnValues.from, account0)
        assert.equal(hubLogs[0].returnValues.to, sampleRecipient.address)
        assert.equal(hubLogs[0].returnValues.status, '0')
        assert.equal(hubLogs[0].returnValues.paymaster, permitPaymaster.address)
      } finally {
        stopRelay(relayProcess)
      }
    })
  })

  context('calculate postRelayCall gas usage', function () {
    it('calculate', async function () {
      await skipWithoutFork(this)
      const config: PaymasterConfig = {
        weth: WETH9_CONTRACT_ADDRESS,
        tokens: [DAI_CONTRACT_ADDRESS],
        relayHub: testRelayHub.address,
        uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
        priceFeeds: [CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS],
        trustedForwarder: GSN_FORWARDER_CONTRACT_ADDRESS,
        uniswapPoolFees: [DAI_ETH_POOL_FEE],
        gasUsedByPost: 0,
        permitMethodSignatures: [PERMIT_SIGNATURE_DAI],
        minHubBalance: MIN_HUB_BALANCE,
        targetHubBalance: TARGET_HUB_BALANCE,
        minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
        paymasterFee: 5
      }
      const permitPaymasterZeroGUBP = await PermitERC20UniswapV3Paymaster.new(config)
      const priceQuote = await chainlinkOracleDAIETH.latestAnswer()
      const context = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), 500])
      const postGasUse = await calculatePostGas(daiPermittableToken, permitPaymasterZeroGUBP, account0, context)
      assert.closeTo(postGasUse.toNumber(), GAS_USED_BY_POST, 5000)
    })
  })

  context('#relayCall', function () {
  })
})
