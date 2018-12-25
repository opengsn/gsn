 /* global web3 artifacts */

const child_process = require('child_process')
const util = require("util")
const HttpWrapper = require( "../src/js/relayclient/HttpWrapper")
const localhostOne = "http://localhost:8090"
const RelayHub = artifacts.require("RelayHub");
const addPastEvents = require( '../src/js/relayclient/addPastEvents' )
addPastEvents(RelayHub)

module.exports = {

    //start a background relay process.
    // rhub - relay hub contract
    //options:
    //  verbose: enable background process logging.
    //  stake, delay, txfee, url, relayOwner: parameters to pass to register_new_relay, to stake and register it.
    //  
    startRelay: async function (rhub, options) {
        let server = __dirname + "/../build/server/bin/RelayHttpServer"

        options = options || {}
        let args = []
        args.push( "-Workdir", "./build/server" )
        if ( rhub ) {
            args = ["-RelayHubAddress", rhub.address]
        }

        let proc = child_process.spawn(server, args)

        let relaylog=function(){}
        if ( process.env.relaylog )
            relaylog = (msg)=> msg.split("\n").forEach(line=>console.log("relay-"+proc.pid+"> "+line))

        relaylog( "server started")

        await new Promise((resolve, reject) => {

            let lastresponse
            let listener = data => {
                let str = data.toString().replace(/\s+$/, "")
                lastresponse = str
                relaylog(str)
                if (str.indexOf("Listening on port") >= 0) {
                    proc.alreadystarted = 1
                    resolve(proc)
                }
            };
            proc.stdout.on('data', listener)
            proc.stderr.on('data', listener)
            let doaListener = (code) => {
                if (!this.alreadystarted) {
                    relaylog("died before init code="+code)
                    reject(lastresponse)
                }
            };
            proc.on('exit', doaListener.bind(proc))
        })

        http = new HttpWrapper(web3)
        let res = await http.sendPromise(localhostOne+'/getaddr')
        let relayServerAddress = res.RelayServerAddress
        console.log("Relay Server Address",relayServerAddress)
        await web3.eth.sendTransaction({to:relayServerAddress, from:web3.eth.accounts[0], value:web3.toWei("2", "ether")})
        await rhub.stake(relayServerAddress, options.delay || 3600, {from: options.relayOwner, value: options.stake})

        res=""
        let count = 20
        while (count-- > 0) {
            res = await http.sendPromise(localhostOne+'/getaddr')
            if ( res.Ready ) break;
            await module.exports.sleep(500)
        }
        assert.ok(res.Ready, "Timed out waiting for relay to get staked and registered")

        return proc

    },
    sleep: function (ms) {
     return new Promise(resolve => setTimeout(resolve, ms));
    },

    stopRelay: function (proc) {
        proc && proc.kill()
    },


    register_new_relay: async function (relayHub, stake, delay, txFee, url, account) {
        await relayHub.stake(account, delay, {from: account, value: stake})
        return await relayHub.register_relay(txFee, url, 0, {from: account})
    },

    increaseTime: function (time) {
        web3.currentProvider.sendAsync({
            jsonrpc: '2.0',
            method: 'evm_increaseTime',
            params: [time],
            id: new Date().getSeconds()
        }, (err) => {
            if (!err) {
                module.exports.evmMine()
            }
        });
    },
    evmMine: function () {
        web3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_mine',
            params: [],
            id: new Date().getSeconds()
        });
    },

    postRelayHubAddress: function (relayHubAddress, relayUrl) {
        return new Promise(function (resolve, reject) {
            let callback = function (error, response) {
                if (error) {
                    reject(error);
                    return
                }
                resolve(response);
            }
            new web3.providers.HttpProvider(relayUrl + "/setRelayHub").sendAsync({relayHubAddress: relayHubAddress}, callback);
        })
    }
}
