var logreq = process.env.httpsendlog
var unique_id = 1

class HttpWrapper {

    constructor(web3) {
        this.HttpProvider = web3.providers.HttpProvider
    }

    send(url, jsonRequestData, callback) {
        let maxlen = 120

        jsonRequestData = jsonRequestData || {}
        let localid = unique_id++
        if (logreq) {
            console.log("sending request:", localid, url, JSON.stringify(jsonRequestData).slice(0, maxlen))
        }

        let callback1 = function (e, r) {
            if (e && ("" + e).indexOf("Invalid JSON RPC response") >= 0) {
                e = {error: "invalid-json"}
            }
            if (("" + r).indexOf("\"error\"") >= 0) {
                e = r;
                r = null;
            }
            if (!e && r && r.error) {
                e = r;
                r = null
            }
            if (logreq) {
                console.log("got response:", localid, JSON.stringify(r).slice(0, maxlen), "err=", JSON.stringify(e).slice(0, maxlen))
            }
            callback(e, r)
        }

        let provider = new this.HttpProvider(url)
        let send = provider['sendAsync'] || provider['send']
        send.bind(provider)(jsonRequestData, callback1);
    }

    sendPromise(url, jsonRequestData) {
        let self = this
        return new Promise((resolve, reject) => {
            self.send(url, jsonRequestData, (e, r) => {
                if (e) return reject(e)
                return resolve(r)
            })
        })
    }
}

module.exports = HttpWrapper