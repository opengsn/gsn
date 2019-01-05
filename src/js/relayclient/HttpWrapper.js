var logreq = process.env.httpsendlog
var unique_id = 1

class HttpWrapper {

    constructor(web3, timeout) {
        this.web3 = web3
        this.timeout = timeout || 5000
    }

    send(url, jsonRequestData, callback) {

        jsonRequestData = jsonRequestData || {}
        let localid = unique_id++
        if (logreq) {
            console.log("sending request:", localid, url, JSON.stringify(jsonRequestData).slice(0, 80))
        }

        let req = { done:false }
        let callback1 = function (e, r) {
            if ( this.done ) {
                console.log("already done")
                return
            }
            clearTimeout( this.timeoutId )
            this.done=true

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
        }.bind(req)

        req.timeoutId = setTimeout(() => { callback1("timed-out: "+url,null) }, this.timeout)

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