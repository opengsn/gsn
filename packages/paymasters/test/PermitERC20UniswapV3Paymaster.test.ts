import BN from 'bn.js'
import { toWei } from 'web3-utils'
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
import { ForwarderInstance } from '@opengsn/contracts/types/truffle-contracts'
import { constants } from '@opengsn/common'
import { calculatePostGas, deployTestHub, mergeRelayRequest, revertReason } from './TestUtils'
import {
  CHAINLINK_USD_ETH_FEED_CONTRACT_ADDRESS,
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

const PermitERC20UniswapV3Paymaster = artifacts.require('PermitERC20UniswapV3Paymaster')
const PermitInterfaceEIP2612 = artifacts.require('PermitInterfaceEIP2612')
const PermitInterfaceDAI = artifacts.require('PermitInterfaceDAI')
const IChainlinkOracle = artifacts.require('IChainlinkOracle')
const SampleRecipient = artifacts.require('SampleRecipient')
const Forwarder = artifacts.require('Forwarder')
const IQuoter = artifacts.require('IQuoter')

// as we are using forked mainnet, we will need to impersonate an account with a lot of DAI & UNI
const MAJOR_DAI_AND_UNI_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503'

const GAS_USED_BY_POST = 197490
const MAX_POSSIBLE_GAS = 1e6
const PERMIT_DATA_LENGTH = 0
const POOL_FEE = 3000

const TOKEN_PRE_CHARGE = toWei('10', 'ether')
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

contract('PermitERC20UniswapV3Paymaster', function ([account0, account1, relay]) {
  let permitPaymaster: PermitERC20UniswapV3PaymasterInstance
  let daiPermittableToken: PermitInterfaceDAIInstance
  let chainlinkOracle: IChainlinkOracleInstance
  let sampleRecipient: SampleRecipientInstance
  let testRelayHub: TestHubInstance
  let forwarder: ForwarderInstance
  let quoter: IQuoterInstance

  let relayRequest: RelayRequest

  let id: string

  before(async function () {
    if (!await detectMainnet()) {
      this.skip()
    }
    sampleRecipient = await SampleRecipient.new()
    forwarder = await Forwarder.new({ gas: 1e7 })
    quoter = await IQuoter.at(UNISWAP_V3_QUOTER_CONTRACT_ADDRESS)
    daiPermittableToken = await PermitInterfaceDAI.at(DAI_CONTRACT_ADDRESS)
    chainlinkOracle = await IChainlinkOracle.at(CHAINLINK_USD_ETH_FEED_CONTRACT_ADDRESS)
    testRelayHub = await deployTestHub() as TestHubInstance
    // in case the MAJOR_DAI_AND_UNI_HOLDER account does not have ETH on actual mainnet
    await web3.eth.sendTransaction({
      from: account0,
      to: MAJOR_DAI_AND_UNI_HOLDER,
      value: 1e18
    })
    // we cannot sign on behalf of an impersonated account - transfer DAI to an account we control
    await daiPermittableToken.transfer(account0, toWei('100000', 'ether'), { from: MAJOR_DAI_AND_UNI_HOLDER })
    permitPaymaster = await PermitERC20UniswapV3Paymaster.new(
      WETH9_CONTRACT_ADDRESS,
      DAI_CONTRACT_ADDRESS,
      testRelayHub.address,
      SWAP_ROUTER_CONTRACT_ADDRESS,
      CHAINLINK_USD_ETH_FEED_CONTRACT_ADDRESS,
      GSN_FORWARDER_CONTRACT_ADDRESS,
      POOL_FEE,
      GAS_USED_BY_POST,
      PERMIT_DATA_LENGTH,
      PERMIT_SIGNATURE_DAI
    )
    relayRequest = {
      relayData: {
        relayWorker: relay,
        paymaster: permitPaymaster.address,
        forwarder: forwarder.address,
        pctRelayFee: '0',
        baseRelayFee: '0',
        gasPrice: GAS_PRICE,
        paymasterData: '0x',
        clientId: '1'
      },
      request: {
        data: sampleRecipient.contract.methods.something().encodeABI(),
        nonce: '0',
        value: '0',
        validUntil: '0',
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
          ), /approvalData: invalid length/)
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
          ), /paymastaData: missing method sig/)
      })

      it('should revert if paymasterData is not an encoded call to permit method', async function () {
        await skipWithoutFork(this)
        const modifiedRequest = mergeRelayRequest(relayRequest, {
          paymasterData: '0x123456789'
        })

        assert.match(
          await revertReason(
            testRelayHub.callPreRC(
              modifiedRequest,
              '0x',
              '0x',
              MAX_POSSIBLE_GAS
            )
          ), /paymasterData: wrong method sig/)
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
          paymasterData: encodedCallToPermit
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
        const modifiedRequest = mergeRelayRequest(relayRequest, {}, { from: account1 })
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
          paymasterData: encodedCallToPermit
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
        const latestAnswer = await chainlinkOracle.latestAnswer()
        const maxPossibleEth = await testRelayHub.calculateCharge(MAX_POSSIBLE_GAS, relayRequest.relayData)
        const expectedCharge = latestAnswer.mul(maxPossibleEth).div(new BN(1e8.toString()))
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
          permitEIP2612Paymaster = await PermitERC20UniswapV3Paymaster.new(
            WETH9_CONTRACT_ADDRESS,
            UNI_CONTRACT_ADDRESS,
            testRelayHub.address,
            SWAP_ROUTER_CONTRACT_ADDRESS,
            CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS,
            GSN_FORWARDER_CONTRACT_ADDRESS,
            POOL_FEE,
            GAS_USED_BY_POST,
            PERMIT_DATA_LENGTH,
            PERMIT_SIGNATURE_EIP2612
          )
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
            paymasterData: encodedCallToPermit
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
        const gasUseWithoutPost = 1000000
        const context = web3.eth.abi.encodeParameters(['address', 'uint256'], [account0, TOKEN_PRE_CHARGE])
        // "STF" revert reason is thrown in 'safeTransferFrom' method in Uniswap's 'TransferHelper.sol' library
        assert.match(
          await revertReason(
            testRelayHub.callPostRC(permitPaymaster.address, context, gasUseWithoutPost, relayRequest.relayData)
          ), /STF/)
      })
    })

    context('success flow', function () {
      before(async function () {
        if (!await detectMainnet()) {
          this.skip()
        }
        await daiPermittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
        await daiPermittableToken.transfer(permitPaymaster.address, TOKEN_PRE_CHARGE, { from: account0 })
      })

      it('should transfer excess tokens back to sender and deposit traded tokens into RelayHub as Ether', async function () {
        await skipWithoutFork(this)
        const gasUseWithoutPost = 100000
        const context = web3.eth.abi.encodeParameters(['address', 'uint256'], [account0, TOKEN_PRE_CHARGE])

        const ethActualCharge = (gasUseWithoutPost + GAS_USED_BY_POST) * parseInt(GAS_PRICE)
        const expectedDaiTokenCharge = await quoter.contract.methods.quoteExactOutputSingle(
          DAI_CONTRACT_ADDRESS,
          WETH9_CONTRACT_ADDRESS,
          POOL_FEE,
          ethActualCharge,
          0).call()

        const res = await testRelayHub.callPostRC(permitPaymaster.address, context, gasUseWithoutPost, relayRequest.relayData)
        const expectedRefund = new BN(TOKEN_PRE_CHARGE).sub(new BN(expectedDaiTokenCharge))

        // check correct tokens are transferred
        assert.equal(res.logs[0].address.toLowerCase(), WETH9_CONTRACT_ADDRESS.toLowerCase())
        assert.equal(res.logs[1].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase())
        assert.equal(res.logs[6].address.toLowerCase(), DAI_CONTRACT_ADDRESS.toLowerCase())

        // swap(0): transfer WETH from Pool to Router
        expectEvent(res, 'Transfer', {
          from: UNISWAP_V3_DAI_WETH_POOL_CONTRACT_ADDRESS,
          to: SWAP_ROUTER_CONTRACT_ADDRESS,
          value: ethActualCharge.toString()
        })

        // swap(1): transfer DAI from Paymaster to Pool
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: UNISWAP_V3_DAI_WETH_POOL_CONTRACT_ADDRESS,
          value: expectedDaiTokenCharge.toString()
        })

        // swap(2): execute swap; note that WETH remains in a SwapRouter so it unwraps it for us
        expectEvent(res, 'Swap', {
          sender: SWAP_ROUTER_CONTRACT_ADDRESS,
          recipient: SWAP_ROUTER_CONTRACT_ADDRESS
        })

        // swap(3): SwapRouter unwraps ETH and sends it into Paymaster
        expectEvent(res, 'Withdrawal', {
          src: SWAP_ROUTER_CONTRACT_ADDRESS,
          wad: ethActualCharge.toString()
        })

        // swap(4): Paymaster receives ETH
        expectEvent(res, 'Received', {
          sender: SWAP_ROUTER_CONTRACT_ADDRESS,
          eth: ethActualCharge.toString()
        })

        // swap(5): Paymaster deposits all ETH to RelayHub
        expectEvent(res, 'Deposited', {
          from: permitPaymaster.address,
          paymaster: permitPaymaster.address,
          amount: ethActualCharge.toString()
        })

        // swap(6): Paymaster refunds remaining DAI tokens to sender
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: account0,
          value: expectedRefund.toString()
        })

        expectEvent(res, 'TokensCharged')
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
      const permitPaymasterZeroGUBP = await PermitERC20UniswapV3Paymaster.new(
        WETH9_CONTRACT_ADDRESS,
        DAI_CONTRACT_ADDRESS,
        testRelayHub.address,
        SWAP_ROUTER_CONTRACT_ADDRESS,
        CHAINLINK_USD_ETH_FEED_CONTRACT_ADDRESS,
        GSN_FORWARDER_CONTRACT_ADDRESS,
        POOL_FEE,
        0, // do not set 'gasUsedByPost'
        PERMIT_DATA_LENGTH,
        PERMIT_SIGNATURE_DAI
      )
      const context = web3.eth.abi.encodeParameters(['address', 'uint256'], [account0, 500])
      const postGasUse = await calculatePostGas(daiPermittableToken, permitPaymasterZeroGUBP, account0, context)
      assert.closeTo(postGasUse.toNumber(), GAS_USED_BY_POST, 5000)
    })
  })
})
