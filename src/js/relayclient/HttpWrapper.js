var logreq = false
var unique_id = 1

class HttpWrapper {

    constructor(web3) {
        this.web3 = web3
    }

    send(url, jsonRequestData, callback) {

        let localid = unique_id++
        if (logreq) {
            console.log("sending request:", localid, url, JSON.stringify(jsonRequestData).slice(0, 40))
        }

        let callback1 = function (e, r) {
            if (e && ("" + e).indexOf("Invalid JSON RPC response") >= 0) {
                e = { error: "invalid-json" }
            }
            if (logreq) {
                console.log("got response:", localid, JSON.stringify(r).slice(0, 40), "err=", JSON.stringify(e).slice(0, 40))
            }
            callback(e, r)
        }
        new this.web3.providers.HttpProvider(url).sendAsync(jsonRequestData, callback1);
    }
}

module.exports = HttpWrapper