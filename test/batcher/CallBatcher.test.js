/* global contract it before */
const TestBatcher = artifacts.require('TestBatcher')
const chai = require('chai')
const { assert } = require('chai')
const { packLogs } = require('../testutils')

chai.use(require('chai-as-promised'))
contract.only('CallBatcher', accounts => {
  let testBatcher
  before('init', async () => {
    testBatcher = await TestBatcher.new()
  })

  it('#sendBatch() should call a single successful request', async () => {
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
  it('#sendBatch() should return zero successful on failed request', async () => {
    // can use either {target,callData} (object) or [target,callData] (array)
    const ret = await testBatcher.sendBatch([
      { target: testBatcher.address, callData: testBatcher.contract.methods.somethingFailed().encodeABI() }
    ], false)

    const logs = packLogs(ret.receipt.logs)
    assert.deepEqual(logs, [
      { event: 'BatchSent', sender: accounts[0], successful: '0', error: 'called somethingFailed' }
    ])
  })

  it('#sendBatch() should send multiple successful requests', async () => {
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

  it('#sendBatch() should abort on first failure', async () => {
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

  it('#sendBatch() should continue after failure', async () => {
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

  it('#sendBatchAsTransaction() should send multiple requests', async () => {
    const ret = await testBatcher.sendBatchAsTransaction([
      [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()],
      [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
    ])
    assert.deepEqual(packLogs(ret.receipt.logs), [
      { event: 'Something', x: '1', msgsender: testBatcher.address },
      { event: 'Something', x: '3', msgsender: testBatcher.address }
    ])
  })

  it('#sendBatchAsTransaction() should revert on first failure', async () => {
    return assert.isRejected(
      testBatcher.sendBatchAsTransaction([
        [testBatcher.address, testBatcher.contract.methods.something(1).encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.somethingFailed().encodeABI()],
        [testBatcher.address, testBatcher.contract.methods.something(3).encodeABI()]
      ])
      , /revert.*called somethingFailed/)
  })
})
