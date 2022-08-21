/* global contract artifacts before it */

import { TestTokenInstance, TestUniswapInstance } from '../types/truffle-contracts'
import BN from 'bn.js'
import { MAX_INTEGER } from 'ethereumjs-util'
import { toWei } from 'web3-utils'

const TestUniswap = artifacts.require('TestUniswap')
const TestToken = artifacts.require('TestToken')

contract('#TestUniswap', ([from]) => {
  let uniswap: TestUniswapInstance
  let token: TestTokenInstance

  before(async () => {
    uniswap = await TestUniswap.new(2, 1, { value: toWei('5') })
    token = await TestToken.at(await uniswap.tokenAddress())
    // approve uniswap to take our tokens.
    // @ts-ignore
    await token.approve(uniswap.address, MAX_INTEGER)
  })

  it('check exchange rate', async () => {
    assert.equal((await uniswap.getTokenToEthOutputPrice(2e10)).toString(), (4e10).toString())
    assert.equal((await uniswap.getTokenToEthInputPrice(2e10)).toString(), (1e10).toString())
  })

  it.skip('swap token to eth', async () => {
  /*
    await token.mint(10e18.toString())
    const ethBefore = await web3.eth.getBalance(from)
    const tokensBefore = await token.balanceOf(from)
    // zero price for easier calculation
    await uniswap.tokenToEthSwapOutput(2e18.toString(), -1, -1, { gasPrice: 0 })
    const ethAfter = await web3.eth.getBalance(from)
    const tokensAfter = await token.balanceOf(from)

    assert.equal((tokensAfter - tokensBefore) / 1e18, -4)
    assert.equal((ethAfter - ethBefore) / 1e18, 2)
  */
  })

  it('swap and transfer', async () => {
    await token.mint(10e18.toString())
    const target = '0x' + '1'.repeat(40)
    const tokensBefore = await token.balanceOf(from)
    const ethBefore = await web3.eth.getBalance(target)
    // @ts-ignore
    await uniswap.tokenToEthTransferOutput(2e18.toString(), MAX_INTEGER, MAX_INTEGER, target)
    const tokensAfter = await token.balanceOf(from)

    const ethAfter = await web3.eth.getBalance(target)
    // @ts-ignore
    assert.equal((tokensAfter.sub(tokensBefore)).div(new BN((1e18).toString())).toNumber(), -4)
    assert.equal((parseInt(ethAfter) - parseInt(ethBefore)) / 1e18, 2)
  })
})
