/* globals web3 artifacts contract it before after assert */

const RelayClient = require('../src/js/relayclient/RelayClient');
const RelayProvider = require('../src/js/relayclient/RelayProvider');
const utils = require('../src/js/relayclient/utils')
const RelayHub = artifacts.require("./RelayHub.sol");
const SampleRecipient = artifacts.require("./SampleRecipient.sol");

const ethJsTx = require('ethereumjs-tx');
const ethUtils = require('ethereumjs-util');

const relayAddress = "0x610bb1573d1046fcb8a70bbbd395754cd57c2b60";

const localhostOne = "http://localhost:8090"

const testutils = require('./testutils')
const register_new_relay = testutils.register_new_relay;

const Big = require( 'big.js')

const util = require("util")
const request = util.promisify(require("request"))

contract('RelayClient', function (accounts) {

    let rhub;
    let sr;
    let gasLess;
    let relayproc;
    let gasPrice;
    let relay_client_config;
    let relayOwner = accounts[1];

    before(async function () {
        const gasPricePercent = 20
        gasPrice = ( await web3.eth.getGasPrice() ) * (100  + gasPricePercent)/100

        rhub = await RelayHub.deployed()
        sr = await SampleRecipient.deployed()

        await sr.deposit({value: web3.utils.toWei('0.1', 'ether')});
        // let known_deposit = await rhub.balances(sr.address);
        // assert.ok(known_deposit>= deposit, "deposited "+deposit+" but found only "+known_deposit);
        gasLess = await web3.eth.personal.newAccount("password")
        console.log("gasLess = " + gasLess);
        console.log("starting relay")

        relayproc = await testutils.startRelay(rhub, {
            stake: 1e17, delay: 3600, txfee: 12, url: "asd", relayOwner: relayOwner, EthereumNodeUrl: web3.currentProvider.host,GasPricePercent:gasPricePercent})

    });

    after(async function () {
        await testutils.stopRelay(relayproc)
    })

    it("test balanceOf target contract", async () => {

        let relayclient = new RelayClient(web3)
        let b1 = await relayclient.balanceOf(sr.address)
        console.log("balance before redeposit", b1)
        let added = 200000
        await sr.deposit({ value: added });
        let b2 = new Big( await relayclient.balanceOf(sr.address) )
        console.log("balance after redeposit", b2.toString())

        assert.equal(b2.sub(b1), added)

    })

    var func = async function ({from/*, to, tx, txfee, gas_price, gas_limit, nonce, relay_hub_address, relay_address*/}) {
        let toSign = web3.utils.sha3("0x" + Buffer.from("I approve").toString("hex") + utils.removeHexPrefix(from));
        let sign = await utils.getTransactionSignature(web3, accounts[0], toSign);
        return sign.slice(2);
    }
    var arr = [null, func]
    arr.forEach(approveFunction => {
        it("should send transaction to a relay and receive a response (" + ((( typeof approveFunction == 'function' ) ? "with" : "without") + " approveFunction)"), async function () {
            let encoded = sr.contract.methods.emitMessage("hello world").encodeABI()
            let to = sr.address;
            let options = {
                approveFunction: approveFunction,
                from: gasLess,
                to: to,
                txfee: 12,
                gas_limit: 1000000
            }
            let relay_client_config = {
                relayUrl: localhostOne,
                relayAddress: relayAddress,
                allowed_relay_nonce_gap: 0,
                verbose: process.env.DEBUG
            }

            let tbk = new RelayClient(web3, relay_client_config);

            let validTransaction = await tbk.relayTransaction(encoded, options);
            let txhash = "0x" + validTransaction.hash(true).toString('hex');
            let res
            do {
                res = await web3.eth.getTransactionReceipt(txhash)
                await testutils.sleep(500)
            } while (res === null)

            //validate we've got the "SampleRecipientEmitted" event
            let topic = web3.utils.sha3('SampleRecipientEmitted(string,address,address,address)')
            assert(res.logs.find(log => log.topics.includes(topic)))

            assert.equal("0x" + validTransaction.to.toString('hex'), rhub.address.toString().toLowerCase());
            assert.equal(parseInt(validTransaction.gasPrice.toString('hex'), 16), gasPrice);

        })
    });

    it("should consider a transaction with an incorrect approval as invalid")

    it("should consider a transaction with a relay tx nonce higher than expected as invalid", async function () {
        let encoded = sr.contract.methods.emitMessage("hello world").encodeABI()
        let to = sr.address;
        let options = {
            from: gasLess,
            to: to,
            txfee: 12,
            gas_limit: 1000000
        }
        let relay_client_config = {
            relayUrl: localhostOne,
            relayAddress: relayAddress,
            allowed_relay_nonce_gap: -1,
            verbose: process.env.DEBUG
        }
        let tbk = new RelayClient(web3, relay_client_config);
        let orig_send = tbk.httpSend.send
        tbk.httpSend.send = function(url, jsonRequestData, callback){
            if (url.includes("/relay")) {
                // Otherwise, server will return an error if asked to sign with a low nonce.
                jsonRequestData.RelayMaxNonce = 1000000
            }
            orig_send.bind(tbk.httpSend)(url, jsonRequestData, callback)
        }
        try {
            await tbk.relayTransaction(encoded, options);
            assert.fail()
        }
        catch(error) {
            if (error.toString().includes("Assertion")) {
                throw error
            }
            assert.equal(true, error.otherErrors[0].includes("Relay used a tx nonce higher than requested"))
        }
    });


    it("should relay transparently", async () => {

        relay_client_config = {

            txfee: 12,
            force_gasPrice: gasPrice,			//override requested gas price
            force_gasLimit: 4000029,		//override requested gas limit.
            verbose: process.env.DEBUG
        }

        let relayProvider = new RelayProvider(web3.currentProvider, relay_client_config)
        // web3.setProvider(relayProvider)

        //NOTE: in real application its enough to set the provider in web3.
        // however, in Truffle, all contracts are built BEFORE the test have started, and COPIED the web3,
        // so changing the global one is not enough...
        SampleRecipient.web3.setProvider(relayProvider)

        let res = await sr.emitMessage("hello world", {from: gasLess})
        assert.equal(res.logs[0].event, "SampleRecipientEmitted")
        assert.equal(res.logs[0].args.message, "hello world")
        assert.equal(res.logs[0].args.real_sender, gasLess)
        assert.equal(res.logs[0].args.msg_sender.toLowerCase(), rhub.address.toLowerCase())
        res = await sr.emitMessage("hello again", { from: accounts[3] })
        assert.equal(res.logs[0].event, "SampleRecipientEmitted")
        assert.equal(res.logs[0].args.message, "hello again")

        assert.equal(res.logs[0].args.real_sender, accounts[3])

    })

    // This test currently has no asserts. 'auditTransaction' returns no value.
    it.skip("should send a signed raw transaction from selected relay to backup relays - in case penalty will be needed", async function () {
        let tbk = new RelayClient(web3);
        let data1 = rhub.contract.methods.relay(1, 1, 1, 1, 1, 1, 1, 1).encodeABI()
        let transaction = new ethJsTx({
            nonce: 2,
            gasPrice: gasPrice,
            gasLimit: 200000,
            to: sr.address,
            value: 0,
            data: data1
        })
        let privKey = Buffer.from("4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d", "hex");
        transaction.sign(privKey)
        let rawTx = "0x" + transaction.serialize().toString('hex')
        console.log("tx to audit", rawTx)
        await tbk.auditTransaction(rawTx, [localhostOne, localhostOne]);
    });

    it.skip("should report a suspicious transaction to an auditor relay, which will penalize the double-signing relay", async function () {
        /******/
        await register_new_relay(rhub, 1000, 20, 30, "https://abcd.com", accounts[5]);
        /******/

        // let auditor_relay = accounts[10]
        // let initial_auditor_balance = web3.eth.getBalance(auditor_relay);

        let perpetrator_relay = accounts[5]
        // let perpetrator_stake = await rhub.stakes(perpetrator_relay);

        let perpetrator_priv_key = Buffer.from("395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd", "hex");
        // getTransactionCount is, by definition, account's nonce+1
        let reused_nonce = web3.eth.getTransactionCount(perpetrator_relay)

        // Make sure the transaction with that nonce was mined
        let result = await sr.emitMessage("hello world", { from: perpetrator_relay })
        var log = result.logs[0];
        assert.equal("SampleRecipientEmitted", log.event);

        // Create another tx with the same nonce
        let data2 = rhub.contract.methods.relay(1, 1, 1, 1, 1, 1, 1, 1).encodeABI()
        let transaction2 = new ethJsTx({
            nonce: reused_nonce - 1,
            gasPrice: 2,
            gasLimit: 200000,
            to: sr.address,
            value: 0,
            data: data2
        })
        transaction2.sign(perpetrator_priv_key)
        let rawTx = "0x" + transaction2.serialize().toString('hex')

        let tbk = new RelayClient(web3, { relayUrl: localhostOne });
        await tbk.auditTransaction(rawTx, [localhostOne]);
        // let the auditor do the job
        // testutils.sleep(10)


        let perpetrator_new_stake = await rhub.stakes(perpetrator_relay);

        assert.equal(0, perpetrator_new_stake[0].toNumber())
        // TODO: validate reward distributed fairly

    });

    function timeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    it("should fallback to other relays if the preferred one does not respond correctly", async function () {
        let rc = new RelayClient(web3)
        let orig_httpSend = rc.httpSend
        let httpSend = {
            send: function (url, jsonRequestData, callback) {
                if (!url.includes("relay")) {
                    orig_httpSend(url, jsonRequestData, callback)
                    return
                }
                if (counter == 0) {
                    counter++
                    setTimeout(callback(new Error("Test error"), null), 100)
                }
                else if (counter == 1) {
                    counter++
                    setTimeout(callback(null, JSON.stringify({})), 100)
                }
                else {
                    let callback_wrap = function (e, r) {
                        assert.equal(null, e)
                        assert.equal(true, r.input.includes(message_hex))
                        callback(e, r)
                    }
                    orig_httpSend.send(url, jsonRequestData, callback_wrap)
                }
            }
        }
        let mockServerHelper = {
            getRelaysAdded: async function () {
                await timeout(200)
                return filteredRelays
            },
            newActiveRelayPinger: function () {
                return {
                    nextRelay: async function () {
                        await timeout(200)
                        return filteredRelays[counter]
                    },
                }
            },
            setHub: function(){}
        }
        let tbk = new RelayClient(web3, { serverHelper: mockServerHelper });
        tbk.httpSend = httpSend
        let res = await request(localhostOne+'/getaddr')
        let relayServerAddress = JSON.parse(res.body).RelayServerAddress
        let filteredRelays = [
            { relayUrl: "localhost1", RelayServerAddress: "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1" },
            { relayUrl: "localhost2", RelayServerAddress: "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1" },
            { relayUrl: localhostOne, RelayServerAddress: relayServerAddress }
        ]

        var counter = 0

        let message = "hello world"
        let message_hex = "0b68656c6c6f20776f726c64"
        let encoded = sr.contract.methods.emitMessage(message).encodeABI()

        let options = {
            from: gasLess,
            to: sr.address,
            txfee: 12,
            gas_limit: 1000000
        }

        let validTransaction = await tbk.relayTransaction(encoded, options);

        // RelayClient did retry for 2 times
        assert.equal(2, counter)

        // The transaction was checked by internal logic of RelayClient (tested elsewhere) and deemed valid
        assert.equal(32, validTransaction.hash(true).length)

    })

    it("should create a new ephemeral keypair", async function(){
        let keypair = RelayClient.newEphemeralKeypair()
        let address = "0x" + ethUtils.privateToAddress(keypair.privateKey).toString('hex')
        assert.equal(address, keypair.address)
    })

    it("should use a given ephemeral key for signing", async function(){
        let rc = new RelayClient(web3)
        let ephemeralKeypair = RelayClient.newEphemeralKeypair()
        let fromAddr = ephemeralKeypair.address
        rc.useKeypairForSigning(ephemeralKeypair)
        var did_assert = false
        rc.sendViaRelay = function(relayUrl, signature, from, to, encodedFunction, gasprice, gaslimit, relayFee, nonce, relayHubAddress, relayAddress){
            let message = utils.getTransactionHash(
                from,
                to,
                encodedFunction,
                relayFee,
                gasprice,
                gaslimit,
                nonce,
                relayHubAddress,
                relayAddress);
            let addr = utils.getEcRecoverMeta(message, signature)
            assert.equal(ephemeralKeypair.address, addr)
            did_assert = true
        }
        let encoded = sr.contract.methods.emitMessage("hello world").encodeABI()
        let to = sr.address;
        let options = {
            from: fromAddr,
            to: to,
            txfee: 12,
            gas_limit: 1000000
        }

        await rc.relayTransaction(encoded, options)
        assert.equal(true, did_assert)
    })

    it("should send relay balance to owner after removed", async function () {

        let response = await request(localhostOne+'/getaddr');
        let relayServerAddress = JSON.parse(response.body).RelayServerAddress;
        let beforeOwnerBalance = await web3.eth.getBalance(relayOwner);
        let res = await rhub.remove_relay_by_owner(relayServerAddress, {from:relayOwner});
        assert.equal("RelayRemoved", res.logs[0].event);
        assert.equal(relayServerAddress.toLowerCase(), res.logs[0].args.relay.toLowerCase());

        let i = 0;
        let relayBalance = await web3.eth.getBalance(relayServerAddress);
        while (relayBalance != 0 && i < 20) {
            await testutils.sleep(200);
            relayBalance = await web3.eth.getBalance(relayServerAddress);
            i++
        }
        assert.equal(0,relayBalance)
        let afterOwnerBalance = await web3.eth.getBalance(relayOwner);
        assert.equal(true,parseInt(afterOwnerBalance)  > parseInt(beforeOwnerBalance))

    });

});
