/* global web3 */

const child_process = require('child_process')

module.exports = {

    //start a background relay process.
    // rhub - relay hub contract
    //options:
    //  verbose: enable background process logging.
    //  stake, delay, txfee, url, relayOwner: parameters to pass to register_new_relay, to stake and register it.
    //  
    startRelay: async function (rhub, options) {
        server = __dirname + "/../build/server/bin/RelayHttpServer"

        options = options || {}
        let args = []
        if (rhub && options.stake) {
            await this.register_new_relay(rhub, options.stake, options.delay || 3600, options.txfee || 12, options.url || "http://asd.asd.asd", options.relayOwner)
            args = ["-RelayHubAddress", rhub.address]
        }
        args.push( "-Workdir", "./build/server" )

        let proc = child_process.spawn(server, args)

        if ( options.verbose )
            relaylog = (msg)=> msg.split("\n").forEach(line=>console.log("relay-"+proc.pid+"> "+line))
        else
            relaylog=function(){}
        relaylog( "server started")

        return new Promise((resolve, reject) => {

            let lastresponse
            let listener = data => {
                str = data.toString().replace(/\s+$/, "")
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

    },

    stopRelay: function (proc) {
        proc && proc.kill()
    },


    register_new_relay: async function (relayHub, stake, delay, txFee, url, account) {
        await relayHub.stake(account, delay, {from: account, value: stake})
        return await relayHub.register_relay(account, txFee, url, 0, {from: account})
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
