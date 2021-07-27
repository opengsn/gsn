import BN from 'bn.js'
import { toWei } from 'web3-utils'
import {
  DAIPermitInterfaceInstance,
  IChainlinkOracleInstance,
  IQuoterInstance,
  PermitERC20UniswapV3PaymasterInstance,
  SampleRecipientInstance,
  TestHubInstance
} from '../types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { ForwarderInstance } from '@opengsn/contracts/types/truffle-contracts'
import { constants } from '@opengsn/common'
import { calculatePostGas, deployTestHub, mergeRelayRequest, revertReason } from './TestUtils'
import { signAndEncodeDaiPermit } from '../src/PermitPaymasterUtils'
import { revert, snapshot } from '@opengsn/dev/dist/test/TestUtils'
import { expectEvent } from '@openzeppelin/test-helpers'

const DAIPermitInterface = artifacts.require('DAIPermitInterface')
const IQuoter = artifacts.require('IQuoter')
const PermitERC20UniswapV3Paymaster = artifacts.require('PermitERC20UniswapV3Paymaster')
const IChainlinkOracle = artifacts.require('IChainlinkOracle')
const SampleRecipient = artifacts.require('SampleRecipient')
const Forwarder = artifacts.require('Forwarder')

// TODO: move useful stuff to utils
// as we are using forked mainnet, we will need to impersonate an account with a lot of DAI
const MAJOR_DAI_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503'

const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const WETH9 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
const SWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
const GSN_FORWARDER = '0xAa3E82b4c4093b4bA13Cb5714382C99ADBf750cA'
const DAI_WETH_POOL = '0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8'
const CHAINLINK_USD_ETH_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'

const MAX_POSSIBLE_GAS = 1e6
const GAS_PRICE = '1000000000' // 1 wei
const POOL_FEE = 3000
const GAS_USED_BY_POST = 199009
const PERMIT_DATA_LENGTH = 0
const PERMIT_SIGNATURE = 'permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'
const TOKEN_PRE_CHARGE = toWei('1', 'ether')

async function detectMainnet (): Promise<boolean> {
  const code = await web3.eth.getCode(DAI)
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
  let permittableToken: DAIPermitInterfaceInstance
  let chainlinkOracle: IChainlinkOracleInstance
  let sampleRecipient: SampleRecipientInstance
  let testRelayHub: TestHubInstance
  let forwarder: ForwarderInstance
  let quoter: IQuoterInstance

  let relayRequest: RelayRequest

  let id: string

  before(async function () {
    if (!await detectMainnet()) {
      return
    }
    sampleRecipient = await SampleRecipient.new()
    forwarder = await Forwarder.new({ gas: 1e7 })
    quoter = await IQuoter.at(QUOTER)
    permittableToken = await DAIPermitInterface.at(DAI)
    chainlinkOracle = await IChainlinkOracle.at(CHAINLINK_USD_ETH_FEED)
    testRelayHub = await deployTestHub() as TestHubInstance
    // in case the MAJOR_DAI_HOLDER account does not have ETH on actual mainnet
    await web3.eth.sendTransaction({
      from: account0,
      to: MAJOR_DAI_HOLDER,
      value: 1e18
    })
    // we cannot sign on behalf of an impersonated account - transfer DAI to an account we control
    await permittableToken.transfer(account0, toWei('100000', 'ether'), { from: MAJOR_DAI_HOLDER })
    permitPaymaster = await PermitERC20UniswapV3Paymaster.new(
      WETH9,
      DAI,
      testRelayHub.address,
      SWAP_ROUTER,
      CHAINLINK_USD_ETH_FEED,
      GSN_FORWARDER,
      POOL_FEE,
      GAS_USED_BY_POST,
      PERMIT_DATA_LENGTH,
      PERMIT_SIGNATURE
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
          ), /readBytes4: data too short/)
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
          ), /paymasterData: must be encoded permit method/)
      })

      it('should revert if permit call reverts', async function () {
        await skipWithoutFork(this)
        const incorrectNonce = 777
        const encodedCallToPermit = await signAndEncodeDaiPermit(
          account0,
          permitPaymaster.address,
          permittableToken.address,
          constants.MAX_UINT256.toString(),
          web3,
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
        await permittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account1 })
        const modifiedRequest = mergeRelayRequest(relayRequest, {}, { from: account1 })
        const balance = await permittableToken.balanceOf(account1)
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
      it('should execute permit method on a target token', async function () {
        await skipWithoutFork(this)
        const approvalBefore = await permittableToken.allowance(account0, permitPaymaster.address)
        assert.equal(approvalBefore.toString(), '0', 'unexpected approval')
        const accountBalanceBefore = await permittableToken.balanceOf(account0)
        const spenderBalanceBefore = await permittableToken.balanceOf(permitPaymaster.address)
        assert.equal(spenderBalanceBefore.toString(), '0', 'unexpected balance')
        const encodedCallToPermit = await signAndEncodeDaiPermit(
          account0,
          permitPaymaster.address,
          permittableToken.address,
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

        const paymasterBalanceAfter = await permittableToken.balanceOf(permitPaymaster.address)
        // it is dependant on actual cost of ether on uniswap, but pre-charge below 10¢ will be unfortunate
        assert.isAbove(parseInt(paymasterBalanceAfter.toString()), 1e17, 'unexpected balance (real-world price dependant)')

        const accountBalanceAfter = await permittableToken.balanceOf(account0)
        const accountDifference = accountBalanceBefore.sub(accountBalanceAfter)
        // must have charged from this account
        assert.equal(accountDifference.toString(), paymasterBalanceAfter.toString(), 'unexpected balance')
        const latestAnswer = await chainlinkOracle.latestAnswer()
        const maxPossibleEth = await testRelayHub.calculateCharge(MAX_POSSIBLE_GAS, relayRequest.relayData)
        const expectedCharge = latestAnswer.mul(maxPossibleEth).div(new BN(1e8.toString()))
        assert.equal(accountDifference.toString(), paymasterBalanceAfter.toString(), 'unexpected balance')
        assert.equal(accountDifference.toString(), expectedCharge.toString(), 'unexpected charge')

        const approvalAfter = await permittableToken.allowance(account0, permitPaymaster.address)
        assert.equal(approvalAfter.toString(), constants.MAX_UINT256.toString(), 'insufficient approval')
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
          return
        }
        await permittableToken.approve(permitPaymaster.address, constants.MAX_UINT256, { from: account0 })
        await permittableToken.transfer(permitPaymaster.address, TOKEN_PRE_CHARGE, { from: account0 })
      })

      it('should transfer excess tokens back to sender and deposit traded tokens into RelayHub as Ether', async function () {
        await skipWithoutFork(this)
        const gasUseWithoutPost = 100000
        const context = web3.eth.abi.encodeParameters(['address', 'uint256'], [account0, TOKEN_PRE_CHARGE])

        const ethActualCharge = (gasUseWithoutPost + GAS_USED_BY_POST) * parseInt(GAS_PRICE)
        const expectedDaiTokenCharge = await quoter.contract.methods.quoteExactOutputSingle(
          DAI,
          WETH9,
          POOL_FEE,
          ethActualCharge,
          0).call()

        const res = await testRelayHub.callPostRC(permitPaymaster.address, context, gasUseWithoutPost, relayRequest.relayData)
        const expectedRefund = new BN(TOKEN_PRE_CHARGE).sub(new BN(expectedDaiTokenCharge))

        // check correct tokens are transferred
        assert.equal(res.logs[0].address.toLowerCase(), WETH9.toLowerCase())
        assert.equal(res.logs[1].address.toLowerCase(), DAI.toLowerCase())
        assert.equal(res.logs[6].address.toLowerCase(), DAI.toLowerCase())

        // swap(0): transfer WETH from Pool to Router
        expectEvent(res, 'Transfer', {
          from: DAI_WETH_POOL,
          to: SWAP_ROUTER,
          value: ethActualCharge.toString()
        })

        // swap(1): transfer DAI from Paymaster to Pool
        expectEvent(res, 'Transfer', {
          from: permitPaymaster.address,
          to: DAI_WETH_POOL,
          value: expectedDaiTokenCharge.toString()
        })

        // swap(2): execute swap; note that WETH remains in a SwapRouter so it unwraps it for us
        expectEvent(res, 'Swap', {
          sender: SWAP_ROUTER,
          recipient: SWAP_ROUTER
        })

        // swap(3): SwapRouter unwraps ETH and sends it into Paymaster
        expectEvent(res, 'Withdrawal', {
          src: SWAP_ROUTER,
          wad: ethActualCharge.toString()
        })

        // swap(4): Paymaster receives ETH
        expectEvent(res, 'Received', {
          sender: SWAP_ROUTER,
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
        WETH9,
        DAI,
        testRelayHub.address,
        SWAP_ROUTER,
        CHAINLINK_USD_ETH_FEED,
        GSN_FORWARDER,
        POOL_FEE,
        0, // do not set 'gasUsedByPost'
        PERMIT_DATA_LENGTH,
        PERMIT_SIGNATURE
      )
      const context = web3.eth.abi.encodeParameters(['address', 'uint256'], [account0, 500])
      const postGasUse = await calculatePostGas(permittableToken, permitPaymasterZeroGUBP, account0, context)
      assert.closeTo(postGasUse.toNumber(), GAS_USED_BY_POST, 1000)
    })
  })
})
