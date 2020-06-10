import { TestPaymasterEverythingAcceptedInstance, TestRecipientInstance } from '../types/truffle-contracts'
import BN from 'bn.js'
const RelayHub = artifacts.require('./RelayHub.sol')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestRecipient = artifacts.require('./test/TestRecipient.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')
const Eip712Forwarder = artifacts.require('Eip712Forwarder')

contract('SampleRecipient', function (accounts) {
  const expectedRealSender = accounts[0]
  const message = 'hello world'
  let sample: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance

  before(async function () {
    const forwarder = (await Eip712Forwarder.new()).address
    sample = await TestRecipient.new(forwarder)
    paymaster = await TestPaymasterEverythingAccepted.new()
  })

  it('should emit message with msgSender and realSender', async function () {
    const result = await sample.emitMessage(message)
    const log = result.logs[0]
    const args = log.args
    assert.equal('SampleRecipientEmitted', log.event)
    assert.equal(args.message, message)
    assert.equal(accounts[0], args.msgSender)
    assert.equal(expectedRealSender, args.realSender)
  })

  // TODO: this test is in a wrong file
  it('should allow owner to withdraw balance from RelayHub', async function () {
    const deposit = new BN('100000000000000000')
    const stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    const rhub = await RelayHub.new(stakeManager.address, penalizer.address)
    await paymaster.setRelayHub(rhub.address)

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
    const gasPrice = 1
    const owner = await paymaster.owner()
    const res = await paymaster.withdrawRelayHubDepositTo(depositActual, owner, {
      from: owner,
      gasPrice: gasPrice
    })
    const a0BalanceAfter = await web3.eth.getBalance(accounts[0])
    const expectedBalanceAfter = new BN(a0BalanceBefore).add(deposit).subn(res.receipt.gasUsed * gasPrice)
    assert.equal(expectedBalanceAfter.toString(), a0BalanceAfter.toString())
    depositActual = await rhub.balanceOf(paymaster.address)
    assert.equal('0', depositActual.toString())
  })
})
