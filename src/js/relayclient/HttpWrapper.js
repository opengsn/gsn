const axios = require('axios');
const logreq = process.env.httpsendlog;
const logmaxlen = 120

class HttpWrapper {

    constructor(opts) {
        this.provider = axios.create(Object.assign({
            headers: { 'Content-Type': 'application/json' }
        }, opts));

        if (logreq) {
            this.provider.interceptors.response.use(function (response) {
                console.log("got response:", response.config.url, JSON.stringify(response.data).slice(0, logmaxlen))
                return response;
            }, function (error) {
                const errData = error.response ? error.response.data : { error: error.message };
                const errStr = ((typeof errData === 'string') ? errData : JSON.stringify(errData)).slice(0, logmaxlen);
                const errUrl = error.response ? error.response.config.url : error.address;
                console.log("got response:", errUrl, "err=", errStr);
                return Promise.reject(error);
            });
        }
    }

    send(url, jsonRequestData, callback) {
        this.sendPromise(url, jsonRequestData || {})
            .then(data => callback(null, data))
            .catch(err => callback(err, null));
    }

    sendPromise(url, jsonRequestData) {
        if (logreq) {
            console.log("sending request:", url, JSON.stringify(jsonRequestData || {}).slice(0, logmaxlen))
        }
        return this.provider.post(url, jsonRequestData)
            .then(res => res.data)
            .catch(err => Promise.reject(err.response ? err.response.data : { error: err.message }));
    }
}

module.exports = HttpWrapper