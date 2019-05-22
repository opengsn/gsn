/* global web3 */
const utils = require('./utils')
const promisify = utils.promisify
const IRelayHub = require('../relayclient/IRelayHub')

const RelayHub = web3.eth.contract(IRelayHub)
const networkVersions = { 1: "Mainnet", 42: "Kovan", 3: "Ropsten", 4: "Rinkeby", 100: "xdai mainnet", 1337 : "Local-geth" }

class RelayManager {

    constructor() {
        utils.checkNetwork(web3)
    }

    log() {
        utils.log(Array.prototype.slice.call(arguments).join(" "))
    }

    async getHub(hubaddr) {

        return RelayHub.at(hubaddr)
    }

    saveForm(form) {
        utils.saveForm(form, 'relaymanager')
    }

    loadForm(form) {
        utils.loadForm(form, 'relaymanager')
    }

    async saveHubAndOwner(hubaddr, owneracct) {

        let node = await promisify(web3.version.getNode)();
        let ver = web3.version.network;
        this.log( "network node: ", node , "version: <b>", networkVersions[ver] || ver, "</b>" )

        if ( !web3.eth.accounts || ! web3.eth.accounts.length ) {
            this.log( "<b>No accounts - login into metamask</b>")
        }
        
        this.owner = owneracct
        this.hub = await this.getHub(hubaddr)

        this.log("= Hub address = ", this.hub.address, "owner=", this.owner)
    }

    async checkRelay(relayurl, newBalance, newStake, newDelay) {
        // this.log( "checkRelay: url="+relayurl, 'bal='+newBalance, 'stake='+newStake, 'del='+newDelay)
        let httpget
        try {
            httpget = await utils.httpreq(relayurl.replace(/\/?\s*$/, "/getaddr"));
        } catch (e) {
            this.log("failed to connect to: " + relayurl + ": " + JSON.stringify(e))
            return
        }
        let resp = JSON.parse(httpget.response)
        let relayaddr = resp.RelayServerAddress

        console.log("relay addr=", relayaddr, "ready=", resp.Ready, "hub=", this.hub.address)

        let currentOwner = await promisify(this.hub.ownerOf)(relayaddr)
        if (currentOwner == '0x') {
            this.log("unable to check relay - check if hub is deployed at that address")
            return
        }

        let owner = web3.eth.accounts[this.owner||0]

        if (currentOwner == '0x0000000000000000000000000000000000000000') {
            this.log("Relay not owned: waiting for owner")
        } else if (currentOwner.toLowerCase() == owner.toLowerCase()) {
            this.log("Relay ready")
        } else {
            this.log("NOT OUR RELAY: owned by: " + currentOwner)
        }

        let balance = (await promisify(web3.eth.getBalance)(relayaddr)) / 1e18
        this.log("current balance=", balance)

        let stake = (await promisify(this.hub.stakeOf)(relayaddr)) / 1e18
        this.log("current stake=", stake)

        if (newStake) {
            let diffStake = newStake - stake
            if (diffStake > 0) {

                let delayUnit = (newDelay || "30s").match(/^([\d.]+)\s*([smhd])/)
                if (!delayUnit)
                    return this.log("invalid Stake time: must be {number} {sec|min|hour|day}")

                let units = {'s': 1, 'm': 60, 'h': 3600, 'd': 3600 * 24}
                //convert "1.5m" into 90
                let delay = delayUnit[1] * units[delayUnit[2]]

                await promisify(this.hub.stake)(relayaddr, delay, {from: owner, value: diffStake * 1e18})
                this.log("staked")
            } else {
                this.log("Stake unmodified")
            }
        }
        if (newBalance) {
            let diffBalance = newBalance - balance

            //don't refill until at least half of the target balance got used..
            if (diffBalance / newBalance > 0.5) {
                await promisify(web3.eth.sendTransaction)({from: owner, to: relayaddr, value: diffBalance * 1e18})
                balance = await promisify(web3.eth.getBalance)(relayaddr)
                this.log("added balance")
            } else {
                this.log("Balance unmodified")
            }
        }
    }
}

module.exports = RelayManager