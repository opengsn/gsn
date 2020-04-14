// test various flows, in multiple modes:
// once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
// succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

import {expectEvent} from '@openzeppelin/test-helpers'
import DevRelayClient from '../src/relayclient/DevRelayClient'
import Web3 from 'web3'
import {ether} from '@openzeppelin/test-helpers'
import {
    RelayHubInstance,
    TestPaymasterEverythingAcceptedInstance, TestRecipientInstance
} from "../types/truffle-contracts";
import {WebsocketProvider} from "web3-core";
import {configureGSN} from "../src/relayclient/GSNConfigurator";

const SampleRecipient = artifacts.require('tests/TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('tests/TestPaymasterEverythingAccepted')

const RelayHub = artifacts.require('RelayHub')
const StakeManager = artifacts.require('StakeManager')
const GsnDevProvider = require('../src/relayclient/GsnDevProvider')

const verbose = false

contract('GsnDevProvider', async ([from, relayOwner]) => {
    let sr: TestRecipientInstance
    let paymaster: TestPaymasterEverythingAcceptedInstance
    let relayHub: RelayHubInstance
    let wssProvider: WebsocketProvider

    before(async () => {
        const sm = await StakeManager.new()
        relayHub = await RelayHub.new(16, sm.address, {gas: 10000000})

        sr = await SampleRecipient.new()

        paymaster = await TestPaymasterEverythingAccepted.new()
        await paymaster.setHub(relayHub.address)

        await relayHub.depositFor(paymaster.address, {value: ether('1')})

        // RelayServer requires a provider with events (not HttpProvider)
        // @ts-ignore
        wssProvider = new Web3.providers.WebsocketProvider(web3.currentProvider.host)
    })
    context.only('just with DevRelayClient', () => {
        let sender: string
        let relayClient : DevRelayClient
        before(async () => {
            relayClient = new DevRelayClient(new Web3(wssProvider), {
                listenPort: 12345, relayOwner,
                gasPriceFactor: 1,
                pctRelayFee: 0,
                baseRelayFee: 0
            }, {
                verbose,
                gasPriceFactorPercent: 1,
                maxRelayNonceGap: 1,
                minGasPrice: '0'
            }, configureGSN({
                relayHubAddress: relayHub.address
            }))
            let keypair = relayClient.accountManager.newAccount();
            sender = keypair.address

            relayClient.accountManager.addAccount(keypair)
        })

        after(async () => {
            relayClient.stop()
        })

        it('should relay using relayTransaction', async () => {
            await relayClient.relayTransaction({
                from:sender,
                to:sr.address,
                forwarder: await sr.getTrustedForwarder(),
                paymaster: paymaster.address,
                gas: 1e6.toString(),
                data:sr.contract.methods.emitMessage('hello').encodeABI()
            })
            const events = await sr.contract.getPastEvents()
            assert.equal(events[0].event, 'SampleRecipientEmitted')
            assert.equal(events[0].returnValues.realSender.toLocaleLowerCase(), sender.toLocaleLowerCase())
        })
    })
    context('using GsnDevProvider', () => {
        let devProvider: any
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
                // paymaster: paymaster.address
            })

            expectEvent(ret, 'SampleRecipientEmitted', {
                realSender: from
            })
        })
    })
})
