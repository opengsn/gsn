/* global web3 contract it assert before after artifacts */
// test various flows, in multiple modes:
//  once in Direct mode, and once in Relay (gasless) mode.
// the two modes must behave just the same (with an exception of gasless test, which must fail on direct mode, and must
//	succeed in gasless)
// the entire 'contract' test is doubled. all tests titles are prefixed by either "Direct:" or "Relay:"

var testutils = require('./testutils.js')

let SampleRecipient = artifacts.require('SampleRecipient')

let RelayHub = artifacts.require('RelayHub')

let RelayProvider = require('../src/js/relayclient/RelayProvider')

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
        let gasPrice
        let relay_client_config

        before(async () => {
            const gasPricePercent = 20
            gasPrice = ( await web3.eth.getGasPrice() ) * (100  + gasPricePercent)/100

            gasless = await web3.eth.personal.newAccount("password")
            web3.eth.personal.unlockAccount(gasless, "password")

            if (params.relay) {
                // rhub = await RelayHub.deployed()
                rhub = await RelayHub.new()
                relayproc = await testutils.startRelay(rhub, {
                    stake: 1e17,
                    delay: 3600,
                    txfee: 12,
                    url: "asd",
                    relayOwner: accounts[0],
                    EthereumNodeUrl: web3.currentProvider.host,
                    GasPricePercent:gasPricePercent
                })
                console.log("relay started")
                from = gasless
            } else {
                from = accounts[0]
                //dummy relay hub. direct mode doesn't use it, but our SampleRecipient contract requires one.
                rhub = await RelayHub.deployed()
            }

            sr = await SampleRecipient.new(rhub.address)
        })

        after(async function () {
            await testutils.stopRelay(relayproc)
        })

        if (params.relay) {
            it(params.title + "enable relay", async function () {
                rhub.depositFor(sr.address, {value: 1e17})

                relay_client_config = {
                    txfee: 60,
                    force_gasPrice: gasPrice,	//override requested gas price
                    force_gasLimit: 100000,		//override requested gas limit.
                    verbose: process.env.DEBUG
                }

                let relayProvider = new RelayProvider(web3.currentProvider, relay_client_config )

                // web3.setProvider(relayProvider)

                //NOTE: in real application its enough to set the provider in web3.
                // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
                // so changing the global one is not enough...
                SampleRecipient.web3.setProvider(relayProvider)

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
                assert.ok(ex == null, "should succeed sending gasless transaction through relay. got: "+ex)
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
            assert.ok(ex != null, "Expected to throw " + msg + " but threw nothing")
            assert.ok(ex.toString().includes(msg), "Expected to throw " + msg + " but threw " + ex.message)
        }

    })  //of contract

})  // of "foreach"
