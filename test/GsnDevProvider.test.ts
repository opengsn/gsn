// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

import { expectEvent, ether } from '@openzeppelin/test-helpers'
import { DevGSNConfig, DevRelayClient } from '../src/relayclient/DevRelayClient'
import Web3 from 'web3'

import {
  RelayHubInstance,
  TestPaymasterEverythingAcceptedInstance, TestRecipientInstance
} from '../types/truffle-contracts'
import { HttpProvider, WebsocketProvider } from 'web3-core'

import { GsnDevProvider } from '../src/relayclient/GsnDevProvider'

const SampleRecipient = artifacts.require('tests/TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('tests/TestPaymasterEverythingAccepted')

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')

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
    before(async () => {
      const provider = wssProvider as unknown as HttpProvider
      relayClient = new DevRelayClient(provider, {
        relayHubAddress: relayHub.address,
        minGasPrice: 0,

        relayOwner,
        gasPriceFactor: 1,
        pctRelayFee: 0,
        baseRelayFee: 0
      })

      sender = await web3.eth.personal.newAccount('password')
    })

    after(async () => {
      await relayClient?.stopRelay()
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
      const devConfig: DevGSNConfig = {
        relayOwner,
        relayHubAddress: relayHub.address,
        gasPriceFactor: 1,
        baseRelayFee: 0,
        pctRelayFee: 0
      }
      devProvider = new GsnDevProvider(wssProvider as unknown as HttpProvider, devConfig)

      SampleRecipient.web3.setProvider(devProvider)
    })
    after(async () => {
      await devProvider.stopRelay()
    })

    it('should send relayed transaction through devProvider', async () => {
      // @ts-ignore
      const txDetails = {
        from,
        paymaster: paymaster.address,
        forwarder: await sr.getTrustedForwarder()
      }
      const ret = await sr.emitMessage('hello', txDetails)

      expectEvent(ret, 'SampleRecipientEmitted', {
        realSender: from
      })
    })
  })
})
