import BN from 'bn.js'
import { toBN, toWei } from 'web3-utils'
import {
  IChainlinkOracleInstance,
  IQuoterInstance,
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance,
  SampleRecipientInstance,
  TestHubInstance
} from '../types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { constants } from '@opengsn/common/dist/Constants'
import { calculatePostGas, deployTestHub, mergeRelayRequest, revertReason } from './TestUtils'
import {
  CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS,
  DAI_CONTRACT_ADDRESS,
  GSN_FORWARDER_CONTRACT_ADDRESS,
  PERMIT_SIGNATURE_DAI,
  PERMIT_SIGNATURE_EIP2612,
  CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS,
  SWAP_ROUTER_CONTRACT_ADDRESS,
  UNISWAP_V3_DAI_WETH_POOL_CONTRACT_ADDRESS,
  UNISWAP_V3_QUOTER_CONTRACT_ADDRESS,
  UNI_CONTRACT_ADDRESS,
  WETH9_CONTRACT_ADDRESS,
  getDaiDomainSeparator,
  getUniDomainSeparator,
  signAndEncodeDaiPermit,
  signAndEncodeEIP2612Permit
} from '../src/PermitPaymasterUtils'
import { revert, snapshot } from '@opengsn/dev/dist/test/TestUtils'
import { expectEvent } from '@openzeppelin/test-helpers'
import { EIP712DomainTypeWithoutVersion } from '@opengsn/common/dist/EIP712/TypedRequestData'
import { removeHexPrefix } from '@opengsn/common/dist'

const PermitERC20UniswapV3Paymaster = artifacts.require('PermitERC20UniswapV3Paymaster')
const PermitInterfaceEIP2612 = artifacts.require('PermitInterfaceEIP2612')
const PermitInterfaceDAI = artifacts.require('PermitInterfaceDAI')
const IChainlinkOracle = artifacts.require('IChainlinkOracle')
const SampleRecipient = artifacts.require('SampleRecipient')
const IQuoter = artifacts.require('IQuoter')

// as we are using forked mainnet, we will need to impersonate an account with a lot of DAI & UNI
const MAJOR_DAI_AND_UNI_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503'

const GAS_USED_BY_POST = 204766
const MAX_POSSIBLE_GAS = 1e6
const POOL_FEE = 3000
const MIN_HUB_BALANCE = 1e17.toString()
const TARGET_HUB_BALANCE = 1e18.toString()
const MIN_WITHDRAWAL_AMOUNT = 2e18.toString()

const TOKEN_PRE_CHARGE = toWei('1000', 'ether')
const GAS_PRICE = '1000000000' // 1 wei

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

interface PaymasterConfig {
  weth: string
  tokens: string[]
  relayHub: string
  priceFeeds: string[]
  uniswap: string
  trustedForwarder: string
  uniswapPoolFee: number | BN | string
  gasUsedByPost: number | BN | string
  permitMethodSignatures: string[]
  minHubBalance: number | BN | string
  targetHubBalance: number | BN | string
  minWithdrawalAmount: number | BN | string
  paymasterFee: number | BN | string
}

contract.only('PermitERC20UniswapV3Paymaster', function ([account0, account1, relay, owner]) {
  let permitPaymaster: PermitERC20UniswapV3PaymasterInstance
  let daiPermittableToken: PermitInterfaceDAIInstance
  let chainlinkOracleDAIETH: IChainlinkOracleInstance
  // let chainlinkOracleUNIETH: IChainlinkOracleInstance
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
    chainlinkOracleDAIETH = await IChainlinkOracle.at(CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS)
    // chainlinkOracleUNIETH = await IChainlinkOracle.at(CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS)
    testRelayHub = await deployTestHub() as TestHubInstance
    // in case the MAJOR_DAI_AND_UNI_HOLDER account does not have ETH on actual mainnet
    await web3.eth.sendTransaction({
      from: account0,
      to: MAJOR_DAI_AND_UNI_HOLDER,
      value: 1e18
    })
    // we cannot sign on behalf of an impersonated account - transfer DAI to an account we control
    await daiPermittableToken.transfer(account0, toWei('100000', 'ether'), { from: MAJOR_DAI_AND_UNI_HOLDER })
    const config: PaymasterConfig = {
      weth: WETH9_CONTRACT_ADDRESS,
      tokens: [DAI_CONTRACT_ADDRESS],
      relayHub: testRelayHub.address,
      uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
      priceFeeds: [CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS],
      trustedForwarder: GSN_FORWARDER_CONTRACT_ADDRESS,
      uniswapPoolFee: POOL_FEE,
      gasUsedByPost: GAS_USED_BY_POST,
      permitMethodSignatures: [PERMIT_SIGNATURE_DAI],
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
        const expectedCharge = await permitPaymaster.addPaymasterFee(priceDivisor.mul(maxPossibleEth).div(latestAnswer))
        assert.equal(accountDifference.toString(), paymasterBalanceAfter.toString(), 'unexpected balance')
        assert.equal(accountDifference.toString(), expectedCharge.toString(), 'unexpected charge')

        const approvalAfter = await daiPermittableToken.allowance(account0, permitPaymaster.address)
        assert.equal(approvalAfter.toString(), constants.MAX_UINT256.toString(), 'insufficient approval')
      })

      context('with EIP2612-compatible Paymaster', function () {
        let eip2612PermittableToken: PermitInterfaceEIP2612Instance
        let permitEIP2612Paymaster: PermitERC20UniswapV3PaymasterInstance
        before(async function () {
          if (!await detectMainnet()) {
            this.skip()
          }
          eip2612PermittableToken = await PermitInterfaceEIP2612.at(UNI_CONTRACT_ADDRESS)
          await eip2612PermittableToken.transfer(account0, toWei('100000', 'ether'), { from: MAJOR_DAI_AND_UNI_HOLDER })
          const config: PaymasterConfig = {
            weth: WETH9_CONTRACT_ADDRESS,
            tokens: [UNI_CONTRACT_ADDRESS],
            relayHub: testRelayHub.address,
            uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
            priceFeeds: [CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS],
            trustedForwarder: GSN_FORWARDER_CONTRACT_ADDRESS,
            uniswapPoolFee: POOL_FEE,
            gasUsedByPost: GAS_USED_BY_POST,
            permitMethodSignatures: [PERMIT_SIGNATURE_EIP2612],
            minHubBalance: MIN_HUB_BALANCE,
            targetHubBalance: TARGET_HUB_BALANCE,
            minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
            paymasterFee: 5
          }
          permitEIP2612Paymaster = await PermitERC20UniswapV3Paymaster.new(config)
        })
        it('should execute permit method on a target EIP2612 token', async function () {
          await skipWithoutFork(this)
          const approvalBefore = await eip2612PermittableToken.allowance(account0, permitPaymaster.address)
          assert.equal(approvalBefore.toString(), '0', 'unexpected approval')
          const encodedCallToPermit = await signAndEncodeEIP2612Permit(
            account0,
            permitEIP2612Paymaster.address,
            eip2612PermittableToken.address,
            constants.MAX_UINT256.toString(),
            constants.MAX_UINT256.toString(),
            web3,
            getUniDomainSeparator(),
            EIP712DomainTypeWithoutVersion
          )
          const modifiedRequest = mergeRelayRequest(relayRequest, {
            paymaster: permitEIP2612Paymaster.address,
            paymasterData: encodedCallToPermit.concat(removeHexPrefix(UNI_CONTRACT_ADDRESS))
          })
          await testRelayHub.callPreRC(
            modifiedRequest,
            '0x',
            '0x',
            MAX_POSSIBLE_GAS
          )

          // note that Uni allowance is stored as uint96
          const approvalAfter = await eip2612PermittableToken.allowance(account0, permitEIP2612Paymaster.address)
          assert.equal(approvalAfter.toString(), constants.MAX_UINT96.toString(), 'insufficient approval')
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
        const context = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), TOKEN_PRE_CHARGE])
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
      const gasUseWithoutPost = 100000
      const ethActualCharge = (gasUseWithoutPost + GAS_USED_BY_POST) * parseInt(GAS_PRICE)
      before(async function () {
        if (!await detectMainnet()) {
          this.skip()
        }
      })

      beforeEach(async function () {

      })

      it('should refund sender excess tokens without refilling hub deposit when greater than minHubBalance', async function () {
        await skipWithoutFork(this)
        const priceQuote = await chainlinkOracleDAIETH.latestAnswer()
        const priceDivisor = await permitPaymaster.priceDivisors(DAI_CONTRACT_ADDRESS)
        const minDepositAmount = toBN(TARGET_HUB_BALANCE).sub(toBN(MIN_HUB_BALANCE)).add(toBN(ethActualCharge))
        const tokenDepositAmount = minDepositAmount.mul(priceDivisor).div(priceQuote)

        await daiPermittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
        await daiPermittableToken.transfer(permitPaymaster.address, tokenDepositAmount.add(toBN(TOKEN_PRE_CHARGE)).muln(1.1), { from: account0 })
        await web3.eth.sendTransaction({
          from: account0,
          to: permitPaymaster.address,
          value: TARGET_HUB_BALANCE
        })
        const hubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
        assert.equal(hubBalance.toString(), TARGET_HUB_BALANCE)
        const context = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), TOKEN_PRE_CHARGE])
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: DAI_CONTRACT_ADDRESS
        })
        const res = await testRelayHub.callPostRC(permitPaymaster.address, context, gasUseWithoutPost, modifiedRequest.relayData, { gasPrice: GAS_PRICE })
        const tokenActualCharge = await permitPaymaster.addPaymasterFee(toBN(ethActualCharge).mul(priceDivisor).div(priceQuote))
        const expectedRefund = toBN(TOKEN_PRE_CHARGE).sub(tokenActualCharge)
        // Paymaster refunds remaining DAI tokens to sender
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: relayRequest.request.from,
          value: expectedRefund.toString()
        })
        expectEvent(res, 'TokensCharged')
        assert.equal(res.logs.length, 2)
      })

      it('should withdraw hub balance to owner when it\'s larger than minWithdrawalAmount', async function () {
        const priceQuote = await chainlinkOracleDAIETH.latestAnswer()
        const priceDivisor = await permitPaymaster.priceDivisors(DAI_CONTRACT_ADDRESS)
        const minDepositAmount = toBN(TARGET_HUB_BALANCE).sub(toBN(MIN_HUB_BALANCE)).add(toBN(ethActualCharge))
        const tokenDepositAmount = minDepositAmount.mul(priceDivisor).div(priceQuote)

        await daiPermittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
        await daiPermittableToken.transfer(permitPaymaster.address, tokenDepositAmount.add(toBN(TOKEN_PRE_CHARGE)).muln(1.1), { from: account0 })

        const expectedBalance = toBN(TARGET_HUB_BALANCE).add(toBN(MIN_WITHDRAWAL_AMOUNT))
        await web3.eth.sendTransaction({
          from: account0,
          to: permitPaymaster.address,
          value: expectedBalance
        })
        const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
        assert.equal(paymasterHubBalance.toString(), expectedBalance)
        const ownerBalanceBefore = toBN(await web3.eth.getBalance(owner))
        const context = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), TOKEN_PRE_CHARGE])
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: DAI_CONTRACT_ADDRESS
        })
        const res = await testRelayHub.callPostRC(permitPaymaster.address, context, gasUseWithoutPost, modifiedRequest.relayData, { gasPrice: GAS_PRICE })
        const tokenActualCharge = await permitPaymaster.addPaymasterFee(toBN(ethActualCharge).mul(priceDivisor).div(priceQuote))
        const expectedRefund = toBN(TOKEN_PRE_CHARGE).sub(tokenActualCharge)
        // Paymaster refunds remaining DAI tokens to sender
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: relayRequest.request.from,
          value: expectedRefund.toString()
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

      context('With multiple tokens', function () {

      })
      it('should refund sender excess tokens and refill hub deposit when greater than minHubBalance', async function () {
        await skipWithoutFork(this)
        const priceQuote = await chainlinkOracleDAIETH.latestAnswer()
        const priceDivisor = await permitPaymaster.priceDivisors(DAI_CONTRACT_ADDRESS)
        const minDepositAmount = toBN(TARGET_HUB_BALANCE).sub(toBN(MIN_HUB_BALANCE)).add(toBN(ethActualCharge))
        const tokenDepositAmount = minDepositAmount.mul(priceDivisor).div(priceQuote)

        await daiPermittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
        await daiPermittableToken.transfer(permitPaymaster.address, tokenDepositAmount.add(toBN(TOKEN_PRE_CHARGE)).muln(1.1), { from: account0 })
        await web3.eth.sendTransaction({
          from: account0,
          to: permitPaymaster.address,
          value: MIN_HUB_BALANCE
        })
        const paymasterHubBalance = await testRelayHub.balanceOf(permitPaymaster.address)
        assert.equal(paymasterHubBalance.toString(), MIN_HUB_BALANCE)
        const context = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), TOKEN_PRE_CHARGE])
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: DAI_CONTRACT_ADDRESS
        })
        const expectedDaiDeposit = await quoter.contract.methods.quoteExactOutputSingle(
          DAI_CONTRACT_ADDRESS,
          WETH9_CONTRACT_ADDRESS,
          POOL_FEE,
          minDepositAmount.toString(),
          0).call()

        const res = await testRelayHub.callPostRC(permitPaymaster.address, context, gasUseWithoutPost, modifiedRequest.relayData, { gasPrice: GAS_PRICE })
        // res.logs.forEach(log => {
        //   // @ts-ignore
        //   log.args.value ? log.args.value = log.args.value.toString() : null
        // })
        // console.log('logs are', res.logs.length, res.logs)
        // check correct tokens are transferred
        assert.equal(res.logs[0].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai')
        assert.equal(res.logs[2].address.toLowerCase(), WETH9_CONTRACT_ADDRESS.toLowerCase(), 'wrong weth')
        assert.equal(res.logs[3].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase(), 'wrong dai again')

        const tokenActualCharge = await permitPaymaster.addPaymasterFee(toBN(ethActualCharge).mul(priceDivisor).div(priceQuote))
        const expectedRefund = toBN(TOKEN_PRE_CHARGE).sub(tokenActualCharge)
        // Paymaster refunds remaining DAI tokens to sender
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: relayRequest.request.from,
          value: expectedRefund.toString()
        })
        expectEvent(res, 'TokensCharged')
        // swap(1): transfer WETH from Pool to Router
        expectEvent(res, 'Transfer', {
          from: UNISWAP_V3_DAI_WETH_POOL_CONTRACT_ADDRESS,
          to: SWAP_ROUTER_CONTRACT_ADDRESS,
          value: minDepositAmount.toString()
        })
        // swap(2): transfer DAI from Paymaster to Pool
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: UNISWAP_V3_DAI_WETH_POOL_CONTRACT_ADDRESS,
          value: expectedDaiDeposit.toString()
        })
        // swap(3): execute swap; note that WETH remains in a SwapRouter so it unwraps it for us
        expectEvent(res, 'Swap', {
          sender: SWAP_ROUTER_CONTRACT_ADDRESS,
          recipient: SWAP_ROUTER_CONTRACT_ADDRESS
        })
        // swap(4): SwapRouter unwraps ETH and sends it into Paymaster
        expectEvent(res, 'Withdrawal', {
          src: SWAP_ROUTER_CONTRACT_ADDRESS,
          wad: minDepositAmount.toString()
        })

        // swap(5): Paymaster deposits received ETH to RelayHub
        expectEvent(res, 'Deposited', {
          from: permitPaymaster.address,
          paymaster: permitPaymaster.address,
          amount: minDepositAmount.toString()
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
      const config: PaymasterConfig = {
        weth: WETH9_CONTRACT_ADDRESS,
        tokens: [DAI_CONTRACT_ADDRESS],
        relayHub: testRelayHub.address,
        uniswap: SWAP_ROUTER_CONTRACT_ADDRESS,
        priceFeeds: [CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS],
        trustedForwarder: GSN_FORWARDER_CONTRACT_ADDRESS,
        uniswapPoolFee: POOL_FEE,
        gasUsedByPost: 0,
        permitMethodSignatures: [PERMIT_SIGNATURE_DAI],
        minHubBalance: MIN_HUB_BALANCE,
        targetHubBalance: TARGET_HUB_BALANCE,
        minWithdrawalAmount: MIN_WITHDRAWAL_AMOUNT,
        paymasterFee: 5
      }
      const permitPaymasterZeroGUBP = await PermitERC20UniswapV3Paymaster.new(config)
      // const context = web3.eth.abi.encodeParameters(['address', 'uint256'], [account0, 500])
      const priceQuote = await chainlinkOracleDAIETH.latestAnswer()
      const context = web3.eth.abi.encodeParameters(['address', 'uint256', 'uint256'], [account0, priceQuote.toString(), 500])
      const postGasUse = await calculatePostGas(daiPermittableToken, permitPaymasterZeroGUBP, account0, context)
      assert.closeTo(postGasUse.toNumber(), GAS_USED_BY_POST, 5000)
    })
  })

  context('#relayCall', function () {
  })
})
