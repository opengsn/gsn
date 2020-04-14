const Big = require('big.js')

const Environments = require('../src/relayclient/types/Environments')

const RelayHub = artifacts.require('./RelayHub.sol')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')

contract('SampleRecipient', function (accounts) {
  const expectedRealSender = accounts[0]
  const message = 'hello world'
  let sample
  let paymaster

  before(async function () {
    sample = await SampleRecipient.new()
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
    const deposit = new Big('100000000000000000')
    const stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    const rhub = await RelayHub.new(Environments.defaultEnvironment.gtxdatanonzero, stakeManager.address,
      penalizer.address)
    await paymaster.setHub(rhub.address)
    await rhub.depositFor(paymaster.address, {
      from: accounts[0],
      value: deposit
    })
    let depositActual = await rhub.balanceOf(paymaster.address)
    assert.equal(deposit.toString(), depositActual.toString())
    const a0BalanceBefore = await web3.eth.getBalance(accounts[0])
    const gasPrice = 1
    const owner = await paymaster.owner.call()
    const res = await paymaster.withdrawRelayHubDepositTo(depositActual, owner, {
      from: owner,
      gasPrice: gasPrice
    })
    const a0BalanceAfter = await web3.eth.getBalance(accounts[0])
    const expectedBalanceAfter = new Big(a0BalanceBefore).add(deposit).sub(res.receipt.gasUsed * gasPrice)
    assert.equal(expectedBalanceAfter.toFixed(), a0BalanceAfter.toString())
    depositActual = await rhub.balanceOf(paymaster.address)
    assert.equal('0', depositActual.toString())
  })
})
