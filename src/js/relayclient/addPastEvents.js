//add getPastEvents to a contract
module.exports = addPastEvents

const AllSolidityEvents = require('web3/lib/web3/allevents');
const web3utils = require('web3/lib/utils/utils')
const sha3 = require('web3/lib/utils/sha3')

function addPastEvents(contract) {
    //either web3>1.0, or already hooked.
    if (contract.getPastEvents)
        return
    if (!contract.abi)
        throw new Error("not a valid contract to hook" + contract)

    contract.getPastEvents = getPastEvents.bind(contract)
    contract._allevents = new AllSolidityEvents(contract.web3, contract.abi, contract.address)
}

//get logs matching filter options
// fromBlock: starting block (numeric/earliest/latest)
// toBlock: ending block (numeric/earliest/latest)
// address: limit to logs emitted by specific address
// topics: array of topics. each can be an array by itself, to match multiple values.
//	first item is special: its the NAME(s) of the event. if multiple signatures found for a given name, all are included
// blockhash: only events from this block. ignore fromBlock/toBlock numbers
function getPastEvents(options, cb) {

    var self = this

    function blockNum(s) {
        if (s == null || s == undefined)
            return undefined
        if (s == "latest" || s == "earliest" || s == "pending")
            return s
        return "0x" + parseInt(s).toString(16)
    }

    options = options || {}
    let getlogsOptions = {
        fromBlock: blockNum(options.fromBlock),
        toBlock: blockNum(options.toBlock),
        address: options.address,
        topics: options.topics,
        blockhash: options.blockhash
    }

    let abi = self.abi
    if (abi.buffer) {
        //not sure why its a Buffer and not object. reconstruct into json objects
        abi = JSON.parse(abi.toString())
    }

    if (getlogsOptions.topics && getlogsOptions.topics.length >= 1) {

        let names = getlogsOptions.topics[0]
        if (typeof names == 'string') names = [names]
        let eventtopics = abi.filter(e => e.type == 'event' && names.includes(e.name))
            .map(e => "0x" + sha3(web3utils.transformToFullName(e)))

        if (eventtopics.length == 0)
            throw new Error("Unknown event topic: " + names + " in " + this._eventTopics)
        getlogsOptions.topics[0] = eventtopics
    }

    let payload = {jsonRpc: "2.0", id: new Date().getTime(), method: 'eth_getLogs', params: [getlogsOptions]}

    let _allevents = new AllSolidityEvents(self.web3, abi, self.address)

    let logmapper = (logentry) => {
        let res = _allevents.decode(logentry)
        return res
    }
    let provider = this.currentProvider || this.eth._requestManager.provider
    if (cb)
        return provider.sendAsync(payload, (err, res) => cb(err, res.result.map(logmapper)))
    else
        return new Promise((resolve, reject) => {
            provider.sendAsync(payload, (err, res) => {
                if (err) return reject(err)
                if (!res.result) reject(res)
                return resolve(res.result.map(logmapper))
            })
        })
}
