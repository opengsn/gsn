/* global contract artifacts before it */

import getDataToSign from '../src/js/relayclient/EIP712/Eip712Helper'

const Environments = require('../src/js/relayclient/Environments')

const TokenPaymaster = artifacts.require('TokenPaymaster.sol')
const TokenGasCalculator = artifacts.require('TokenGasCalculator.sol')
const TestUniswap = artifacts.require('TestUniswap.sol')
const TestToken = artifacts.require('TestToken.sol')
const RelayHub = artifacts.require('RelayHub.sol')
const TestProxy = artifacts.require('TestProxy')
const { getEip712Signature } = require('../src/js/relayclient/utils')

const RelayRequest = require('../src/js/relayclient/EIP712/RelayRequest')

async function retcode (func) {
  const ret = await func
  const code = ret[0].toNumber()
  const msg = code === 0 ? '' : ret[1] ? Buffer.from(ret[1].slice(2), 'hex').toString() : null
  return {
    code,
    msg
  }
}

contract('TokenPaymaster', ([from, relay, relayOwner]) => {
  let paymaster, uniswap, token, recipient, hub
  let sharedRelayRequestData

  async function calculatePostGas (paymaster) {
    const testpaymaster = await TokenPaymaster.new(await paymaster.uniswap(), { gas: 1e7 })
    const calc = await TokenGasCalculator.new({ gas: 10000000 })
    await testpaymaster.transferOwnership(calc.address)
    // put some tokens in paymaster so it can calculate postRelayedCall gas usage:
    await token.mint(1000)
    await token.transfer(calc.address, 1000)
    const ret = await calc.calculatePostGas.call(testpaymaster.address)
    await paymaster.setPostGasUsage(ret[0], ret[1])
  }

  before(async () => {
    // exchange rate 2 tokens per eth.
    uniswap = await TestUniswap.new(2, 1, { value: 5e18, gas: 1e7 })
    hub = await RelayHub.new(16, { gas: 1e7 })
    token = await TestToken.at(await uniswap.tokenAddress())

    paymaster = await TokenPaymaster.new(uniswap.address, { gas: 1e7 })
    await calculatePostGas(paymaster)
    await paymaster.setRelayHub(hub.address)

    recipient = await TestProxy.new({ gas: 1e7 })
    await recipient.setRelayHub(hub.address)

    // approve uniswap to take our tokens.
    await token.approve(uniswap.address, -1)

    sharedRelayRequestData = {
      senderAddress: from,
      encodedFunction: recipient.contract.methods.test().encodeABI(),
      senderNonce: '1',
      target: recipient.address,
      pctRelayFee: '1',
      baseRelayFee: '0',
      gasPrice: await web3.eth.getGasPrice(),
      gasLimit: 1e6.toString(),
      relayAddress: from,
      paymaster: paymaster.address
    }
  })

  context('#acceptRelayedCall', async () => {
    it('should fail if not enough balance', async () => {
      const relayRequest = new RelayRequest({
        ...sharedRelayRequestData
      })
      assert.deepEqual(await retcode(paymaster.acceptRelayedCall(relayRequest, '0x', 1e6)), {
        code: 99,
        msg: 'balance too low'
      })
    })

    it('should fund recipient', async () => {
      await token.mint(5e18.toString())
      await token.transfer(recipient.address, 5e18.toString())
    })

    it('should fail if no approval', async () => {
      const relayRequest = new RelayRequest({
        ...sharedRelayRequestData
      })
      assert.deepEqual(await retcode(paymaster.acceptRelayedCall(relayRequest, '0x', 1e6)), {
        code: 99,
        msg: 'allowance too low'
      })
    })

    it('should recipient.approve', async () => {
      await recipient.execute(token.address, token.contract.methods.approve(paymaster.address, -1).encodeABI())
    })

    it('should succeed acceptRelayedCall', async () => {
      const relayRequest = new RelayRequest({
        ...sharedRelayRequestData
      })
      const ret = await retcode(paymaster.acceptRelayedCall(relayRequest, '0x', 1e6))
      assert.equal(ret.code, 0, ret)
    })
  })

  context('#relayedCall', () => {
    const paymasterDeposit = 1e18.toString()

    before(async () => {
      await hub.stake(relay, 7 * 24 * 3600, {
        from: relayOwner,
        value: 2e18
      })
      await hub.registerRelay(2e16.toString(), '10', 'url', { from: relay })
      await hub.depositFor(paymaster.address, { value: paymasterDeposit })
    })

    it('pay with token to make a call', async () => {
      const preTokens = await token.balanceOf(recipient.address)
      const prePaymasterTokens = await token.balanceOf(paymaster.address)
      // for simpler calculations: we don't take any fee, and gas price is '1', so actual charge
      // should be exactly gas usage. token is 2:1 to eth, so we expect to pay exactly twice the "charge"
      const relayRequest = new RelayRequest({
        ...sharedRelayRequestData,
        senderAddress: from,
        senderNonce: (await hub.getNonce(from)).toString(),
        gasPrice: '1',
        pctRelayFee: '0',
        baseRelayFee: '0'
      })

      const chainId = Environments.defEnv.chainId
      const dataToSign = await getDataToSign({
        chainId,
        relayHub: hub.address,
        relayRequest
      })
      const signature = await getEip712Signature({
        web3,
        dataToSign
      })
      const maxGas = 1e6
      const arcGasLimit = 1e6

      // not really required.
      assert.deepEqual(await retcode(hub.canRelay(relayRequest, maxGas, arcGasLimit, signature, '0x', {
        from: relay,
        gasPrice: 1
      })), {
        code: 0,
        msg: ''
      })
      const preBalance = await hub.balanceOf(paymaster.address)

      const ret = await hub.relayCall(relayRequest, signature, '0x', {
        from: relay,
        gasPrice: 1,
        gas: 1.516181e6
      })

      // console.log(getLogs(ret))
      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      const events = await paymaster.getPastEvents()
      // console.log(getLogs(events))
      const chargedEvent = events.find(e => e.event === 'TokensCharged')

      assert.equal(relayed.args.status, 0)
      const postTokens = await token.balanceOf(recipient.address)
      const usedTokens = preTokens - postTokens

      console.log('recipient tokens balance change (used tokens): ', usedTokens.toString())
      console.log('reported charged tokens: ', chargedEvent.args.tokenActualCharge.toString())
      const expectedTokenCharge = await uniswap.getTokenToEthOutputPrice(chargedEvent.args.ethActualCharge)
      assert.closeTo(usedTokens, expectedTokenCharge.toNumber(), 1000)
      const postBalance = await hub.balanceOf(paymaster.address)

      assert.ok(postBalance >= preBalance,
        `expected paymaster balance not to be reduced: pre=${preBalance} post=${postBalance}`)
      // TODO: add test for relayed.args.charge, once gasUsedWithoutPost parameter is fixed (currently, its too high, and Paymaster "charges" too much)
      const postPaymasterTokens = await token.balanceOf(paymaster.address)
      console.log('Paymaster "earned" tokens:', postPaymasterTokens - prePaymasterTokens)
      console.log('Paymaster "earned" deposit on RelayHub:', postBalance - preBalance)
    })
  })
})
