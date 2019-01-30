const ethUtils = require('ethereumjs-util');
const EthCrypto = require('eth-crypto');
const web3Utils = require('web3-utils')
const relay_prefix = "rlx:"

const zeroAddr = "0".repeat(40)

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
    let hex = removeHexPrefix(web3Utils.toHex(bytes))
    if (hex.length % 2 != 0) {
        hex = "0" + hex;
    }
    return hex
}

module.exports = {
    register_new_relay: async function (relayHub, stake, delay, txFee, url, account) {
        await relayHub.stake(account, delay, {from: account, value: stake})
        return await relayHub.register_relay(txFee, url, zeroAddr, {from: account})
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
        return web3Utils.sha3('0x'+dataToHash )
    },

    getTransactionSignature: async function (web3, account, hash) {

        let sig_
        try {


            sig_ = await new Promise((resolve, reject) => {
                try {
                    web3.eth.personal.sign(hash, account, (err, res) => {
                        if (err) reject(err)
                        else resolve(res)
                    })
                } catch (e) {
                    reject(e)
                }
            })

        } catch (e) {

            sig_ = await new Promise((resolve, reject) => {
                web3.eth.sign(hash, account, (err, res) => {
                    if (err) reject(err)
                    else resolve(res)
                })
            })
        }

        let signature = ethUtils.fromRpcSig(sig_);


        let sig = web3Utils.toHex(signature.v) + removeHexPrefix(web3Utils.bytesToHex(signature.r)) + removeHexPrefix(web3Utils.bytesToHex(signature.s));

        return sig;
    },

    getTransactionSignatureWithKey: function(privKey, hash) {
        let msg = Buffer.concat([Buffer.from("\x19Ethereum Signed Message:\n32"), Buffer.from(removeHexPrefix(hash), "hex")])
        let signed = web3Utils.sha3("0x"+msg.toString('hex') );
        let keyHex = "0x" + Buffer.from(privKey).toString('hex')
        const sig_ = EthCrypto.sign(keyHex, signed)
        let signature = ethUtils.fromRpcSig(sig_);
        let sig = web3Utils.toHex(signature.v) + removeHexPrefix(web3Utils.bytesToHex(signature.r)) + removeHexPrefix(web3Utils.bytesToHex(signature.s));
        return sig
    },

    getEcRecoverMeta: function(message, signature) {
        if (typeof signature === 'string'){
            let v = this.parseHexString(signature.substr(2,2))
            let r = this.parseHexString(signature.substr(4, 65))
            let s = this.parseHexString(signature.substr(68, 65))
            signature = {
                v: v,
                r: r,
                s: s
            }
        }
        let msg = Buffer.concat([Buffer.from("\x19Ethereum Signed Message:\n32"), Buffer.from(removeHexPrefix(message), "hex")]);
        let signed = web3Utils.sha3("0x"+msg.toString('hex'));
        let buf_signed = Buffer.from(removeHexPrefix(signed), "hex");
        let signer = ethUtils.bufferToHex(ethUtils.pubToAddress(ethUtils.ecrecover(buf_signed, signature.v, signature.r, signature.s)));
        return signer;
    },

    parseHexString: function(str) {
        var result = [];
        while (str.length >= 2) {
            result.push(parseInt(str.substring(0, 2), 16));
    
            str = str.substring(2, str.length);
        }
    
        return result;
    },
    removeHexPrefix: removeHexPrefix,
    padTo64: padTo64
}
