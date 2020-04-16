// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

import { expectEvent, ether } from '@openzeppelin/test-helpers'
import DevRelayClient from '../src/relayclient/DevRelayClient'
import Web3 from 'web3'
import fs from 'fs'

import {
  RelayHubInstance,
  TestPaymasterEverythingAcceptedInstance, TestRecipientInstance
} from '../types/truffle-contracts'
import { HttpProvider, WebsocketProvider } from 'web3-core'
import { configureGSN } from '../src/relayclient/GSNConfigurator'
import RelayClient from '../src/relayclient/RelayClient'

import GsnDevProvider from '../src/relayclient/GsnDevProvider'

const SampleRecipient = artifacts.require('tests/TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('tests/TestPaymasterEverythingAccepted')

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')

const verbose = false

contract('GsnDevProvider', ([from, relayOwner]) => {
  let sr: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let relayHub: RelayHubInstance
  let wssProvider: WebsocketProvider

  before(async () => {
    const sm = await StakeManager.new()
    const penalizer = await Penalizer.new()
    relayHub = await RelayHub.new(16, sm.address, penalizer.address, { gas: 10000000 })

    sr = await SampleRecipient.new()

    paymaster = await TestPaymasterEverythingAccepted.new()
    await paymaster.setHub(relayHub.address)

    await relayHub.depositFor(paymaster.address, { value: ether('1') })

    // RelayServer requires a provider with events (not HttpProvider)
    // @ts-ignore
    wssProvider = new Web3.providers.WebsocketProvider(web3.currentProvider.host)
  })
  context('just with DevRelayClient', () => {
    let sender: string
    let relayClient: DevRelayClient
    before(() => {
      const gsnConfig = configureGSN({
        relayHubAddress: relayHub.address,
        relayClientConfig: {
          minGasPrice: 0
        }
      })

      // TODO: should be able to start without workdir - so relay is completely
      // in-memory (or in a real temporary folder..)
      const workdir = '/tmp/gsn.devprovider.test'
      fs.rmdirSync(workdir, { recursive: true })

      const provider = wssProvider as unknown as HttpProvider
      const dependencyTree = RelayClient.getDefaultDependencies(provider, gsnConfig)
      relayClient = new DevRelayClient(
        dependencyTree, relayHub.address, gsnConfig.relayClientConfig, {
          workdir,
          listenPort: 12345,
          relayOwner,
          gasPriceFactor: 1,
          pctRelayFee: 0,
          baseRelayFee: 0
        })

      const keypair = relayClient.accountManager.newAccount()
      sender = keypair.address
    })

    after(() => {
      relayClient.stop()
    })

    it('should relay using relayTransaction', async () => {
      await relayClient.relayTransaction({
        from: sender,
        to: sr.address,
        forwarder: await sr.getTrustedForwarder(),
        paymaster: paymaster.address,
        gas: '0x' + 1e6.toString(16),
        data: sr.contract.methods.emitMessage('hello').encodeABI()
      })
      const events = await sr.contract.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].returnValues.realSender.toLocaleLowerCase(), sender.toLocaleLowerCase())
    })
  })
  context('using GsnDevProvider', () => {
    let devProvider: any
    before(() => {
      // @ts-ignore
      devProvider = new GsnDevProvider(wssProvider, {
        verbose,
        relayOwner,
        relayHub: relayHub.address,
        paymaster: paymaster.address
      })

      SampleRecipient.web3.setProvider(devProvider)
    })
    after(() => {
      devProvider.stop()
    })

    it('should send relayed transaction through devProvider', async () => {
      const ret = await sr.emitMessage('hello', {
        from
        // paymaster: paymaster.address
      })

      expectEvent(ret, 'SampleRecipientEmitted', {
        realSender: from
      })
    })
  })
})
