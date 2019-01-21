const utils = require('./utils')
const getTransactionSignature = utils.getTransactionSignature;
const getTransactionSignatureWithKey = utils.getTransactionSignatureWithKey;
const parseHexString = utils.parseHexString;
const removeHexPrefix = utils.removeHexPrefix;
const padTo64 = utils.padTo64;

const ServerHelper = require('./ServerHelper');
const HttpWrapper = require('./HttpWrapper');
const ethUtils = require('ethereumjs-util');
const ethWallet = require('ethereumjs-wallet');
const ethJsTx = require('ethereumjs-tx');
const abi_decoder = require('abi-decoder');

const relayHubAbi = require('./RelayHubApi')
const relayRecipientAbi = require('./RelayRecipientApi')

//estimate how many blocks to look back.
// TODO: we need to get a block 24hours ago... need better dynamic estimation
const est_sec_per_block = 12
const est_blocks_per_day = 24*3600/est_sec_per_block

abi_decoder.addABI(relayHubAbi)

//default gas price (unless client specifies one): the web3.eth.gasPrice*(100+GASPRICE_PERCENT)/100
const GASPRICE_PERCENT = 20


/**
 * create a RelayClient library object, to force contracts to go through a relay.
 * @param web3  - the web3 instance to use.
 * @param {object} config options
 *    txfee
 *lookup for relay
 *    minStake - ignore relays with stake below this (wei) value.
 *    minDelay - ignore relays with delay lower this (sec) value
 *    gaspriceFactorPercent - increase (in %) over current gasPrice average. default is 10%.
 *          Note that the resulting gasPrice must be accepted by relay (above its minGasPrice)
 *
 *manual settings: these can be used to override the default setting.
 *    relayUrl, relayAddress - avoid lookup on relayHub for relays, and always use this URL/address
 *    force_gasLimit - force gaslimit, instead of transaction paramter
 *    force_gasPrice - force gasPrice, instread of transaction parameter.
 */
function RelayClient(web3, config) {
    // TODO: require sign() or privKey
    this.config = config || {}
    this.web3 = web3
    this.httpSend = new HttpWrapper(this.web3)

    this.serverHelper = this.config.serverHelper || new ServerHelper(this.config.minStake || 0, this.config.minDelay || 0, this.httpSend)

}

RelayClient.prototype.createRelayRecipient = function(addr) {
    return new this.web3.eth.Contract(relayRecipientAbi, addr)
}

RelayClient.prototype.createRelayHub = function(addr) {
    return new this.web3.eth.Contract(relayHubAbi, addr)
}

/**
 * Decode the signed transaction returned from the Relay Server, compare it to the
 * requested transaction and validate its signature.
 * @returns a signed {@link EthereumTx} instance for broacasting, or null if returned
 * transaction is not valid.
 */
RelayClient.prototype.validateRelayResponse = function (returned_tx, address_relay,
                                                        from, to, transaction_orig, transaction_fee, gas_price, gas_limit, nonce,
                                                        relay_hub_address, relay_address, sig) {

    var tx = new ethJsTx({
        nonce: returned_tx.nonce,
        gasPrice: returned_tx.gasPrice,
        gasLimit: returned_tx.gas,
        to: returned_tx.to,
        value: returned_tx.value,
        data: returned_tx.input,
    });

    let message = tx.hash(false)
    let tx_v = Buffer.from(removeHexPrefix(returned_tx.v), "hex");
    let tx_r = Buffer.from(padTo64(removeHexPrefix(returned_tx.r)), "hex");
    let tx_s = Buffer.from(padTo64(removeHexPrefix(returned_tx.s)), "hex");

    let signer = ethUtils.bufferToHex(ethUtils.pubToAddress(ethUtils.ecrecover(message, tx_v[0], tx_r, tx_s)));
    let request_decoded_params = abi_decoder.decodeMethod(returned_tx.input).params;
    let returned_tx_params_hash = utils.getTransactionHash(
        request_decoded_params[0].value,
        request_decoded_params[1].value,
        request_decoded_params[2].value,
        request_decoded_params[3].value,
        request_decoded_params[4].value,
        request_decoded_params[5].value,
        request_decoded_params[6].value,
        returned_tx.to,
        signer
    )
    let transaction_orig_params_hash = utils.getTransactionHash(
        from, to, transaction_orig, transaction_fee, gas_price, gas_limit, nonce, relay_hub_address, relay_address);

    if (returned_tx_params_hash === transaction_orig_params_hash && address_relay === signer) {
        tx.v = tx_v;
        tx.r = tx_r;
        tx.s = tx_s;
        return tx;
    } else {
        var i;
        for (i = 0; i < 7; i++) {
            console.log(request_decoded_params[i])
        }
        console.log(returned_tx, address_relay, from, to, transaction_orig, transaction_fee, gas_price, gas_limit, nonce, sig, signer)
    }
}


/**
 * Performs a '/relay' HTTP request to the given url
 * @returns a Promise that resolves to an instance of {@link EthereumTx} signed by a relay
 */
RelayClient.prototype.sendViaRelay = function (relayUrl, signature, from, to, encodedFunction, gasprice, gaslimit, relayFee, nonce, relayHubAddress, relayAddress) {
  var self = this

  return new Promise(function (resolve, reject) {

    let jsonRequestData = {
      "encodedFunction": encodedFunction,
      "signature": parseHexString(signature.replace(/^0x/, '')),
      "from": from,
      "to": to,
      "gasPrice": gasprice,
      "gasLimit": gaslimit,
      "relayFee": relayFee,
      "RecipientNonce": nonce,
      "RelayHubAddress": relayHubAddress
    };

    let callback = async function (error, body) {
      if (error) {
        reject(error);
        return
      }

      if (!body || !body.nonce ) {
        reject("Empty body received from server.");
        return
      }

      let validTransaction
      try {
        validTransaction = self.validateRelayResponse(
          body, relayAddress, from, to, encodedFunction,
          relayFee, gasprice, gaslimit, nonce, relayHubAddress, relayAddress, signature);
      }
      catch (error) {
        console.error("validateRelayResponse " + error)
      }

      if ( !validTransaction ) {
        reject("Failed to validate response")
        return
      }

      var raw_tx = '0x' + validTransaction.serialize().toString('hex');
      let txHash = "0x" + validTransaction.hash(true).toString('hex')
      console.log("txHash= " + txHash);
      self.broadcastRawTx(raw_tx, txHash);
      resolve(validTransaction);
    }
    self.httpSend.send(relayUrl + "/relay", jsonRequestData, callback)
  });
}

/**
 * In case Relay Server does not broadcast the signed transaction to the network,
 * client also broadcasts the same transaction. If the transaction fails with nonce
 * error, it indicates Relay may have signed multiple transactions with same nonce,
 * causing a DoS attack.
 *
 * @param {*} raw_tx - raw transaction bytes, signed by relay
 * @param {*} tx_hash - this transaction's ID
 */
RelayClient.prototype.broadcastRawTx = function (raw_tx, tx_hash) {
    var self = this

    self.web3.eth.sendSignedTransaction(raw_tx, function (error, result) {
        //TODO: at this point both client and relay has sent the transaction to the blockchain.
        // client should send the transaction to a SECONDARY relay, so it can wait and attempt
        // to penalize original relay for cheating: returning one transaction to the client, and
        // broadcasting another with the same nonce.
        // see the EIP for description of the attack

        //don't display error for the known-good cases
        if ( !(""+error).match(/the tx doesn't have the correct nonce|known transaction/) )
            console.log( "broadcastTx: ",error||result)

        if ( error ) {
            //note that nonce-related errors at this point are VALID reponses: it means that
            // the client confirms the relay didn't attempt to delay broadcasting the transaction.
            // the only point is that different node versions return different error strings:
            // ganache:  "the tx doesn't have the correct nonce"
            // ropsten: "known transaction"
        } else {
            if ( result == tx_hash ) {
                //transaction already on chain
            }
        }
    });
}

/**
 * check the balance of the given target contract.
 * the method will fail if the target is not a RelayRecipient.
 * (not strictly a client operation, but without a balance, the target contract can't accept calls)
 */
RelayClient.prototype.balanceOf = async function (target) {
    let relayRecipient = this.createRelayRecipient(target)
    let relayHubAddress

    relayHubAddress = await relayRecipient.methods.get_hub_addr().call()
    let relayHub = this.createRelayHub(relayHubAddress)

    //note that the returned value is a promise too, returning BigNumber
    return relayHub.methods.balanceOf(target).call()
}

/**
 * Options include standard transaction params: from,to, gasprice, gaslimit
 * can also override default relayUrl, relayFee
 * return value is the same as from sendTransaction
 */
RelayClient.prototype.relayTransaction = async function (encodedFunctionCall, options) {

  var self = this
  let relayRecipient = this.createRelayRecipient(options.to)

  let relayHubAddress = await relayRecipient.methods.get_hub_addr().call()

  let relayHub = this.createRelayHub(relayHubAddress)

  var nonce = parseInt( await relayHub.methods.get_nonce(options.from).call() )

  this.serverHelper.setHub(relayHub)

    //gas-price multiplicator: either default (10%) or configuration factor
  let pct = (this.config.gaspriceFactorPercent || GASPRICE_PERCENT)

  let gasPrice = this.config.force_gasPrice ||  //forced gasprice
                    options.gas_price ||        //user-supplied gas price
                    ( await this.web3.eth.getGasPrice() ) * (pct+100)/100

    //TODO: should add gas estimation for encodedFunctionCall (tricky, since its not a real transaction)
  let gasLimit = this.config.force_gasLimit || options.gas_limit

  let blockNow = await this.web3.eth.getBlockNumber()
  let blockDayAgo = Math.max(1, blockNow - est_blocks_per_day)
  let pinger = await this.serverHelper.newActiveRelayPinger(blockDayAgo, gasPrice)
  for (;;) {
    let activeRelay = await pinger.nextRelay()
    if ( !activeRelay ) {
        throw new Error("No relay responded! " + pinger.relaysCount + " attempted, " + pinger.pingedRelays + " pinged")
    }
    let relayAddress = activeRelay.RelayServerAddress
    let relayUrl = activeRelay.relayUrl

    let hash =
      utils.getTransactionHash(
        options.from,
        options.to,
        encodedFunctionCall,
        options.txfee,
        gasPrice,
        gasLimit,
        nonce,
        relayHub._address,
        relayAddress);

    let signature
    if (typeof self.ephemeralKeypair === "object" && self.ephemeralKeypair !== null) {
      signature = await getTransactionSignatureWithKey(self.ephemeralKeypair.privateKey, hash);
    } else {
      signature = await getTransactionSignature(options.from, hash);
    }

    try {
      let validTransaction = await self.sendViaRelay(
        relayUrl,
        signature,
        options.from,
        options.to,
        encodedFunctionCall,
        gasPrice,
        gasLimit,
        options.txfee,
        nonce,
        relayHub._address,
        relayAddress
      )
      return validTransaction
    }
    catch (error) {
        console.log("relayTransaction: req:",JSON.stringify({ from:options.from,
            to:options.to,
            encodedFunctionCall,
            txfee:options.txfee,
            gasPrice,
            gasLimit,
            nonce,
            relayhub:relayHub._address,
            relayAddress
        }).replace(/["{}]/g,"").replace(/,/g,"\n"))
      console.log("relayTransaction:", (""+error).replace(/ (\w+:)/g, "\n$1 ") )
    }
  }
}

RelayClient.prototype.fixTransactionReceiptResp = function (resp) {
    if ( resp && resp.result && resp.result.logs) {
        let logs = abi_decoder.decodeLogs(resp.result.logs)
        let relayed = logs.find(e => e && e.name == 'TransactionRelayed')
        if (relayed && relayed.events.find(e => e.name == "success").value === false) {
            console.log("log=" + relayed + " changing status to zero")
            resp.result.status = 0
        }
    }
    return resp
}

RelayClient.prototype.runRelay = function (payload, callback) {

    let params = payload.params[0]
    let relayClientOptions = this.config

    let relayOptions = {
        from: params.from,
        to: params.to,
        txfee: relayClientOptions.txfee,
        gas_limit: params.gas && parseInt(params.gas, 16),
        gas_price: params.gasPrice && parseInt(params.gasPrice, 16 )
    }

    if (relayClientOptions.verbose)
        console.log('RR: ', payload.id, relayOptions)

    this.relayTransaction(params.data, relayOptions)
        .then(validTransaction => {

            if (relayClientOptions.verbose)
                console.log("RR response: ", payload.id, validTransaction)

            var hash = "0x" + validTransaction.hash(true).toString('hex')
            callback(null, {jsonrpc: '2.0', id: payload.id, result: hash})
        })
        .catch(err => {
            if (relayClientOptions.verbose)
                console.log("RR error: ", err)
            callback(err, null)
        })
}



RelayClient.prototype.postAuditTransaction = function(signedTx, relayUrl) {
  var self = this
  return new Promise(function (resolve, reject) {
    let callback = function (error, response) {
      if (error) {
        reject(error);
        return
      }
      resolve(response);
    }
    self.httpSend.send(relayUrl + "/audit", { signedTx: signedTx }, callback);
  });
}

/**
 * Send a transaction signed by a relay to other relays for audit.
 * This is done in order to prevent nonce reuse by a misbehaving relay.
 *
 * @param {*} transaction
 * @param {*} auditingRelays - array of URLs of known relays to report this transaction to
 */
RelayClient.prototype.auditTransaction = async function (transaction, auditingRelays) {
    for (let relay in auditingRelays) {
        await this.postAuditTransaction(transaction, auditingRelays[relay]);
    }
}

RelayClient.prototype.newEphemeralKeypair = function(){
    let a = ethWallet.generate()
    return {
        privateKey: a.privKey,
        address: "0x" + a.getAddress().toString('hex')
    }
}

RelayClient.prototype.useKeypairForSigning = function(ephemeralKeypair){
    this.ephemeralKeypair = ephemeralKeypair
}

module.exports = RelayClient;
