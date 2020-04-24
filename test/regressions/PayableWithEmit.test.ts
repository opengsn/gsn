// import { getLogs } from '../TestUtils'
const PayableWithEmit = artifacts.require('./PayableWithEmit.sol')

contract('PayableWithEmit', () => {
  let sender: any
  let receiver: any

  before(async () => {
    receiver = await PayableWithEmit.new()
    sender = await PayableWithEmit.new()
  })
  it('payable that uses _msgSender()', async () => {
    const ret = await sender.doSend(receiver.address, { value: 1e18 })
    // console.log({ gasUsed: ret.receipt.gasUsed, log: getLogs(ret) })
    assert.equal(ret.logs.find((e: any) => e.event === 'GasUsed').args.success, true)
  })
})
