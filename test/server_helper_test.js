/* global web3 contract it before after artifacts describe beforeEach afterEach */
const assert = require('chai').use(require('chai-as-promised')).assert;
const ServerHelper = require('../src/js/relayclient/ServerHelper');
const HttpWrapper = require('../src/js/relayclient/HttpWrapper');
const testutils = require('./testutils')
const register_new_relay = testutils.register_new_relay;
const increaseTime = testutils.increaseTime;

const RelayHub = artifacts.require("./RelayHub.sol");

const localhostOne = "http://localhost:8090"
const gasPricePercent = 20

contract('ServerHelper', function (accounts) {
    let minStake = 1.5e17
    let minDelay = 10
    let httpWrapper = new HttpWrapper()
    let serverHelper = new ServerHelper(httpWrapper, { minStake, minDelay, verbose: false })
    let rhub
    let relayproc

    before(async function(){
        rhub = await RelayHub.deployed()
        relayproc = await testutils.startRelay(rhub, {
            verbose: process.env.relaylog,
            stake: 2e17, delay: 3600, txfee: 12, url: "asd", relayOwner: accounts[0], EthereumNodeUrl: web3.currentProvider.host,GasPricePercent:gasPricePercent})
        serverHelper.setHub(rhub)
    })

    after(async function () {
        await testutils.stopRelay(relayproc)
    })

    describe('with running relay hub', function () {
        // Note: a real relay server is not registered in this context
        before('registering relays', async function () {
            // unstake delay too low
            await register_new_relay(rhub, 2e17, 2, 20, "https://abcd1.com", accounts[7], accounts[0]);
            // unregistered
            await register_new_relay(rhub, 2e17, 20, 2, "https://abcd2.com", accounts[2], accounts[0]);
            // stake too low
            await register_new_relay(rhub, 1e17, 20, 20, "https://abcd3.com", accounts[3], accounts[0]);

            // Added, removed, added again - go figure.
            // 2 x will not ping
            await register_new_relay(rhub, 2e17, 20, 15, "https://abcd4.com", accounts[4], accounts[0]);
            await rhub.removeRelayByOwner(accounts[4], { from: accounts[0] });
            await increaseTime(20 + 1);
            await rhub.unstake(accounts[4],{ from: accounts[0] });
            await register_new_relay(rhub, 2e17, 20, 15, "go_resolve_this_address", accounts[4], accounts[0]);

            await register_new_relay(rhub, 2e17, 20, 30, "https://abcd4.com", accounts[5], accounts[0]);

            await rhub.removeRelayByOwner(accounts[2], { from: accounts[0] });
            await increaseTime(20 + 1);
            await rhub.unstake(accounts[2],{ from: accounts[0] });

            serverHelper.setHub(rhub);
        });
        
        it("should list all relays from relay contract", async function () {
            const relays = await serverHelper.fetchRelaysAdded();
            assert.deepEqual(
                relays.map(relay => relay.relayUrl), 
                [localhostOne, 'go_resolve_this_address', 'https://abcd4.com']
            );
        });

        it("should discover a relay from the relay contract", async function () {
            let pinger = await serverHelper.newActiveRelayPinger()
            let relay = await pinger.nextRelay()
            assert.equal(localhostOne, relay.relayUrl);
        });
    });

    describe('with mock http wrapper', function () {
        //mock for HttpWrapper: instead of sending any ping, the URL is expected to be a json. (ignoring the "getaddr" suffix)
        // if it contains "error", then return it as error. otherwise, its the http send response.
        class MockHttpWrapper {
            constructor() {
                this.pinged=0
            }

            send(url, jsonRequestData, callback) {

                let relayInfo = JSON.parse(url.replace(/\/\w+$/,''))

                this.pinged++

                if (relayInfo.error) {
                    setTimeout(() => callback(new Error(url), null), 0)
                } else {
                    setTimeout(() => callback(null, relayInfo), 0)
                }
            }
        }

        it( "ActiveRelayPinger should keep trying find a relay after 6 broken (high gas, not ready) relays", async function() {

            let mockRelays = [
                { relayUrl:"url1", error: "failed relay1", stake:1, unstakeDelay:1 },
                { relayUrl:"url2", Ready:false, stake:1, unstakeDelay:1 },
                { relayUrl:"url3", error: "failed relay1", stake:1, unstakeDelay:1 },
                { relayUrl:"url4", MinGasPrice: 1e20, Ready:true, stake:1, unstakeDelay:1 },
                { relayUrl:"url5", MinGasPrice: 1, Ready:true, stake:1, unstakeDelay:1 },
                { relayUrl:"url6", Ready:false, stake:1, unstakeDelay:1 },
                { relayUrl:"url7", MinGasPrice: 1, Ready:true, stake:1, unstakeDelay:1 },
            ]


            mockRelays.forEach(r => r.relayUrl = JSON.stringify(r))

            let mockHttpWrapper = new MockHttpWrapper( mockRelays )

            let pinger = new serverHelper.ActiveRelayPinger(mockRelays, mockHttpWrapper, 100)

            //should skip the bad relays, 3 at a time, and reach relay 5
            let r = await pinger.nextRelay()
            //validate its "url5" that got returned (the other were rejected)
            assert.equal("url5", JSON.parse(r.relayUrl).relayUrl )
            //make sure we totally tried exactly 6 relays (we ping in triplets)
            assert.equal(6, mockHttpWrapper.pinged )

        })
    });

    describe('with mock relay hub', function () {
        // let minStake = 1.5e17
        // let minDelay = 10
    
        const mockRelayAddedEvents = [
            { relay: '1' },
            { relay: '2' },
            { relay: '3' },
            { relay: '4', unstakeDelay: 5 }, // dropped out by default, below minDelay
            { relay: '5', stake: 1e17, transactionFee: 1e5 }, // dropped out by default, below minStake
            { relay: '6', stake: 3e17, transactionFee: 1e9 },
            { relay: '7', transactionFee: 1e7 },
        ].map(relay => ({ 
            event: 'RelayAdded', 
            returnValues: Object.assign({}, { 
                transactionFee: 1e10, 
                relayUrl: `url-${relay.relay}`, 
                stake: 2e17, 
                unstakeDelay: 100
            }, relay)
        }));

        beforeEach('set mock relay hub', function () {
            this.originalRelayHub = serverHelper.relayHubInstance;
            this.mockRelayHub = { getPastEvents: () => mockRelayAddedEvents };
            serverHelper.setHub(this.mockRelayHub);
        });

        afterEach('restore original relay hub', function () {
            serverHelper.setHub(this.originalRelayHub);
        });

        it("should use default strategy for filtering and sorting relays", async function() {
            // 4 & 5 are dropped out due low unstakeDelay and stake
            // 7 & 6 go first due to lower transaction fee (1e7 and 1e9, vs 1e10 of the rest)
            const relays = await serverHelper.fetchRelaysAdded();
            assert.deepEqual(relays.map(r => r.address), ['7', '6', '1', '2', '3']);
        });

        it("should not filter relays if minimum values not set", async function() {
            // 4 & 5 are not filtered out since no restrictions on minimum delay or stake are set
            // 5, 7 & 6 go first due to lower transaction fee (1e5, 1e7, and 1e9, vs 1e10 of the rest)
            const customServerHelper = new ServerHelper(httpWrapper, { });
            customServerHelper.setHub(this.mockRelayHub);
            const relays = await customServerHelper.fetchRelaysAdded();
            assert.deepEqual(relays.map(r => r.address), ['5', '7', '6', '1', '2', '3', '4']);
        });

        it("should use custom strategy for filtering and sorting relays", async function() {
            // 1, 2, 3, & 4 are filtered out due to the custom strategy of filtering by address (only > 4)
            // 6, 7 & 5 are sorted based on stake (3e17, 2e17 & 1e17 respectively)
            const customServerHelper = new ServerHelper(httpWrapper, {
                relayFilter: (relay) => (relay.address > '4'),
                relayComparator: (r1, r2) => (r2.stake - r1.stake)
            });
            customServerHelper.setHub(this.mockRelayHub);
            const relays = await customServerHelper.fetchRelaysAdded();
            assert.deepEqual(relays.map(r => r.address), ['6', '7', '5']);
        });
    });
})