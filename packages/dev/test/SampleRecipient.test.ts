import {
  ForwarderInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance
} from '@opengsn/contracts/types/truffle-contracts'
import BN from 'bn.js'
import { PrefixedHexString } from 'ethereumjs-util'
import { deployHub } from './TestUtils'
import { defaultEnvironment, constants } from '@opengsn/common'
import { registerForwarderForGsn } from '@opengsn/cli/dist/ForwarderUtil'

import { TestForwarderMessage } from '@opengsn/contracts/types/truffle-contracts/TestForwarderTarget'
import { defaultGsnConfig } from '@opengsn/provider'

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const Forwarder = artifacts.require('Forwarder')

contract('SampleRecipient', function (accounts) {
  const expectedRealSender = accounts[0]
  const message = 'hello world'
  let sample: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let forwarderInstance: ForwarderInstance
  let forwarder: PrefixedHexString

  before(async function () {
    forwarderInstance = await Forwarder.new()
    forwarder = forwarderInstance.address

    sample = await TestRecipient.new(forwarder)
    paymaster = await TestPaymasterEverythingAccepted.new()
  })

  it('should emit message with msgSender and realSender', async function () {
    const result = await sample.emitMessage(message)
    const log = result.logs[0]
    const args = log.args as TestForwarderMessage['args']
    assert.equal('SampleRecipientEmitted', log.event)
    assert.equal(args.message, message)
    assert.equal(accounts[0], args.msgSender)
    assert.equal(expectedRealSender, args.realSender)
  })

  // TODO: this test is in a wrong file
  it('should allow owner to withdraw balance from RelayHub', async function () {
    const deposit = new BN('100000000000000000')
    const stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    const penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    const rhub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, '0')
    await paymaster.setTrustedForwarder(forwarder)
    await paymaster.setRelayHub(rhub.address)
    await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, forwarderInstance)

    // transfer eth into paymaster (using the normal "transfer" helper, which internally
    // uses hub.depositFor)
    await web3.eth.sendTransaction({
      from: accounts[0],
      to: paymaster.address,
      value: deposit
    })

    let depositActual = await rhub.balanceOf(paymaster.address)
    assert.equal(deposit.toString(), depositActual.toString())
    const a0BalanceBefore = await web3.eth.getBalance(accounts[0])
    const gasPrice = new BN(1e9)
    const owner = await paymaster.owner()
    const res = await paymaster.withdrawRelayHubDepositTo(depositActual, owner, {
      from: owner,
      gasPrice: gasPrice
    })
    const txCost = (new BN(res.receipt.gasUsed)).mul(gasPrice)
    const a0BalanceAfter = await web3.eth.getBalance(accounts[0])
    const expectedBalanceAfter = new BN(a0BalanceBefore).add(deposit).sub(txCost)
    assert.equal(expectedBalanceAfter.toString(), a0BalanceAfter.toString())
    depositActual = await rhub.balanceOf(paymaster.address)
    assert.equal('0', depositActual.toString())
  })
})
