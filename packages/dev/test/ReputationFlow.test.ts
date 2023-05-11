import { TestPaymasterConfigurableMisbehaviorInstance, TestRecipientInstance } from '@opengsn/contracts'
import { evmMine } from './TestUtils'
import { HttpProvider } from 'web3-core'
import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import sinon from 'sinon'
import { GsnTestEnvironment, TestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { RelayHubInstance } from '@opengsn/contracts/types/truffle-contracts'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const TestRecipient = artifacts.require('TestRecipient')
const Forwarder = artifacts.require('Forwarder')
const RelayHub = artifacts.require('RelayHub')

contract('ReputationFlow', function () {
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

  let misbehavingPaymaster: TestPaymasterConfigurableMisbehaviorInstance
  let testRecipient: TestRecipientInstance
  let relayProvider: RelayProvider
  let testEnv: TestEnvironment

  before(async function () {
    const host = (web3.currentProvider as HttpProvider).host
    testEnv = await GsnTestEnvironment.startGsn(host)

    const forwarderInstance = (await Forwarder.at(testEnv.contractsDeployment.forwarderAddress!))
    const relayHub = (await RelayHub.at(testEnv.contractsDeployment.relayHubAddress!)) as any as RelayHubInstance
    testRecipient = await TestRecipient.new(forwarderInstance.address)

    misbehavingPaymaster = await TestPaymasterConfigurableMisbehavior.new()
    await misbehavingPaymaster.setRevertPreRelayCallOnEvenBlocks(true)
    await misbehavingPaymaster.setTrustedForwarder(forwarderInstance.address)
    await misbehavingPaymaster.setRelayHub(relayHub.address)
    await misbehavingPaymaster.deposit({ value: web3.utils.toWei('1', 'ether') })

    relayProvider = await RelayProvider.newWeb3Provider({
      provider: ethersProvider,
      config: {
        loggerConfiguration: { logLevel: 'error' },
        paymasterAddress: misbehavingPaymaster.address
      }
    })
    // @ts-ignore
    TestRecipient.web3.setProvider(relayProvider)
  })

  after(async function () {
    await GsnTestEnvironment.stopGsn()
  })

  describe('with misbehaving paymaster', function () {
    it('should stop serving the paymaster after specified number of on-chain rejected transactions', async function () {
      sinon.stub(relayProvider.relayClient.dependencies.contractInteractor, 'validateRelayCall').returns(Promise.resolve({
        paymasterAccepted: true,
        returnValue: '',
        relayHubReverted: false,
        recipientReverted: false
      }))
      sinon.stub(relayProvider.relayClient.dependencies.contractInteractor, 'getGasFees').returns(Promise.resolve({
        priorityFeePerGas: 30e9.toString(),
        baseFeePerGas: 30e9.toString()
      }))
      sinon.stub(testEnv.httpServer.relayService!, 'validateViewCallSucceeds')
      for (let i = 0; i < 20; i++) {
        const block = await web3.eth.getBlockNumber()
        if (block % 2 === 0) {
          await evmMine()
          continue
        }
        try {
          await testRecipient.emitMessage('Hello there!', { gas: 100000 })
        } catch (e: any) {
          if (e.message.includes('Transaction has been reverted by the EVM') === true) {
            continue
          }
          if (e.message.includes('paymaster rejected in local view call to \'relayCall()\'') === true) {
            await evmMine()
            continue
          }
          if (e.message.includes('Paymaster rejected in server') === true) {
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
