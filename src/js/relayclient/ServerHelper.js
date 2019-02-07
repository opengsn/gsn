

class ActiveRelayPinger {

    // TODO: 'httpSend' should be on a network layer
    constructor(filteredRelays, httpSend, gasPrice) {
        this.remainingRelays = filteredRelays.slice()
        this.httpSend = httpSend
        this.pingedRelays = 0
        this.relaysCount = filteredRelays.length
        this.gasPrice = gasPrice
    }

    /**
     * Ping those relays that were not returned yet. Remove the retuned relay (first to respond) from {@link remainingRelays}
     * @returns the first relay to respond to a ping message. Note: will never return the same relay twice.
     */
    async nextRelay() {
        if (this.remainingRelays.length === 0) {
            return null
        }

        let firstRelayToRespond
        for ( ;!firstRelayToRespond && this.remainingRelays.length ; ) {
            let bulkSize = Math.min( 3, this.remainingRelays.length)
            try {
                firstRelayToRespond = await this.raceToSuccess(
                    this.remainingRelays
                        .slice(0, bulkSize)
                        .map(relay => this.getRelayAddressPing(relay.relayUrl, this.gasPrice))
                );
            } catch (e) {
                console.log("One batch of relays failed, last error: ", e)
                //none of the first `bulkSize` items matched. remove them, to continue with the next bulk.
                this.remainingRelays = this.remainingRelays.slice(bulkSize)
            }
        }

        this.remainingRelays = this.remainingRelays.filter(a => a.relayUrl !== firstRelayToRespond.relayUrl)
        this.pingedRelays++
        return firstRelayToRespond
    }

    /**
     * @returns JSON response from the relay server, but adds the requested URL to it:
     * { relayUrl: url,
     *   RelayServerAddress: address,
     *   Ready: bool,   //should ignore relays with "false"
     *   MinGasPrice:   //minimum gas requirement by this relay.
     * }
     */
    async getRelayAddressPing(relayUrl, gasPrice) {
        let self = this
        return new Promise(function (resolve, reject) {
            let callback = function (error, body) {
                if (error) {
                    reject(error);
                    return
                }
                if ( !body || !body.Ready || body.MinGasPrice > gasPrice ) {
                    reject("Relay not ready or proposed gas price too low " + JSON.stringify(body))
                    return
                }
                try {
                    body.relayUrl = relayUrl
                    resolve(body);
                }
                catch (err) {
                    reject(err);
                }
            }
            self.httpSend.send(relayUrl + "/getaddr", {}, callback)
        });
    }

    /**
     * From https://stackoverflow.com/a/37235207 (modified to catch exceptions)
     * Resolves once any promise resolves, ignores the rest, ignores rejections
     */
    async raceToSuccess(promises) {
        let numRejected = 0;
        return new Promise(
            (resolve, reject) =>
                promises.forEach(
                    promise =>
                        promise.then((res) => {
                            resolve(res)
                        }).catch(err => {
                            if (++numRejected === promises.length) {
                                reject("No response matched filter from any server: " + err);
                            }
                        })
                )
        );
    }
}

class ServerHelper {
    /**
     *
     * @param {*} minStake
     * @param {*} minDelay
     * @param {*} httpSend
     */
    constructor(minStake, minDelay, httpSend) {
        this.minStake = minStake
        this.minDelay = minDelay
        this.httpSend = httpSend

        this.filteredRelays = []
        this.isInitialized = false
        this.ActiveRelayPinger = ActiveRelayPinger
    }

    /**
     *
     * @param {*} relayHubInstance
     */
    setHub(relayHubInstance) {
        if (this.relayHubInstance !== relayHubInstance){
            this.filteredRelays = []
        }
        this.relayHubInstance = relayHubInstance

        this.relayHubAddress = this.relayHubInstance._address
    }

    async newActiveRelayPinger(fromBlock, gasPrice ) {
        if (typeof this.relayHubInstance === 'undefined') {
            throw new Error("Must call to setHub first!")
        }
        if (this.filteredRelays.length == 0 || this.fromBlock !== fromBlock)
        {
            this.fromBlock = fromBlock
            await this.fetchRelaysAdded()
        }
        return this.createActiveRelayPinger(this.filteredRelays, this.httpSend, gasPrice)
    }

    createActiveRelayPinger(filteredRelays, httpSend, gasPrice) {
        return new ActiveRelayPinger(filteredRelays, httpSend, gasPrice)
    }

    /**
     * Iterates through all RelayAdded and RelayRemoved logs emitted by given hub
     * initializes an array {@link filteredRelays} of relays curently registered on given RelayHub contract
     */
    async fetchRelaysAdded() {
        let activeRelays = {}
        let fromBlock = this.fromBlock || 2;
        let addedAndRemovedEvents = await this.relayHubInstance.getPastEvents("allEvents", { fromBlock: fromBlock,
            // topics: [["RelayAdded", "RelayRemoved"]]
        })

        //TODO: better filter RelayAdded, RelayRemoved events: otherwise, we'll be scanning all TransactionRelayed too...
        //since RelayAdded can't be called after RelayRemoved, its OK to scan first for add, and the remove all removed relays.
        for (var index in addedAndRemovedEvents) {
            let event = addedAndRemovedEvents[index]
            if (event.event === "RelayAdded") {
                let args = event.returnValues
                activeRelays[args.relay] = {
                    address: args.relay,
                    relayUrl: args.url,
                    transactionFee: args.transactionFee,
                    stake: args.stake,
                    unstakeDelay: args.unstakeDelay
                }
            } else if (event.event === "RelayRemoved") {
                delete activeRelays[event.returnValues.relay]
            }
        }

        let filteredRelays = Object.values(activeRelays)

        let origRelays = filteredRelays
        if (this.minStake) {
            filteredRelays = filteredRelays.filter(a => a.stake >= this.minStake)
        }

        if (this.minDelay) {
            filteredRelays = filteredRelays.filter(a => a.unstakeDelay >= this.minDelay)
        }

        let size = filteredRelays.length

        if (size == 0) {
            throw new Error("no valid relays. orig relays=" + JSON.stringify(origRelays))
        }

        filteredRelays = filteredRelays.sort((a, b) => {
            return a.txFee - b.txFee
        }).slice(0, size)

        this.filteredRelays = filteredRelays
        this.isInitialized = true
    }
}

module.exports = ServerHelper