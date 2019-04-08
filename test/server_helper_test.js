/* global web3 contract it assert before after artifacts */
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
    var serverHelper = new ServerHelper(minStake, minDelay, new HttpWrapper(), true)
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

    // Note: a real relay server is not registered in this test.
    it("should discover a relay from the relay contract", async function () {
        // unstake delay too low
        await register_new_relay(rhub, 2e17, 2, 20, "https://abcd.com", accounts[7], accounts[0]);
        // unregistered
        await register_new_relay(rhub, 2e17, 20, 2, "https://abcd.com", accounts[2], accounts[0]);
        // stake too low
        await register_new_relay(rhub, 1e17, 20, 20, "https://abcd.com", accounts[3], accounts[0]);

        // Added, removed, added again - go figure.
        // 2 x will not ping
        await register_new_relay(rhub, 2e17, 20, 15, "https://abcd.com", accounts[4], accounts[0]);
        await rhub.remove_relay_by_owner(accounts[4], { from: accounts[0] });
        await increaseTime(20 + 1);
        await rhub.unstake(accounts[4],{ from: accounts[0] });
        await register_new_relay(rhub, 2e17, 20, 15, "go_resolve_this_address", accounts[4], accounts[0]);

        await register_new_relay(rhub, 2e17, 20, 30, "https://abcd.com", accounts[5], accounts[0]);

        await rhub.remove_relay_by_owner(accounts[2], { from: accounts[0] });
        await increaseTime(20 + 1);
        await rhub.unstake(accounts[2],{ from: accounts[0] });

        serverHelper.setHub(rhub)
        let pinger = await serverHelper.newActiveRelayPinger()
        let relay = await pinger.nextRelay()
        assert.equal(localhostOne, relay.relayUrl);
    });


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

})