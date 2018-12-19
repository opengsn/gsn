/* global web3 */
module.exports = {

    register_new_relay: async function (relayHub, stake, delay, txFee, url, account) {
        await relayHub.stake(account, delay, {from: account, value: stake})
        return await relayHub.register_relay(account, txFee, url, 0, {from: account})
    },

    increaseTime: function (time) {
        web3.currentProvider.sendAsync({
            jsonrpc: '2.0',
            method: 'evm_increaseTime',
            params: [time],
            id: new Date().getSeconds()
        }, (err) => {
            if (!err) {
                web3.currentProvider.send({
                    jsonrpc: '2.0',
                    method: 'evm_mine',
                    params: [],
                    id: new Date().getSeconds()
                });
            }
        });
    },
    postRelayHubAddress: function(relayHubAddress, relayUrl) {
        return new Promise(function (resolve, reject) {
            let callback = function (error, response) {
                if (error) {
                    reject(error);
                    return
                }
                resolve(response);
            }
            new web3.providers.HttpProvider(relayUrl + "/setRelayHub").sendAsync({ relayHubAddress: relayHubAddress }, callback);
        });
    }
}
