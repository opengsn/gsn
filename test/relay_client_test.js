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
const increaseTime = testutils.increaseTime;
const assertErrorMessageCorrect = testutils.assertErrorMessageCorrect;

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
    let relayAccount;
    let dayInSec = 24 * 60 * 60;
    let weekInSec = dayInSec * 7;
    let one_ether = 1e18;
    before(async function () {
        const gasPricePercent = 20
        gasPrice = ( await web3.eth.getGasPrice() ) * (100  + gasPricePercent)/100

        rhub = await RelayHub.deployed()
        sr = await SampleRecipient.deployed()

        await sr.deposit({value: web3.utils.toWei('1', 'ether')});
        // let known_deposit = await rhub.balances(sr.address);
        // assert.ok(known_deposit>= deposit, "deposited "+deposit+" but found only "+known_deposit);
        gasLess = await web3.eth.personal.newAccount("password")
        console.log("gasLess = " + gasLess);
        console.log("starting relay")

        relayproc = await testutils.startRelay(rhub, {
            stake: 1e18, delay: 3600 * 24 * 7, txfee: 12, url: "asd", relayOwner: relayOwner, EthereumNodeUrl: web3.currentProvider.host,GasPricePercent:gasPricePercent})

        relayAccount = await web3.eth.personal.newAccount("asdgasfd2r43")
        await web3.eth.personal.unlockAccount(relayAccount, "asdgasfd2r43")
        await web3.eth.sendTransaction({
            from: accounts[0],
            to: relayAccount,
            value: one_ether});
        await register_new_relay(rhub, one_ether, weekInSec, 120, "hello", relayAccount, relayOwner);

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

    var func = async function ({from/*, to, tx, txfee, gasPrice, gasLimit, nonce, relay_hub_address, relay_address*/}) {
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

    [false,true].forEach( validateCanRelay =>
    it("should consider a transaction with an incorrect approval as invalid " + (validateCanRelay ? "":"(without client calling canRelay)" ), async function () {
        const expected_error = 13
        let encoded = sr.contract.methods.emitMessage("hello world").encodeABI()
        let to = sr.address;
        let options = {
            approveFunction: ()=>{ return "aaaa6ad4b4fab03bb2feaea2d54c690206e40036e4baa930760e72479da0cc5575779f9db9ef801e144b5e6af48542107f2f094649334b030e2bb44f054429b451"},
            from: gasLess,
            to: to,
            txfee: 12,
            gas_limit: 1000000
        }
        //only add parameter if false (true should be the default..)
        if ( !validateCanRelay )
            options.validateCanRelay = false

        let relay_client_config = {
            relayUrl: localhostOne,
            relayAddress: relayAddress,
            allowed_relay_nonce_gap: 0,
            verbose: process.env.DEBUG
        }

        let tbk = new RelayClient(web3, relay_client_config);
        try {
            await tbk.relayTransaction(encoded, options);
            assert.fail()
        }
        catch (error){
            if ( validateCanRelay ) {
                //error checked by relayTransaction:
                assert.equal("Error: canRelay failed: 13: test: not approved", error.toString())
            } else {
                //error checked by relay:
                assert.equal(true, error.otherErrors[0].includes("canRelay() view function returned error code=" + expected_error))
            }
        }
    }));

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

    it("should revert calls to preRelayedCall from non RelayHub address", async function () {
        try {
            await sr.preRelayedCall(Buffer.from(""),{from:accounts[1]});
            assert.fail();
        } catch (error) {
            assertErrorMessageCorrect(error, "Function can only be called by RelayHub")
        }
    });

    it("should revert calls to postRelayedCall from non RelayHub address", async function () {
        try {
            await sr.postRelayedCall(Buffer.from(""),true,0,Buffer.from(""));
            assert.fail();
        } catch (error) {
            assertErrorMessageCorrect(error, "Function can only be called by RelayHub")
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
        assert.equal(res.logs[1].event, "SampleRecipientEmitted")
        assert.equal(res.logs[1].args.message, "hello world")
        assert.equal(res.logs[1].args.realSender, gasLess)
        assert.equal(res.logs[1].args.msgSender.toLowerCase(), rhub.address.toLowerCase())
        res = await sr.emitMessage("hello again", { from: accounts[3] })
        assert.equal(res.logs[1].event, "SampleRecipientEmitted")
        assert.equal(res.logs[1].args.message, "hello again")

        assert.equal(res.logs[1].args.realSender, accounts[3])

    })

    it("should relay transparently with long encoded function", async () => {

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

        let res = await sr.emitMessage("hello world".repeat(1000), {from: gasLess})
        assert.equal(res.logs[1].event, "SampleRecipientEmitted")
        assert.equal(res.logs[1].args.message, "hello world".repeat(1000))
        assert.equal(res.logs[1].args.realSender, gasLess)
        assert.equal(res.logs[1].args.msgSender.toLowerCase(), rhub.address.toLowerCase())
        res = await sr.emitMessage("hello again".repeat(1000), { from: accounts[3] })
        assert.equal(res.logs[1].event, "SampleRecipientEmitted")
        assert.equal(res.logs[1].args.message, "hello again".repeat(1000))

        assert.equal(res.logs[1].args.realSender, accounts[3])

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
                        assert.equal(true, r.input && r.input.includes(message_hex))
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
        rc.sendViaRelay = function(relayAddress, from, to, encodedFunction, relayFee, gasprice, gaslimit, nonce, signature, approvalData, relayUrl, relayHubAddress) {
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

    it("should use relay's published transactionFee if none is given in options", async function(){
        let rc = new RelayClient(web3)
        let ephemeralKeypair = RelayClient.newEphemeralKeypair()
        let fromAddr = ephemeralKeypair.address
        rc.useKeypairForSigning(ephemeralKeypair)
        rc.sendViaRelay = function(relayAddress, from, to, encodedFunction, relayFee /*, gasprice, gaslimit, nonce, signature, approvalData, relayUrl, relayHubAddress*/) {
            //mock implementation: only check the received relay fee (checked below in relayTransaction
            throw new Error( "relayFee="+relayFee)
        }

        let encoded = sr.contract.methods.emitMessage("hello world").encodeABI()
        let options = {
            from: fromAddr,
            to: sr.address,
            //explicitly not specifying txfee
            gas_limit: 1000000
        }

        try {
            await rc.relayTransaction(encoded, options)
            assert.ok(false,"didn't reach sendViaRelay")
        } catch ( e) {
            assert.ok(e.otherErrors, e)
            assert.equal( e.otherErrors[0].message, "relayFee=12" );
        }
    })

    it("should add relay to failedRelay dict in case of http timeout", async function(){
        let rc = new RelayClient(web3, {httpTimeout: 100})
        let ephemeralKeypair = RelayClient.newEphemeralKeypair()
        let fromAddr = ephemeralKeypair.address
        rc.useKeypairForSigning(ephemeralKeypair)

        rc.origSendViaRelay = rc.sendViaRelay
        rc.sendViaRelay = function(relayAddress, from, to, encodedFunction, relayFee, gasprice, gaslimit, nonce, signature, approvalData, relayUrl, relayHubAddress){
            return this.origSendViaRelay.bind(this)(
                relayAddress, from, to, encodedFunction, gasprice, gaslimit, relayFee, nonce, signature, approvalData, "http://1.2.3.4:5678",  relayHubAddress);
        }

        let encoded = sr.contract.methods.emitMessage("hello world").encodeABI()
        let to = sr.address;
        let options = {
            from: fromAddr,
            to: to,
            txfee: 12,
            gas_limit: 1000000
        }

        try {
            await rc.relayTransaction(encoded, options)
            assert.fail("relayTransaction should throw..")
        } catch (ignored) {
            assert.isTrue( rc.failedRelays["http://1.2.3.4:5678"] != undefined )
        }
    })


    describe("relay balance management", async function () {
        let relayServerAddress;
        let beforeOwnerBalance;
        it("should NOT send relay balance to owner after removed", async function () {
            let response = await request(localhostOne+'/getaddr');
            relayServerAddress = JSON.parse(response.body).RelayServerAddress;
            beforeOwnerBalance = await web3.eth.getBalance(relayOwner);
            let res = await rhub.removeRelayByOwner(relayServerAddress, {from:relayOwner});
            let etherSpentByTx = res.receipt.gasUsed * (await web3.eth.getGasPrice());
            assert.equal("RelayRemoved", res.logs[0].event);
            assert.equal(relayServerAddress.toLowerCase(), res.logs[0].args.relay.toLowerCase());
            await testutils.sleep(2000);
            let afterOwnerBalance = await web3.eth.getBalance(relayOwner);
            assert.equal(parseInt(afterOwnerBalance) + etherSpentByTx, parseInt(beforeOwnerBalance))

        });

        it("should send relay balance to owner only after unstaked", async function () {
            beforeOwnerBalance = await web3.eth.getBalance(relayOwner);
            let unstakeDelay = (await rhub.getRelay(relayServerAddress)).unstakeDelay;
            increaseTime(unstakeDelay);
            let res = await rhub.unstake(relayServerAddress, {from:relayOwner});
            assert.equal("Unstaked", res.logs[0].event);
            assert.equal(relayServerAddress.toLowerCase(), res.logs[0].args.relay.toLowerCase());

            let i = 0;
            let relayBalance = await web3.eth.getBalance(relayServerAddress);
            while (relayBalance != 0 && i < 10) {
                await testutils.sleep(200);
                relayBalance = await web3.eth.getBalance(relayServerAddress);
                i++
            }
            assert.equal(0,relayBalance)
            let afterOwnerBalance = await web3.eth.getBalance(relayOwner);
            assert.equal(true,parseInt(afterOwnerBalance)  > parseInt(beforeOwnerBalance))

        });
    });

    describe("should handle incorrect relay hub contract in recipient", async function () {
        let sr2;
        before( async function () {
            SampleRecipient.web3.currentProvider.relayOptions.isRelayEnabled = false
            sr2 = await SampleRecipient.new()
            //eslint-disable-next-line
            SampleRecipient.web3.currentProvider.relayOptions.isRelayEnabled = true
        });

        it("should revert on zero hub in recipient contract", async function () {
            try {
                await sr2.emitMessage("hello world", {from: gasLess})
                assert.fail()
            }
            catch (error) {
                assert.equal(true, error.message.includes("The relay hub address is set to zero in recipient at"))
            }
        });

        it("should throw on invalid recipient", async function () {
            let tbk = new RelayClient(web3);
            try {
                await tbk.createRelayHubFromRecipient(gasLess)
                assert.fail()
            }
            catch (error) {
                assert.equal(true, error.message.includes("Could not get relay hub address from recipient at"))
            }
        });

        it("should throw on invalid hub ", async function () {
            let tbk = new RelayClient(web3);
            tbk.createRelayHub = function () {
                return {methods: {
                        version: function () {
                            return {call: function() {throw new Error("NOPE")}}
                        }
                }
                }
            }
            try {
                await tbk.createRelayHubFromRecipient(sr.address)
                assert.fail()
            }
            catch (error) {
                assert.equal(true, error.message.includes("Could not query relay hub version at"))
                assert.equal(true, error.message.includes("NOPE"))
            }
        });

        it("should throw on wrong hub version", async function () {
            let tbk = new RelayClient(web3);
            tbk.createRelayHub = function () {
                return {methods: {
                        version: function () {
                            return {call: function() {return "wrong version"}}
                        }
                    }
                }
            }
            try {
                await tbk.createRelayHubFromRecipient(sr.address)
                assert.fail()
            }
            catch (error) {
                assert.equal(true, error.message.includes("Unsupported relay hub version"))
                assert.equal(true, error.message.includes("wrong version"))
            }
        });

    });

    it("should report canRelayFailed on transactionReceipt", async function () {
        let from = accounts[6];
        let to = sr.address;
        let relay_nonce = 0;
        let message = "hello world";
        let transaction = sr.contract.methods.emitMessage(message).encodeABI();
        let transaction_fee = 10;
        let gas_price = 10;
        let gas_limit = 1000000;
        let gas_limit_any_value = 7000029;
        let tbk = new RelayClient(web3);

        await sr.setBlacklisted(from)
        let digest = await utils.getTransactionHash(from, to, transaction, transaction_fee, gas_price, gas_limit, relay_nonce, rhub.address, relayAccount);
        let sig = await utils.getTransactionSignature(web3, from, digest)
        let res = await rhub.contract.methods.relayCall(from, to, transaction, transaction_fee, gas_price, gas_limit, relay_nonce, sig, '0x').send({
            from: relayAccount,
            gasPrice: gas_price,
            gasLimit: gas_limit_any_value
        });

        let receipt = await web3.eth.getTransactionReceipt(res.transactionHash)
        let canRelay = await rhub.canRelay(relayAccount, from, to, transaction, transaction_fee, gas_price, gas_limit, relay_nonce, sig, "0x");
        assert.equal(11, canRelay.status.valueOf().toString())

        assert.equal(true, receipt.status)
        await tbk.fixTransactionReceiptResp(receipt)
        assert.equal(false, receipt.status)

    });

});
