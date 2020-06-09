/* global contract artifacts before it */

import { constants } from '@openzeppelin/test-helpers'
import TypedRequestData from '../src/common/EIP712/TypedRequestData'
import RelayRequest, { cloneRelayRequest } from '../src/common/EIP712/RelayRequest'
import { PrefixedHexString } from 'ethereumjs-tx'
import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestProxyInstance,
  TestTokenInstance,
  TestUniswapInstance,
  TokenPaymasterInstance,
  ForwarderInstance
} from '../types/truffle-contracts'

import { defaultEnvironment } from '../src/relayclient/types/Environments'
import { getEip712Signature } from '../src/common/Utils'
import {extraDataWithDomain} from "../src/common/EIP712/ExtraData";

const TokenPaymaster = artifacts.require('TokenPaymaster')
const TokenGasCalculator = artifacts.require('TokenGasCalculator')
const TestUniswap = artifacts.require('TestUniswap')
const TestToken = artifacts.require('TestToken')
const RelayHub = artifacts.require('RelayHub')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestProxy = artifacts.require('TestProxy')

async function revertReason (func: Promise<any>): Promise<string> {
  try {
    await func
    return 'ok' // no revert
  } catch (e) {
    return e.message.replace(/.*revert /, '')
  }
}

contract('TokenPaymaster', ([from, relay, relayOwner]) => {
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

  async function calculatePostGas (paymaster: TokenPaymasterInstance): Promise<void> {
    const testpaymaster = await TokenPaymaster.new(await paymaster.uniswap(), { gas: 1e7 })
    const calc = await TokenGasCalculator.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, { gas: 10000000 })
    await testpaymaster.transferOwnership(calc.address)
    // put some tokens in paymaster so it can calculate postRelayedCall gas usage:
    await token.mint(1e18.toString())
    await token.transfer(calc.address, 1e18.toString())
    const ret = await calc.calculatePostGas.call(testpaymaster.address)
    // @ts-ignore (TypeChain does not know tuple components' names)
    const { gasUsedByPostWithPreCharge, gasUsedByPostWithoutPreCharge } = ret
    console.log('post calculator:', gasUsedByPostWithPreCharge.toString(), gasUsedByPostWithoutPreCharge.toString())
    console.log(ret)
    await paymaster.setPostGasUsage(gasUsedByPostWithPreCharge, gasUsedByPostWithoutPreCharge)
  }

  before(async () => {
    // exchange rate 2 tokens per eth.
    uniswap = await TestUniswap.new(2, 1, {
      value: (5e18).toString(),
      gas: 1e7
    })
    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    hub = await RelayHub.new(stakeManager.address, penalizer.address)
    token = await TestToken.at(await uniswap.tokenAddress())

    paymaster = await TokenPaymaster.new(uniswap.address, { gas: 1e7 })
    await calculatePostGas(paymaster)
    await paymaster.setRelayHub(hub.address)

    console.log('paymaster post with precharge=', await paymaster.gasUsedByPostWithPreCharge.toString())
    console.log('paymaster post without precharge=', await paymaster.gasUsedByPostWithoutPreCharge.toString())
    forwarder = await Forwarder.new({ gas: 1e7 })
    recipient = await TestProxy.new(forwarder.address, { gas: 1e7 })

    // approve uniswap to take our tokens.
    await token.approve(uniswap.address, -1)

    const chainId = defaultEnvironment.chainId

    relayRequest = {
      request: {
        target: recipient.address,
        encodedFunction: recipient.contract.methods.test().encodeABI(),
        senderAddress: from,
        senderNonce: '0',
        gasLimit: 1e6.toString(),
      },
      relayData: {
        relayWorker: relay,
        paymaster: paymaster.address
      },
      gasData: {
        pctRelayFee: '1',
        baseRelayFee: '0',
        gasPrice: await web3.eth.getGasPrice()
      },
      extraData: extraDataWithDomain(forwarder.address, chainId)
    }

    const dataToSign = new TypedRequestData(
      chainId,
      forwarder.address,
      relayRequest
    )
    signature = await getEip712Signature(
      web3,
      dataToSign
    )
  })

  context('#acceptRelayedCall', function () {
    it('should fail if not enough balance', async () => {
      assert.equal(await revertReason(paymaster.acceptRelayedCall(relayRequest, signature, '0x', 1e6)), 'balance too low')
    })

    // not a test!
    it('should fund recipient', async () => {
      await token.mint(5e18.toString())
      await token.transfer(recipient.address, 5e18.toString())
    })

    it('should fail if no approval', async () => {
      assert.include(await revertReason(paymaster.acceptRelayedCall(relayRequest, signature, '0x', 1e6)), 'allowance too low')
    })

    // not a test!
    it('should recipient.approve', async () => {
      await recipient.execute(token.address, token.contract.methods.approve(paymaster.address, -1).encodeABI())
    })

    it('should succeed acceptRelayedCall', async () => {
      await paymaster.acceptRelayedCall(relayRequest, signature, '0x', 1e6)
    })
  })

  context('#relayedCall', () => {
    const paymasterDeposit = 1e18.toString()

    before(async () => {
      await stakeManager.stakeForAddress(relay, 7 * 24 * 3600, {
        from: relayOwner,
        value: (2e18).toString()
      })
      await stakeManager.authorizeHub(relay, hub.address, { from: relayOwner })
      await hub.addRelayWorkers([relay], { from: relay })
      await hub.registerRelayServer(2e16.toString(), '10', 'url', { from: relay })
      await hub.depositFor(paymaster.address, { value: paymasterDeposit })
    })

    it('pay with token to make a call', async () => {
      const preTokens = await token.balanceOf(recipient.address)
      const prePaymasterTokens = await token.balanceOf(paymaster.address)
      // for simpler calculations: we don't take any fee, and gas price is '1', so actual charge
      // should be exactly gas usage. token is 2:1 to eth, so we expect to pay exactly twice the "charge"
      const _relayRequest = cloneRelayRequest(relayRequest)
      _relayRequest.request.senderAddress = from
      _relayRequest.request.senderNonce = (await forwarder.getNonce(from)).toString()
      _relayRequest.gasData.gasPrice = '1'
      _relayRequest.gasData.pctRelayFee = '0'
      _relayRequest.gasData.baseRelayFee = '0'

      const chainId = defaultEnvironment.chainId
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder.address,
        _relayRequest
      )
      const signature = await getEip712Signature(
        web3,
        dataToSign
      )

      const preBalance = await hub.balanceOf(paymaster.address)

      const externalGasLimit = 5e6.toString()
      const ret = await hub.relayCall(_relayRequest, signature, '0x', externalGasLimit, {
        from: relay,
        gasPrice: 1,
        gas: externalGasLimit
      })

      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      // @ts-ignore
      const events = await paymaster.getPastEvents()
      const chargedEvent = events.find((e: any) => e.event === 'TokensCharged')

      console.log({ relayed, chargedEvent })
      console.log('charged: ', relayed!.args.charge.toString())
      assert.equal(relayed!.args.status, 0)
      const postTokens = await token.balanceOf(recipient.address)
      const usedTokens = preTokens.sub(postTokens)

      console.log('recipient tokens balance change (used tokens): ', usedTokens.toString())
      console.log('reported charged tokens in TokensCharged: ', chargedEvent.args.tokenActualCharge.toString())
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
