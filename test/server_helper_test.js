const ServerHelper = require('../src/js/relayclient/ServerHelper');
const HttpWrapper = require('../src/js/relayclient/HttpWrapper');
const testutils = require('./testutils')
const register_new_relay = testutils.register_new_relay;
const postRelayHubAddress = testutils.postRelayHubAddress;

const RelayHub = artifacts.require("./RelayHub.sol");

const localhostOne = "http://localhost:8090"
const relayAddress = "0x610bb1573d1046fcb8a70bbbd395754cd57c2b60";

contract('ServerHelper', function (accounts) {
    let minStake = 1000
    let minDelay = 10
    var serverHelper = new ServerHelper(minStake, minDelay, 1, new HttpWrapper(web3))
    let rhub

    before(async function(){
        rhub = await RelayHub.deployed()
        await postRelayHubAddress(rhub.address, localhostOne)
        serverHelper.setHub(RelayHub, rhub)
    })


    it("should get Relay Server's signing address from server", async function () {
        let pinger = await serverHelper.newActiveRelayPinger()
        let res = await pinger.getRelayAddressPing(localhostOne);
        assert.equal("0x610bb1573d1046fcb8a70bbbd395754cd57c2b60", res.RelayServerAddress)
    });

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
        await register_new_relay(rhub, 1000, 20, 15, "go_resolve_this_address", accounts[4]);

        await register_new_relay(rhub, 1000, 20, 30, "https://abcd.com", accounts[5]);

        await rhub.remove_relay_by_owner(accounts[2], { from: accounts[2] });
        serverHelper.setHub(RelayHub, rhub)
        let pinger = await serverHelper.newActiveRelayPinger()
        let relay = await pinger.nextRelay()
        assert.equal(relayAddress, relay.RelayServerAddress);
        assert.equal(localhostOne, relay.relayUrl);
    });
})