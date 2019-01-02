/* global web3 contract it assert before after artifacts */
// test various flows, in multiple modes:
//  once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
//	succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

var testutils = require('./testutils.js')

let SampleRecipient = artifacts.require('SampleRecipient')

let RelayHub = artifacts.require('RelayHub')

let RelayClient = require('../src/js/relayclient/relayclient')

const localhostOne = "http://localhost:8090"
const gasPriceFactor = 50
var gasPrice = web3.eth.gasPrice.toNumber() * (100  + gasPriceFactor)/100

let options = [
    {title: "Direct-", relay: 0},
    {title: "Relayed-", relay: 1}
]

options.forEach(params => {

    contract(params.title + 'Flow', async (acc) => {
        let from
        let sr
        let rhub
        let accounts = acc
        let gasless
        let relayproc

        before(async () => {
            gasless = await web3.personal.newAccount("password")
            web3.personal.unlockAccount(gasless, "password")

            if (params.relay) {
                // rhub = await RelayHub.deployed()
                rhub = await RelayHub.new()
                relayproc = await testutils.startRelay(rhub, {
                    stake: 1e12,
                    delay: 3600,
                    txfee: 12,
                    url: "asd",
                    relayOwner: accounts[0],
                    EthereumNodeUrl: web3.currentProvider.host,
                    GasPriceFactor:gasPriceFactor
                })
                console.log("relay started")
                from = gasless
            } else {
                from = accounts[0]
                rhub = {address: "0x0"} //dummy relay hub. direct mode doesn't use it, but our SampleRecipient contract requires one.
            }

            sr = await SampleRecipient.new(rhub.address)
        })

        after(async function () {
            await testutils.stopRelay(relayproc)
        })

        if (params.relay) {
            it(params.title + "enable relay", async function () {
                let res = await testutils.postRelayHubAddress(rhub.address, localhostOne);
                assert.equal('"OK"', JSON.stringify(res))
                rhub.depositFor(sr.address, {value: 1e17})
                new RelayClient(web3, {
                    // verbose:true,
                    txfee: 12,
                    force_gasPrice: 3e10,			//override requested gas price
                    force_gasLimit: 100000		//override requested gas limit.
                }).hook(SampleRecipient)
            })
        }

        it(params.title + "send normal transaction", async () => {

            console.log("running emitMessage (should succeed")
            let res = await sr.emitMessage("hello", {from: from})
            assert.equal("hello", res.logs[0].args.message)
        })

        it(params.title + "send gasless tranasaction", async () => {

            console.log("gasless=" + gasless)

            console.log("running gasless-emitMessage (should fail for direct, succeed for relayed")
            let ex
            try {
                let res = await sr.emitMessage("hello, from gasless", {from: gasless})
                console.log("res after gasless emit:", res.logs[0].args.message)
            } catch (e) {
                ex = e
            }

            if (params.relay) {
                assert.ok(ex == null, "should succeed sending gasless transaction through relay")
            } else {
                assert.ok(ex.toString().indexOf("funds") > 0, "Expected Error with 'funds'. got: " + ex)
            }

        })
        it(params.title + "running testRevert (should always fail)", async () => {
            await asyncShouldThrow(async () => {
                await sr.testRevert({from: from})
            }, "revert")
        })

        async function asyncShouldThrow(asyncFunc, str) {
            let msg = str || 'Error'
            let ex = null
            try {
                await asyncFunc()
            } catch (e) {
                ex = e
            }
            assert.ok(ex != null, "Expected to throw1 " + msg + " but threw nothing")
            console.log("msg wtf?? ", ex.toString())
            assert.ok(ex.toString().includes(msg), "Expected to throw2 " + msg + " but threw " + ex.message)
        }

    })  //of contract

})  // of "foreach"
