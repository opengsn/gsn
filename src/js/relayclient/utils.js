/* global web3 */
const ethUtils = require('ethereumjs-util');
const Web3Utils = require('web3-utils');

const relay_prefix = "rlx:"

function toUint256_noPrefix(int) {
    return removeHexPrefix(ethUtils.bufferToHex(ethUtils.setLengthLeft(int, 32)));
}

function removeHexPrefix(hex) {
    return hex.replace(/^0x/, '');
}

const zeroPad = "0000000000000000000000000000000000000000000000000000000000000000"

function padTo64(hex) {
    if (hex.length < 64) {
        hex = (zeroPad + hex).slice(-64);
    }
    return hex;
}

function bytesToHex_noPrefix(bytes) {
    let hex = removeHexPrefix(web3.toHex(bytes))
    if (hex.length % 2 != 0) {
        hex = "0" + hex;
    }
    return hex
}

function getEcRecoverMeta(message, signature) {
    let msg = Buffer.concat([Buffer.from("\x19Ethereum Signed Message:\n32"), Buffer.from(removeHexPrefix(message), "hex")]);
    let signed = web3.sha3(msg.toString('hex'), {encoding: "hex"});
    let buf_signed = Buffer.from(removeHexPrefix(signed), "hex");
    let signer = ethUtils.bufferToHex(ethUtils.pubToAddress(ethUtils.ecrecover(buf_signed, signature.v, signature.r, signature.s)));
    return signer;
}

module.exports = {
    register_new_relay: async function (relayHub, stake, delay, txFee, url, account) {
        await relayHub.stake(account, delay, {from: account, value: stake})
        return await relayHub.register_relay(account, txFee, url, 0, {from: account})
    },

    /**
     * From: https://ethereum.stackexchange.com/a/52782
     */
    waitAllContractEventGet: function (myevent) {
        return new Promise(function (resolve, reject) {
            myevent.get(function (error, logs) {
                if (error !== null) {
                    reject(error);
                } else {
                    resolve(logs);
                }
            });
        });
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

    getTransactionHash: function (from, to, tx, txfee, gas_price, gas_limit, nonce, relay_hub_address, relay_address) {
        let txhstr = bytesToHex_noPrefix(tx)
        let dataToHash =
            Buffer.from(relay_prefix).toString("hex") +
            removeHexPrefix(from)
            + removeHexPrefix(to)
            + txhstr
            + toUint256_noPrefix(parseInt(txfee))
            + toUint256_noPrefix(parseInt(gas_price))
            + toUint256_noPrefix(parseInt(gas_limit))
            + toUint256_noPrefix(parseInt(nonce))
            + removeHexPrefix(relay_hub_address)
            + removeHexPrefix(relay_address)
        return web3.sha3(dataToHash, {encoding: "hex"})
    },

    getTransactionSignature: async function (account, hash) {

        let sig_
        try {


            sig_ = await new Promise((resolve, reject) => {
                try {
                    web3.personal.sign(hash, account, (err, res) => {
                        if (err) reject(err)
                        else resolve(res)
                    })
                } catch (e) {
                    reject(e)
                }
            })

        } catch (e) {

            sig_ = await new Promise((resolve, reject) => {
                web3.eth.sign(account, hash, (err, res) => {
                    if (err) reject(err)
                    else resolve(res)
                })
            })
        }

        let signature = ethUtils.fromRpcSig(sig_);


        let sig = Web3Utils.toHex(signature.v) + removeHexPrefix(Web3Utils.bytesToHex(signature.r)) + removeHexPrefix(Web3Utils.bytesToHex(signature.s));

        return sig;
    },

    getEcRecoverMeta: getEcRecoverMeta,
    removeHexPrefix: removeHexPrefix,
    padTo64: padTo64
}
