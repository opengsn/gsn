import { ChildProcessWithoutNullStreams } from 'child_process'

import { TestPaymasterConfigurableMisbehaviorInstance, TestRecipientInstance } from '@opengsn/contracts'
import { deployHub, evmMine, startRelay, stopRelay } from './TestUtils'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { HttpProvider } from 'web3-core'
import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import sinon from 'sinon'

const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const TestRecipient = artifacts.require('TestRecipient')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Forwarder = artifacts.require('Forwarder')

contract('ReputationFlow', function (accounts) {
  let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
  let relayProcess: ChildProcessWithoutNullStreams
  let testRecipient: TestRecipientInstance
  let relayProvider: RelayProvider

  before(async function () {
    const stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    const penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    const relayHub = await deployHub(stakeManager.address, penalizer.address)
    const forwarderInstance = await Forwarder.new()
    testRecipient = await TestRecipient.new(forwarderInstance.address)

    await registerForwarderForGsn(forwarderInstance)

    misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
    await misbehavingPaymaster.setRevertPreRelayCallOnEvenBlocks(true)
    await misbehavingPaymaster.setTrustedForwarder(forwarderInstance.address)
    await misbehavingPaymaster.setRelayHub(relayHub.address)
    await misbehavingPaymaster.deposit({ value: web3.utils.toWei('1', 'ether') })

    relayProvider = await RelayProvider.newProvider({
      provider: web3.currentProvider as HttpProvider,
      config: {
        loggerConfiguration: { logLevel: 'error' },
        paymasterAddress: misbehavingPaymaster.address
      }
    }).init()
    // @ts-ignore
    TestRecipient.web3.setProvider(relayProvider)

    relayProcess = await startRelay(relayHub.address, stakeManager, {
      initialReputation: 10,
      checkInterval: 100,
      stake: 1e18,
      relayOwner: accounts[1],
      ethereumNodeUrl: (web3.currentProvider as HttpProvider).host
    })
  })

  after(async function () {
    await stopRelay(relayProcess)
  })

  describe('with misbehaving paymaster', function () {
    it('should stop serving the paymaster after specified number of on-chain rejected transactions', async function () {
      sinon.stub(relayProvider.relayClient.dependencies.contractInteractor, 'validateRelayCall').returns(Promise.resolve({ paymasterAccepted: true, returnValue: '', reverted: false }))
      for (let i = 0; i < 20; i++) {
        try {
          await testRecipient.emitMessage('Hello there!', { gas: 100000 })
        } catch (e) {
          if (e.message.includes('Transaction has been reverted by the EVM') === true) {
            console.log('wtf is i just revert', i, await web3.eth.getBlockNumber())
            continue
          }
          if (e.message.includes('paymaster rejected in local view call to \'relayCall()\'') === true) {
            console.log('wtf is i paymaster rejected local??', i, await web3.eth.getBlockNumber())
            await evmMine()
            continue
          }
          if (e.message.includes('Paymaster rejected in server') === true) {
            console.log('wtf is i paymaster rejected server', i, await web3.eth.getBlockNumber())
            await evmMine()
            continue
          }
          assert.include(e.message, 'Refusing to serve transactions for paymaster')
          assert.isAtLeast(i, 7, 'refused too soon')
          return
        }
      }
      assert.fail('relaying never threw the reputation error')
    })
  })
})
