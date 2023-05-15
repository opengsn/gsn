import { StaticJsonRpcProvider } from '@ethersproject/providers'
import {
  TypedRequestData,
  GsnDomainSeparatorType,
  GsnRequestType
} from '@opengsn/common/dist/EIP712/TypedRequestData'

import {
  TestHubInstance,
  TestProxyInstance,
  TestTokenInstance,
  TestUniswapInstance,
  TokenPaymasterInstance
} from '../types/truffle-contracts'
import {
  ForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { GsnTestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import {
  RelayRequest,
  cloneRelayRequest,
  defaultEnvironment,
  decodeRevertReason,
  getEip712Signature,
  constants
} from '@opengsn/common'
import { calculatePostGas, deployTestHub, mergeRelayRequest, registerAsRelayServer, revertReason } from './TestUtils'

import Web3 from 'web3'
import { toWei } from 'web3-utils'
import { PrefixedHexString, MAX_INTEGER } from 'ethereumjs-util'

import { deployHub, hardhatNodeChainId } from '@opengsn/dev/dist/test/TestUtils'
import { defaultGsnConfig } from '@opengsn/provider'

const TokenPaymaster = artifacts.require('TokenPaymaster')
const TestUniswap = artifacts.require('TestUniswap')
const TestToken = artifacts.require('TestToken')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestProxy = artifacts.require('TestProxy')

export const transferErc20Error = /ERC20: insufficient allowance/

// TODO: this test recreates GSN manually. Use GSN tools to do it instead.
contract('TokenPaymaster', ([from, relay, relayOwner, nonUniswap, burnAddress]) => {
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const provider = new StaticJsonRpcProvider(currentProviderHost)

  let paymaster: TokenPaymasterInstance
  let uniswap: TestUniswapInstance
  let token: TestTokenInstance
  let recipient: TestProxyInstance
  let hub: RelayHubInstance
  let forwarder: ForwarderInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let relayRequest: RelayRequest
  let signature: PrefixedHexString

  before(async () => {
    // exchange rate 2 tokens per eth.
    uniswap = await TestUniswap.new(2, 1, {
      value: (5e18).toString(),
      gas: 10000000
    })
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, burnAddress, burnAddress)
    penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    hub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, '0')
    token = await TestToken.at(await uniswap.tokenAddress())

    paymaster = await TokenPaymaster.new([uniswap.address], { gas: 1e7 })
    const context = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'address', 'address'],
      [from, 500, token.address, uniswap.address]
    )
    await token.mint(toWei('1', 'ether'))
    const gasUsedByPost = await calculatePostGas(token, paymaster, '0x', from, context)
    await paymaster.setPostGasUsage(gasUsedByPost)
    await paymaster.setRelayHub(hub.address)

    console.log('paymaster post with precharge=', (await paymaster.gasUsedByPost()).toString())
    forwarder = await Forwarder.new({ gas: 1e7 })
    recipient = await TestProxy.new(forwarder.address, { gas: 1e7 })

    await forwarder.registerRequestType(GsnRequestType.typeName, GsnRequestType.typeSuffix)
    await forwarder.registerDomainSeparator(defaultGsnConfig.domainSeparatorName, GsnDomainSeparatorType.version)
    await paymaster.setTrustedForwarder(forwarder.address)
    // approve uniswap to take our tokens.
    // @ts-ignore
    await token.approve(uniswap.address, MAX_INTEGER)

    const paymasterData = web3.eth.abi.encodeParameter('address', nonUniswap)

    const gasPrice = await web3.eth.getGasPrice()
    relayRequest = {
      relayData: {
        relayWorker: relay,
        paymaster: paymaster.address,
        forwarder: forwarder.address,
        transactionCalldataGasUsed: '0',
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        paymasterData,
        clientId: '1'
      },
      request: {
        data: recipient.contract.methods.test().encodeABI(),
        nonce: '0',
        value: '0',
        validUntilTime: '0',
        from,
        to: recipient.address,
        gas: 1e6.toString()
      }
    }

    const chainId = hardhatNodeChainId
    const dataToSign = new TypedRequestData(
      defaultGsnConfig.domainSeparatorName,
      chainId,
      forwarder.address,
      relayRequest
    )
    signature = await getEip712Signature(
      provider.getSigner(),
      dataToSign
    )
  })

  after(async function () {
    await GsnTestEnvironment.stopGsn()
  })

  context('#preRelayedCall', function () {
    let testHub: TestHubInstance
    context('revert reasons', function () {
      before(async function () {
        testHub = await deployTestHub() as TestHubInstance
        await paymaster.setRelayHub(testHub.address)
      })

      it('should reject if not enough balance', async () => {
        const req = mergeRelayRequest(relayRequest, { paymasterData: web3.eth.abi.encodeParameter('address', uniswap.address) })
        assert.match(await revertReason(testHub.callPreRC(req, signature, '0x', 1e6)), /ERC20: insufficient allowance/)
      })

      it('should reject if unknown paymasterData', async () => {
        const req = mergeRelayRequest(relayRequest, { paymasterData: '0x1234' })
        const signature = await getEip712Signature(provider.getSigner(), new TypedRequestData(defaultGsnConfig.domainSeparatorName, 1, forwarder.address, req))
        assert.match(await revertReason(testHub.callPreRC(req, signature, '0x', 1e6)), /paymasterData: invalid length for Uniswap v3 exchange address/)
      })

      it('should reject if unsupported uniswap in paymasterData', async () => {
        const req = mergeRelayRequest(relayRequest, { paymasterData: web3.eth.abi.encodeParameter('address', nonUniswap) })
        const signature = await getEip712Signature(provider.getSigner(), new TypedRequestData(defaultGsnConfig.domainSeparatorName, 1, forwarder.address, req))
        assert.match(await revertReason(testHub.callPreRC(req, signature, '0x', 1e6)), /unsupported token uniswap/)
      })
    })

    context('with funded recipient', function () {
      before(async function () {
        await token.mint(5e18.toString())
        await token.transfer(recipient.address, 5e18.toString())
      })

      it('should reject if no token approval', async () => {
        const req = mergeRelayRequest(relayRequest, { paymasterData: web3.eth.abi.encodeParameter('address', uniswap.address) })
        assert.match(await revertReason(testHub.callPreRC(req, signature, '0x', 1e6)), transferErc20Error)
      })

      context('with token approved for paymaster', function () {
        before(async function () {
          await recipient.execute(token.address, token.contract.methods.approve(paymaster.address, MAX_INTEGER.toString()).encodeABI())
        })

        // deliberately removing this functionality as a bit redundant - just pass the token at all times
        it.skip('callPreRC should succeed and return default token/uniswap', async () => {
          const ret: any = await testHub.callPreRC.call(relayRequest, signature, '0x', 1e6)
          const decoded = web3.eth.abi.decodeParameters(['address', 'address', 'address', 'address'], ret.context)
          assert.equal(decoded[2], token.address)
          assert.equal(decoded[3], uniswap.address)
        })

        it('callPreRC should succeed with specific token/uniswap', async () => {
          const req = mergeRelayRequest(relayRequest, { paymasterData: web3.eth.abi.encodeParameter('address', uniswap.address) })
          const signature = await getEip712Signature(provider.getSigner(), new TypedRequestData(defaultGsnConfig.domainSeparatorName, 1, forwarder.address, req))
          const ret: any = await testHub.callPreRC.call(req, signature, '0x', 1e6)
          const decoded = web3.eth.abi.decodeParameters(['address', 'address', 'address', 'address'], ret.context) as any
          assert.equal(decoded[2], token.address)
          assert.equal(decoded[3], uniswap.address)
        })
      })
    })
  })

  context('#relayedCall()', function () {
    const paymasterDeposit = 1e18.toString()

    before(async () => {
      // TODO: not needed. use startGsn instead
      await registerAsRelayServer(token, stakeManager, relay, relayOwner, hub)
      await hub.depositFor(paymaster.address, { value: paymasterDeposit })
      await paymaster.setRelayHub(hub.address)
    })

    it('should reject if incorrect signature', async () => {
      const wrongSignature = await getEip712Signature(
        provider.getSigner(),
        new TypedRequestData(
          defaultGsnConfig.domainSeparatorName,
          222,
          forwarder.address,
          relayRequest
        )
      )
      const gas = 5000000

      const req = mergeRelayRequest(relayRequest, { paymasterData: web3.eth.abi.encodeParameter('address', uniswap.address) })
      const relayCall: any = await hub.relayCall.call(defaultGsnConfig.domainSeparatorName, 1e06, req, wrongSignature, '0x', {
        from: relay,
        gas
      })
      assert.equal(decodeRevertReason(relayCall.returnValue), 'FWD: signature mismatch')
    })

    it('should pay with token to make a call', async function () {
      const preTokens = await token.balanceOf(recipient.address)
      const prePaymasterTokens = await token.balanceOf(paymaster.address)
      // for simpler calculations: we don't take any fee, and gas price is '1', so actual charge
      // should be exactly gas usage. token is 2:1 to eth, so we expect to pay exactly twice the "charge"
      const _relayRequest = cloneRelayRequest(relayRequest)
      _relayRequest.request.from = from
      _relayRequest.request.nonce = (await forwarder.getNonce(from)).toString()
      _relayRequest.relayData.maxFeePerGas = 1e9.toString()
      _relayRequest.relayData.maxPriorityFeePerGas = 1e9.toString()
      _relayRequest.relayData.paymasterData = web3.eth.abi.encodeParameter('address', uniswap.address)

      // note that by default, ganache is buggy: getChainId returns 1337 but on-chain "chainid" returns 1.
      // only if we pass it "--chainId 1337" the above 2 return the same value...
      const chainId = await new Web3(web3.currentProvider as any).eth.getChainId()

      const dataToSign = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        chainId,
        forwarder.address,
        _relayRequest
      )
      const signature = await getEip712Signature(
        provider.getSigner(),
        dataToSign
      )

      const preBalance = await hub.balanceOf(paymaster.address)

      const externalGasLimit = 5e6.toString()
      const ret = await hub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, _relayRequest, signature, '0x', {
        from: relay,
        gasPrice: 1e9,
        gas: externalGasLimit
      })

      const rejected = ret.logs.find(log => log.event === 'TransactionRejectedByPaymaster')
      // @ts-ignore
      assert.ok(rejected == null, `Rejected with reason: ${decodeRevertReason(rejected?.args.reason) as string}`)
      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      // @ts-ignore
      const events = await paymaster.getPastEvents()
      const chargedEvent = events.find((e: any) => e.event === 'TokensCharged')

      // console.log({ relayed, chargedEvent })
      // @ts-ignore
      console.log('charged: ', relayed!.args.charge.toString())
      // @ts-ignore
      assert.equal(relayed!.args.status, 0)
      const postTokens = await token.balanceOf(recipient.address)
      const usedTokens = preTokens.sub(postTokens)

      console.log('recipient tokens balance change (used tokens): ', usedTokens.toString())
      // @ts-ignore
      console.log('reported charged tokens in TokensCharged: ', chargedEvent.args.tokenActualCharge.toString())
      // @ts-ignore
      const expectedTokenCharge = await uniswap.getTokenToEthOutputPrice(chargedEvent.args.ethActualCharge)
      assert.closeTo(usedTokens.toNumber(), expectedTokenCharge.toNumber(), 1000)
      const postBalance = await hub.balanceOf(paymaster.address)

      assert.ok(postBalance >= preBalance,
        `expected paymaster balance not to be reduced: pre=${preBalance.toString()} post=${postBalance.toString()}`)
      // TODO: add test for relayed.args.charge, once gasUsedWithoutPost parameter is fixed (currently, its too high, and Paymaster "charges" too much)
      const postPaymasterTokens = await token.balanceOf(paymaster.address)
      console.log('Paymaster "earned" tokens:', postPaymasterTokens.sub(prePaymasterTokens).toString())
      console.log('Paymaster "earned" deposit on RelayHub:', postBalance.sub(preBalance).toString())
    })
  })
})
