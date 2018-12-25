var logreq = process.env.httpsendlog
var unique_id = 1

class HttpWrapper {

    constructor(web3) {
        this.web3 = web3
    }

    send(url, jsonRequestData, callback) {

        jsonRequestData = jsonRequestData || {}
        let localid = unique_id++
        if (logreq) {
            console.log("sending request:", localid, url, JSON.stringify(jsonRequestData).slice(0, 80))
        }

        let callback1 = function (e, r) {
            if (e && ("" + e).indexOf("Invalid JSON RPC response") >= 0) {
                e = { error: "invalid-json" }
            }
            if ( !e && r && r.error ) {
                e=r; r=null
            }
            if (logreq) {
                console.log("got response:", localid, JSON.stringify(r).slice(0, 80), "err=", JSON.stringify(e).slice(0, 80))
            }
            callback(e, r)
        }
        new this.web3.providers.HttpProvider(url).sendAsync(jsonRequestData, callback1);
    }

    sendPromise(url, jsonRequestData) {
        let self=this
        return new Promise((resolve,reject)=>{
            self.send(url,jsonRequestData, (e,r)=>{
                if (e) return reject(e)
                return resolve(r)
            })
        })
    }
}

module.exports = HttpWrapper