/* global contract it assert before after */
const ServerHelper = require('../src/js/relayclient/ServerHelper');
const HttpWrapper = require('../src/js/relayclient/HttpWrapper');
const testutils = require('./testutils')
const register_new_relay = testutils.register_new_relay;
const postRelayHubAddress = testutils.postRelayHubAddress;
const increaseTime = testutils.increaseTime;

const RelayHub = artifacts.require("./RelayHub.sol");

const localhostOne = "http://localhost:8090"

contract('ServerHelper', function (accounts) {
    let minStake = 1000
    let minDelay = 10
    var serverHelper = new ServerHelper(minStake, minDelay, new HttpWrapper(web3))
    let rhub
    let relayproc

    before(async function(){
        rhub = await RelayHub.deployed()
        relayproc = await testutils.startRelay(rhub, {
            verbose: process.env.relaylog,
            stake: 1e12, delay: 3600, txfee: 12, url: "asd", relayOwner: accounts[0], EthereumNodeUrl: web3.currentProvider.host})
        await postRelayHubAddress(rhub.address, localhostOne)
        serverHelper.setHub(RelayHub, rhub)
    })

    after(async function () {
        await testutils.stopRelay(relayproc)
    })

    // Note: a real relay server is not registered in this test.
    // It should be registered already by the 'postRelayHubAddress' in 'before'
    it("should discover a relay from the relay contract", async function () {
        // unstake delay too low
        await register_new_relay(rhub, 1000, 2, 20, "https://abcd.com", accounts[7]);
        // unregistered
        await register_new_relay(rhub, 1000, 20, 2, "https://abcd.com", accounts[2]);
        // stake too low
        await register_new_relay(rhub, 500, 20, 20, "https://abcd.com", accounts[3]);

        // Added, removed, added again - go figure.
        // 2 x will not ping
        await register_new_relay(rhub, 1000, 20, 15, "https://abcd.com", accounts[4]);
        await rhub.remove_relay_by_owner(accounts[4], { from: accounts[4] });
        await increaseTime(20 + 1);
        await rhub.unstake(accounts[4],{ from: accounts[4] });
        await register_new_relay(rhub, 1000, 20, 15, "go_resolve_this_address", accounts[4]);

        await register_new_relay(rhub, 1000, 20, 30, "https://abcd.com", accounts[5]);

        await rhub.remove_relay_by_owner(accounts[2], { from: accounts[2] });
        await increaseTime(20 + 1);
        await rhub.unstake(accounts[2],{ from: accounts[2] });

        serverHelper.setHub(RelayHub, rhub)
        let pinger = await serverHelper.newActiveRelayPinger()
        let relay = await pinger.nextRelay()
        assert.equal(localhostOne, relay.relayUrl);
    });
})