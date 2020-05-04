import GsnTestEnvironment, { TestEnvironment } from '../src/relayclient/GsnTestEnvironment'
import { HttpProvider } from 'web3-core'
import { TestRecipientInstance } from '../types/truffle-contracts'
import RelayClient from '../src/relayclient/RelayClient'
import { expectEvent } from '@openzeppelin/test-helpers'

const TestRecipient = artifacts.require('tests/TestRecipient')

contract('GsnTestEnvironment', function () {
  let sr: TestRecipientInstance
  let host: string

  before(async function () {
    sr = await TestRecipient.new()
    host = (web3.currentProvider as HttpProvider).host
  })

  describe('#startGsn()', function () {
    it('should create a valid test environment for other tests to rely on', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const testEnv = await GsnTestEnvironment.startGsn(host)
      assert.equal(testEnv.deploymentResult.relayHubAddress.length, 42)
    })

    after(async function () {
      await GsnTestEnvironment.stopGsn()
    })
  })

  context('just with DevRelayClient', () => {
    let sender: string
    let testEnvironment: TestEnvironment
    let relayClient: RelayClient
    before(async () => {
      sender = await web3.eth.personal.newAccount('password')
      testEnvironment = await GsnTestEnvironment.startGsn(host)
      relayClient = testEnvironment.relayProvider.relayClient
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should relay using relayTransaction', async () => {
      await relayClient.relayTransaction({
        from: sender,
        to: sr.address,
        forwarder: await sr.getTrustedForwarder(),
        paymaster: testEnvironment.deploymentResult.paymasterAddress,
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI()
      })
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.realSender.toLocaleLowerCase(), sender.toLocaleLowerCase())
    })
  })

  context('using GsnDevProvider', () => {
    let sender: string
    let testEnvironment: TestEnvironment
    before(async function () {
      sender = await web3.eth.personal.newAccount('password')
      testEnvironment = await GsnTestEnvironment.startGsn(host)
      TestRecipient.web3.setProvider(testEnvironment.relayProvider)
    })
    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should send relayed transaction through devProvider', async () => {
      const txDetails = {
        from: sender,
        paymaster: testEnvironment.deploymentResult.paymasterAddress,
        forwarder: await sr.getTrustedForwarder()
      }
      const ret = await sr.emitMessage('hello', txDetails)

      expectEvent(ret, 'SampleRecipientEmitted', {
        realSender: sender
      })
    })
  })
})
