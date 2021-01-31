import { GsnTestEnvironment, TestEnvironment } from '../src/relayclient/GsnTestEnvironment'
import { HttpProvider } from 'web3-core'
import { RelayClient } from '../src/relayclient/RelayClient'
import { expectEvent } from '@openzeppelin/test-helpers'
import { TestRecipientInstance } from '../types/truffle-contracts'

const TestRecipient = artifacts.require('TestRecipient')

contract('GsnTestEnvironment', function () {
  let host: string

  before(function () {
    host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
  })

  describe('#startGsn()', function () {
    it('should create a valid test environment for other tests to rely on', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const testEnv = await GsnTestEnvironment.startGsn(host)
      assert.equal(testEnv.contractsDeployment.relayHubAddress!.length, 42)
    })

    after(async function () {
      await GsnTestEnvironment.stopGsn()
    })
  })

  context('using RelayClient', () => {
    let sr: TestRecipientInstance
    let sender: string
    let testEnvironment: TestEnvironment
    let relayClient: RelayClient
    before(async () => {
      sender = await web3.eth.personal.newAccount('password')
      testEnvironment = await GsnTestEnvironment.startGsn(host)
      relayClient = testEnvironment.relayProvider.relayClient
      sr = await TestRecipient.new(testEnvironment.contractsDeployment.forwarderAddress!)
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should relay using relayTransaction', async () => {
      const ret = await relayClient.relayTransaction({
        from: sender,
        to: sr.address,
        forwarder: await sr.getTrustedForwarder(),
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI()
      })
      assert.deepEqual([...ret.relayingErrors.values(), ...ret.pingErrors.values()], [])
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.realSender.toLocaleLowerCase(), sender.toLocaleLowerCase())
    })
  })

  context('using RelayProvider', () => {
    let sr: TestRecipientInstance
    let sender: string
    let testEnvironment: TestEnvironment
    before(async function () {
      sender = await web3.eth.personal.newAccount('password')
      testEnvironment = await GsnTestEnvironment.startGsn(host)
      sr = await TestRecipient.new(testEnvironment.contractsDeployment.forwarderAddress!)

      // @ts-ignore
      TestRecipient.web3.setProvider(testEnvironment.relayProvider)
    })
    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should send relayed transaction through RelayProvider', async () => {
      const txDetails = {
        from: sender,
        paymaster: testEnvironment.contractsDeployment.paymasterAddress,
        forwarder: await sr.getTrustedForwarder(),
        gas: 100000
      }
      const ret = await sr.emitMessage('hello', txDetails)

      expectEvent(ret, 'SampleRecipientEmitted', {
        realSender: sender
      })
    })
  })
})
