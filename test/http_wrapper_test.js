/* global describe web3 require it */
const HttpWrapper = require('../src/js/relayclient/HttpWrapper')
const assert = require('chai').use(require('chai-as-promised')).assert;

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

    it("should timeout after specified time", async () => {
        // this test abuses the fact that a local ganache is slow, and should take over 1ms to respond even if it's local
        const http = new HttpWrapper({ timeout: 1 });
        let error = null;
        await assert.isRejected(
            http.sendPromise(web3.currentProvider.host, {jsonrpc: "2.0", method: "net_version", id:123})
                .catch(err => {
                    error = err;
                    return Promise.reject(err);
                })
        );
        assert.deepEqual(error, { error: 'timeout of 1ms exceeded' });
    })
})