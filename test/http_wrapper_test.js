/* global describe web3 require assert it */
const HttpWrapper = require('../src/js/relayclient/HttpWrapper')

const Web3 = require('web3')

describe("HttpWrapper", () => {
    it("connect to node, get version", async () => {
        let http = new HttpWrapper();
        let res = await new Promise((resolve) => {
            let url = web3.currentProvider.host

            http.send(url, {jsonrpc: "2.0", method: "net_version", id:123}, (e, r) => {
                if (e) resolve( "err: "+JSON.stringify(e))
                resolve(r)
            })
        })

        assert.equal( 123, res.id, JSON.stringify(res) ) //just verify its a valid response
    })
    
    it("should fail on connection refused", async () => {
        let http = new HttpWrapper();
        let res = await new Promise((resolve) => {
            http.send("http://localhost:44321", {jsonrpc: "2.0", method: "net_version", id:123}, (e, r) => {
                if (e) resolve( "err: "+JSON.stringify(e))
                resolve(r)
            })
        })
        assert.equal( "err: {\"error\":\"connect ECONNREFUSED 127.0.0.1:44321\"}", res)
    })
})