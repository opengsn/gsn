import { GsnTestEnvironment, TestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { HttpProvider } from 'web3-core'
import { RelayClient } from '@opengsn/provider/dist/RelayClient'
import { expectEvent } from '@openzeppelin/test-helpers'
import { TestRecipientInstance } from '@opengsn/contracts/types/truffle-contracts'
import { toChecksumAddress } from 'ethereumjs-util'
import { saveDeployment } from '@opengsn/cli/dist/utils'
import { constants, defaultEnvironment } from '@opengsn/common'
import { CommandsLogic } from '@opengsn/cli/dist/CommandsLogic'

const TestRecipient = artifacts.require('TestRecipient')

contract('GsnTestEnvironment', function (accounts: string[]) {
  let host: string

  before(function () {
    host = (web3.currentProvider as HttpProvider).host ?? 'localhost'
  })

  describe('#startGsn()', function () {
    it('should create a valid test environment for other tests to rely on', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      let testEnv = await GsnTestEnvironment.startGsn(host)
      assert.equal(testEnv.contractsDeployment.relayHubAddress!.length, 42)
      const worker1 = testEnv.workerAddress
      const manager1 = testEnv.managerAddress
      const hub1 = testEnv.contractsDeployment.relayHubAddress
      testEnv = await GsnTestEnvironment.startGsn(host)
      const worker2 = testEnv.workerAddress
      const manager2 = testEnv.managerAddress
      const hub2 = testEnv.contractsDeployment.relayHubAddress
      assert.equal(worker1, worker2)
      assert.equal(manager1, manager2)
      assert.notEqual(hub1, hub2)
      testEnv = await GsnTestEnvironment.startGsn(
        host, undefined, undefined, undefined, false
      )
      const worker3 = testEnv.workerAddress
      const manager3 = testEnv.managerAddress
      assert.notEqual(worker1, worker3)
      assert.notEqual(manager1, manager3)
    })

    after(async function () {
      await GsnTestEnvironment.stopGsn()
    })
  })

  describe('#loacContracts', function () {
    it('should verify the deployment is valid', async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const logic = new CommandsLogic(host, console, {})
      const deploymentResult = await logic.deployGsnContracts({
        from: accounts[0],
        gasPrice: 1e10.toString(),
        minimumTokenStake: '1',
        gasLimit: 10000000,
        relayHubConfiguration: defaultEnvironment.relayHubConfiguration,
        penalizerConfiguration: defaultEnvironment.penalizerConfiguration,
        skipConfirmation: true,
        deployTestToken: true,
        burnAddress: constants.BURN_ADDRESS,
        devAddress: constants.BURN_ADDRESS
      })
      const workdir = './tmptest/deploy'
      saveDeployment(deploymentResult, workdir)
      const deployment = await GsnTestEnvironment.loadDeployment(host, workdir)
      assert.equal(deployment.relayHubAddress, deploymentResult.relayHubAddress)
    })
  })

  context('using RelayClient', () => {
    let sr: TestRecipientInstance
    let sender: string
    let testEnvironment: TestEnvironment
    let relayClient: RelayClient
    before(async () => {
      testEnvironment = await GsnTestEnvironment.startGsn(host)
      relayClient = testEnvironment.relayProvider.relayClient
      sr = await TestRecipient.new(testEnvironment.contractsDeployment.forwarderAddress!)
      sender = toChecksumAddress(relayClient.newAccount().address)
    })

    after(async () => {
      await GsnTestEnvironment.stopGsn()
    })

    it('should relay using relayTransaction', async () => {
      const { maxFeePerGas, maxPriorityFeePerGas } = await relayClient.calculateGasFees()
      const ret = await relayClient.relayTransaction({
        from: sender,
        to: sr.address,
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI(),
        maxFeePerGas,
        maxPriorityFeePerGas
      })
      assert.deepEqual([...ret.relayingErrors.values(), ...ret.pingErrors.values()], [])
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.realSender.toLowerCase(), sender.toLowerCase())
    })
  })

  context('using RelayProvider', () => {
    let sr: TestRecipientInstance
    let sender: string
    let testEnvironment: TestEnvironment
    before(async function () {
      testEnvironment = await GsnTestEnvironment.startGsn(host)
      sr = await TestRecipient.new(testEnvironment.contractsDeployment.forwarderAddress!)
      sender = toChecksumAddress(testEnvironment.relayProvider.newAccount().address)
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
