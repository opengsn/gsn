import { HttpProvider } from 'web3-core'

import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import {
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance,
  TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { deployHub, emptyBalance, serverWorkDir, startRelay, stopRelay } from './TestUtils'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { registerForwarderForGsn, defaultEnvironment, constants, ether, Address } from '@opengsn/common'

import Web3 from 'web3'
import fs from 'fs'
import { KEYSTORE_FILENAME } from '@opengsn/relay/dist/KeyManager'

const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Forwarder = artifacts.require('Forwarder')
const TestToken = artifacts.require('TestToken')
contract('runServer', function (accounts) {
  let sr: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let rhub: RelayHubInstance
  let sm: StakeManagerInstance
  let testToken: TestTokenInstance
  const gasless = accounts[10]
  let relayProcess: ChildProcessWithoutNullStreams
  let relayClientConfig: Partial<GSNConfig>
  let relayProvider: RelayProvider
  const stake = 1e18.toString()

  async function deployGsnContracts (): Promise<void> {
    testToken = await TestToken.new()
    sm = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    await testToken.mint(stake)
    await testToken.approve(sm.address, stake)
    const p = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay,
      defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    rhub = await deployHub(sm.address, p.address, testToken.address, constants.ZERO_ADDRESS, stake)
    await rhub.setMinimumStakes([testToken.address], [stake])

    const forwarder = await Forwarder.new()
    // truffle uses web3.version 1.2.1 which doesn't support eip 1559.
    // It passes both gasPrice and maxFeePerGas/maxPriorityFeePerGas to the node, which returns
    // error: 'Cannot send both gasPrice and maxFeePerGas params'
    // TODO update truffle version
    // @ts-ignore
    TestRecipient.web3 = new Web3(web3.currentProvider.host)
    sr = await TestRecipient.new(forwarder.address)

    await registerForwarderForGsn(forwarder)

    paymaster = await TestPaymasterEverythingAccepted.new()
    await paymaster.setTrustedForwarder(forwarder.address)
    await paymaster.setRelayHub(rhub.address)

    await rhub.depositFor(paymaster.address, { value: (5e18).toString() })

    relayClientConfig = {
      loggerConfiguration: { logLevel: 'error' },
      paymasterAddress: paymaster.address,
      maxApprovalDataLength: 4,
      maxPaymasterDataLength: 4
    }

    relayProvider = await RelayProvider.newProvider(
      {
        provider: web3.currentProvider as HttpProvider,
        config: relayClientConfig
      }).init()

    // @ts-ignore
    TestRecipient.web3.setProvider(relayProvider)
  }

  before(async () => {
    await emptyBalance(gasless, accounts[0])
  })
  it('should create different workers directories for different RelayHubs', async function () {
    const hubsNumber = 2
    const differentHubs = new Set<Address>()
    for (let i = 0; i < hubsNumber; i++) {
      await deployGsnContracts()
      differentHubs.add(rhub.address)
      relayProcess = await startRelay(rhub.address, testToken, sm, {
        stake,
        stakeTokenAddress: testToken.address,
        delay: 3600 * 24 * 7,
        url: 'asd',
        relayOwner: accounts[0],
        // @ts-ignore
        ethereumNodeUrl: web3.currentProvider.host,
        gasPriceFactor: 1,
        initialReputation: 100,
        workerTargetBalance: ether('5'),
        value: ether('10'),
        relaylog: process.env.relaylog,
        rmPrevWorkdir: i === 0
      })
      try {
        console.log('relay started')
        assert.isTrue(fs.existsSync(`${serverWorkDir}/workers/${rhub.address}/${KEYSTORE_FILENAME}`))
        // Send gsn transaction to check the server is working after each hub configuration change
        let ex: Error | undefined
        try {
          const txDetails: any = { from: gasless, gas: 1e6 }
          await fixTxDetails(txDetails, relayProvider)
          const res = await sr.emitMessage('hello, from gasless', txDetails)
          console.log('res after gasless emit:', res.logs[0].args.message)
        } catch (e: any) {
          ex = e
        }
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        assert.isTrue(ex == null, `should succeed sending gasless transaction through relay. got: ${ex?.toString()}`)
      } finally {
        await stopRelay(relayProcess)
      }
    }
    // Sanity check that there are three directories in the test workdir for each hub
    assert.equal(differentHubs.size, hubsNumber)
    assert.equal(fs.readdirSync(`${serverWorkDir}/workers/`).length, hubsNumber)
  })

  async function fixTxDetails (txDetails: any, relayProvider: RelayProvider): Promise<void> {
    const { maxFeePerGas, maxPriorityFeePerGas } = await relayProvider.calculateGasFees()
    txDetails.maxFeePerGas = maxFeePerGas
    txDetails.maxPriorityFeePerGas = maxPriorityFeePerGas
  }
})
