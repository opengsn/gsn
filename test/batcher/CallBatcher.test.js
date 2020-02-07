/* global contract it before */
const TestBatcher = artifacts.require('TestBatcher')
const { assert } = require('chai')
const { packLogs } = require('../testutils')

async function dump (f) {
  try {
    const ret = await f
    if (!ret.receipt.status) {
      console.log('tx failed, gasused=', ret.receipt.gasUsed)
    } else if (ret.receipt) {
      console.log('gas=', ret.receipt.gasUsed, JSON.stringify(packLogs(ret.receipt.logs)))
    } else {
      console.log('ret=', ret)
    }
  } catch (e) {
    console.log('ex=', e)
  }
}

contract.only('CallBatcher', accounts => {
  let testBatcher
  before('init', async () => {
    testBatcher = await TestBatcher.new()
  })

  it.skip('gastest', async () => {
    // await dump( testBatcher.gasSomething(3000, {gas:28174}))
    // await dump( testBatcher.gasSomething(2091, {gas:28174}))
    // await dump( testBatcher.gasSomething(2090, {gas:28174}))
    // await dump( testBatcher.gasSomething(2000, {gas:28174}))
    await dump(testBatcher.gasSomething(1), { gas: 2e6 })
  })
  it('#sendBatch() of single request', async () => {
    const ret = await testBatcher.sendBatch(
      [
        [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()]
      ], false)

    const logs = packLogs(ret.receipt.logs)
    assert.deepEqual(logs, [
      { event: 'Something', x: '1', msgsender: testBatcher.address },
      { event: 'BatchSent', sender: accounts[0], successful: '1', error: '' }
    ])
  })
  it('#sendBatch() failed request', async () => {
    // can use either {target,callData} (object) or [target,callData] (array)
    const ret = await testBatcher.sendBatch([
      { target: testBatcher.address, callData: testBatcher.contract.methods.somethingFailed().encodeABI() }
    ], false)

    const logs = packLogs(ret.receipt.logs)
    assert.deepEqual(logs, [
      { event: 'BatchSent', sender: accounts[0], successful: '0', error: 'called somethingFailed' }
    ])
  })

  it('#sendBatch() of multiple calls', async () => {
    const ret = await testBatcher.sendBatch(
      [
        [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.somethingElse(false).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
      ], false)

    const logs = packLogs(ret.receipt.logs)
    assert.deepEqual(logs, [
      { event: 'Something', x: '1', msgsender: testBatcher.address },
      { event: 'Else', x: 'hello something else' },
      { event: 'Something', x: '3', msgsender: testBatcher.address },
      { event: 'BatchSent', sender: accounts[0], successful: '3', error: '' }
    ])
  })
  it('#sendBatch() return on first failure', async () => {
    const ret = await testBatcher.sendBatch(
      [
        [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.somethingFailed().encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
      ], true)

    const logs = packLogs(ret.receipt.logs)
    assert.deepEqual(logs, [
      { event: 'Something', x: '1', msgsender: testBatcher.address },
      { event: 'BatchSent', sender: accounts[0], successful: '1', error: 'called somethingFailed' }
    ])
  })

  it('#batchAndRevert() revert on first failure', async () => {
    try {
      await testBatcher.sendBatchAndRevert([
        [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.somethingFailed().encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
      ])
    } catch (e) {
      assert.match(e, /called somethingFailed/)
      return
    }
    assert.ok(false, 'should revert')
  })

  it('#sendBatch() don\'t return on first failure', async () => {
    const ret = await testBatcher.sendBatch(
      [
        [testBatcher.address, testBatcher.contract.methods.somethingElse(false).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.somethingElse(true).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.somethingFailed().encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
      ], false)

    const logs = packLogs(ret.receipt.logs)
    assert.deepEqual(logs, [
      { event: 'Else', x: 'hello something else' },
      { event: 'Something', x: '3', msgsender: testBatcher.address },
      { event: 'BatchSent', sender: accounts[0], successful: '2', error: 'asked else to fail' }
    ])
  })

  it('#sendBatch should send as many calls on gas limit ', async () => {
    const call = testBatcher.contract.methods.sendBatch(
      [
        [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(2).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
      ], false)

    const gas = await call.estimateGas()

    console.log('gas=', gas)
    const ret = await testBatcher.sendBatch(
      [
        [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(2).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
      ], false, { gas: gas - 1 })

    const logs = packLogs(ret.receipt.logs)
    assert.deepEqual(logs, [
      { event: 'Something', x: '1', msgsender: testBatcher.address },
      { event: 'Something', x: '2', msgsender: testBatcher.address },
      { event: 'BatchSent', sender: accounts[0], successful: '2', error: 'out-of-gas' }
    ])
  })
})
