const Big = require('big.js')

const RelayHub = artifacts.require('./RelayHub.sol')
const SampleRecipient = artifacts.require('./test/TestRecipient.sol')
const TestPaymasterEverythingAccepted = artifacts.require('./test/TestPaymasterEverythingAccepted.sol')

contract('SampleRecipient', function (accounts) {
  const expectedRealSender = accounts[0]
  const message = 'hello world'

  it('should emit message with msgSender and realSender', async function () {
    const sample = await SampleRecipient.deployed()
    const result = await sample.emitMessage(message)
    const log = result.logs[0]
    const args = log.args
    assert.equal('SampleRecipientEmitted', log.event)
    assert.equal(args.message, message)
    assert.equal(accounts[0], args.msgSender)
    assert.equal(expectedRealSender, args.realSender)
  })

  it('should allow owner to withdraw balance from RelayHub', async function () {
    const sample = await TestPaymasterEverythingAccepted.deployed()
    const deposit = new Big('100000000000000000')
    const rhub = await RelayHub.deployed()
    await rhub.depositFor(sample.address, { from: accounts[0], value: deposit })
    let depositActual = await rhub.balanceOf(sample.address)
    assert.equal(deposit.toString(), depositActual.toString())
    const a0BalanceBefore = await web3.eth.getBalance(accounts[0])
    const gasPrice = 1
    const owner = await sample.owner.call()
    const res = await sample.withdrawRelayHubDepositTo(depositActual, owner, {
      from: owner,
      gasPrice: gasPrice
    })
    const a0BalanceAfter = await web3.eth.getBalance(accounts[0])
    const expectedBalanceAfter = new Big(a0BalanceBefore).add(deposit).sub(res.receipt.gasUsed * gasPrice)
    assert.equal(expectedBalanceAfter.toFixed(), a0BalanceAfter.toString())
    depositActual = await rhub.balanceOf(sample.address)
    assert.equal('0', depositActual.toString())
  })
})
