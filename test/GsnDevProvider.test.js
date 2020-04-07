// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

import { expectEvent } from '@openzeppelin/test-helpers'
import DevRelayClient from '../src/relayclient/DevRelayClient'
import Web3 from 'web3'

const SampleRecipient = artifacts.require('tests/TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('tests/TestPaymasterEverythingAccepted')

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const GsnDevProvider = require('../src/relayclient/GsnDevProvider')

const Environments = require('../src/relayclient/Environments')

const verbose = false

contract('GsnDevProvider', async ([from, relayOwner]) => {
  let sr
  let paymaster
  let relayHub
  let wssProvider

  before(async () => {
    const sm = await StakeManager.new()
    relayHub = await RelayHub.new(Environments.defEnv.gtxdatanonzero, sm.address, { gas: 10000000 })

    sr = await SampleRecipient.new()
    paymaster = await TestPaymasterEverythingAccepted.new()
    await paymaster.setHub(relayHub.address)

    await relayHub.depositFor(paymaster.address, { value: 1e18 })

    // RelayServer requires a provider with events (not HttpProvider)
    wssProvider = new web3.providers.WebsocketProvider(web3.currentProvider.host)
  })
  context('just with DevRelayClient', () => {
    let sender, relayClient
    before(async () => {
      const ephemeralKeypair = DevRelayClient.newEphemeralKeypair()
      sender = ephemeralKeypair.address

      relayClient = new DevRelayClient(new Web3(wssProvider), {
        verbose,
        paymaster: paymaster.address,
        relayHub: relayHub.address,
        relayOwner
      })
      relayClient.useKeypairForSigning(ephemeralKeypair)
    })

    after(async () => {
      relayClient.stop()
    })

    it('should relay using relayTransaction', async () => {
      await relayClient.relayTransaction(sr.contract.methods.emitMessage('hello').encodeABI(), {
        verbose: true,
        from: sender,
        to: sr.address,
        paymaster: paymaster.address,
        gas_limit: 1e6
      })
      const events = await sr.getPastEvents()
      assert.equal(events[0].event, 'SampleRecipientEmitted')
      assert.equal(events[0].args.realSender.toLocaleLowerCase(), sender.toLocaleLowerCase())
    })
  })
  context('using GsnDevProvider', () => {
    let devProvider
    before(async () => {
      devProvider = new GsnDevProvider(wssProvider, {
        verbose,
        relayOwner,
        relayHub: relayHub.address,
        paymaster: paymaster.address
      })

      SampleRecipient.web3.setProvider(devProvider)
    })
    after(async () => {
      devProvider.stop()
    })

    it('should send relayed transaction through devProvider', async () => {
      const ret = await sr.emitMessage('hello', {
        from,
        paymaster: paymaster.address
      })

      expectEvent(ret, 'SampleRecipientEmitted', {
        realSender: from
      })
    })
  })
})
