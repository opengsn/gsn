const Web3 = require( 'web3')
const RelayClient = require('./RelayClient')

class RelayProvider {

    /**
     * create a proxy provider, to relay transaction
     * @param origProvider - the underlying web3 provider
     * @param relayOptions:
     *      disableRelay - true to bypass the relay, and call directly the origProvider.
     *      skipSenders - hash of "from" addresses that should bypass the relay ( e.g. skipSenders={myDirectAddress:true} )
     *      other options of RelayClient..
     */
    constructor(origProvider, relayOptions) {
        relayOptions = relayOptions || {}
        relayOptions.isRelayEnabled = true
        this.relayOptions = relayOptions
        this.origProvider = origProvider

        if ( origProvider.origProvider) {
            //we're 2nd-level wrapper.. disable previous one.
            console.log( "wrapping RelayProvider with another.. skipping previous one.")
            origProvider = origProvider.origProvider
        }
        this.origProviderSend = ( this.origProvider['sendAsync'] || this.origProvider['send'] ) .bind(this.origProvider)
        this.relayClient = new RelayClient(new Web3(origProvider), relayOptions)
    }

    enable(isRelayEnabled) {
        this.relayOptions.isRelayEnabled = isRelayEnabled
    }

    send(payload, callback) {

        if (!this.skipRelay(payload)) {
            if (payload.method == 'eth_sendTransaction') {
                if (this.relayOptions.verbose)
                    console.log("calling sendAsync" + JSON.stringify(payload))
                this.relayClient.runRelay(payload, callback)
                return

            } else if (payload.method == 'eth_getTransactionReceipt') {
                if (this.relayOptions.verbose)
                    console.log("calling sendAsync" + JSON.stringify(payload))
                this.origProviderSend(payload, (e, r) => {
                    if (e) callback(e)
                    else
                        callback(null, this.relayClient.fixTransactionReceiptResp(r))
                })
                return
            }
        }

        this.origProviderSend(payload, function (error, result) {
            callback(error, result);
        });
    }

    sendAsync(payload, callback) {
        return this.send(payload, callback)
    }

    //hook method: skip relay if the "from" address appears in optins.skipSenders
    skipRelay(payload) {
        return !this.relayOptions.isRelayEnabled ||
            this.relayOptions.skipSenders && this.relayOptions.skipSenders[payload.params.from]
    }
}

module.exports = RelayProvider