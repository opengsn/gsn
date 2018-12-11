const enableRelay = require('./enableRelay')
const utils = require('./utils')
const getTransactionSignature = utils.getTransactionSignature;
const removeHexPrefix = utils.removeHexPrefix;
const padTo64 = utils.padTo64;

const ethUtils = require('ethereumjs-util');
const ethJsTx = require('ethereumjs-tx');
const abi_decoder = require('abi-decoder');

const relayHubAbi = require('./RelayHubApi')
const relayRecipientAbi = require('./RelayRecipientApi')
const addPastEvents = require('./addPastEvents')

const { promisify } = require("es6-promisify");
//const {promisify} = require("promisify");

abi_decoder.addABI(relayHubAbi)


/**
 * create a RelayClient library object, to force contracts to go through a relay. 
 * @param web3  - the web3 instance to use.
 * @param {object} config options
 *    txfee
 *lookup for relay
 *    minStake - ignore relays with stake below this (wei) value.
 *    minDelay - ignore relays with delay lower this (sec) value
 *    backups - open that many connections to relays on requests.
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

  this.RelayRecipient = web3.eth.contract(relayRecipientAbi)
  this.RelayHub = web3.eth.contract(relayHubAbi)
  //add missing "getPastEvents" in web3 v0.2..
  addPastEvents(this.RelayHub)
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
 * @returns on object containing the first relay to respond to a ping message,
 * as well as two other relays selected by fee, stake and delay.
 */
RelayClient.prototype.findRelay = async function (relayHubAddress, minStake, minDelay, backups) {
  let filteredRelays = await this.getRelaysAdded(relayHubAddress);

  let origRelays = filteredRelays
  if (minStake) {
    filteredRelays = filteredRelays.filter(a => a.stake >= minStake)
  }

  if (minDelay) {
    filteredRelays = filteredRelays.filter(a => a.unstakeDelay >= minDelay)
  }

  if (!backups) {
    backups = 3
  }

  let size = filteredRelays.length > backups ? backups : filteredRelays.length

  if (size == 0) {
    throw new Error("no valid relays. orig relays=" + JSON.stringify(origRelays))
  }

  filteredRelays = filteredRelays.sort((a, b) => {
    return a.txFee - b.txFee
  }).slice(0, size)

  let firstRelayToRespond = await this.raceToSuccess(
    filteredRelays.map(relay => this.getRelayAddress(relay.relayUrl))
  );

  let lookupResult = {
    firstRelayToRespond: firstRelayToRespond,
    otherRelays: filteredRelays.filter(a => a.relayUrl !== firstRelayToRespond.relayUrl)
  }

  return lookupResult
}

/**
 * Iterates through all RelayAdded and RelayRemoved logs emitted by given hub
 * @param {*} relayHubAddress
 * @returns an array of relays cuurently registered on given RelayHub contract
 */
RelayClient.prototype.getRelaysAdded = async function (relayHubAddress) {
  let activeRelays = {}
  let addedAndRemovedEvents = await this.RelayHub.getPastEvents({ address: relayHubAddress, fromBlock: 1, topics: [["RelayAdded", "RelayRemoved"]] })

  for (var index in addedAndRemovedEvents) {
    let event = addedAndRemovedEvents[index]
    if (event.event === "RelayAdded") {
      activeRelays[event.args.relay] = {
        relayUrl: event.args.url,
        transactionFee: event.args.transactionFee,
        stake: event.args.stake,
        unstakeDelay: event.args.unstakeDelay
      }
    } else if (event.event === "RelayRemoved") {
      delete activeRelays[event.args.relay]
    }
  }
  return Object.values(activeRelays)
}
/**
 * From https://stackoverflow.com/a/37235207 (modified to catch exceptions)
 * Resolves once any promise resolves, ignores the rest, ignores rejections
 */
RelayClient.prototype.raceToSuccess = function(promises) {
  let numRejected = 0;
  return new Promise(
    (resolve, reject) =>
      promises.forEach(
        promise =>
          promise.then((res) =>
            resolve(res)
          )
            .catch(err => {
              // console.log(err)
              if (++numRejected === promises.length) {
                reject("No response from any server.", err);
              }
            })
      )
  );
}

function parseHexString(str) {
  var result = [];
  while (str.length >= 2) {
    result.push(parseInt(str.substring(0, 2), 16));

    str = str.substring(2, str.length);
  }

  return result;
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

      if (!body) {
        reject("Empty body received from server.");
        return
      }

      let validTransaction = self.validateRelayResponse(
        body, relayAddress, from, to, encodedFunction,
        relayFee, gasprice, gaslimit, nonce, relayHubAddress, relayAddress, signature);

      if (validTransaction === undefined) {
        reject("Failed to validate response")
        return
      }

      var raw_tx = '0x' + validTransaction.serialize().toString('hex');
      let txHash = "0x" + validTransaction.hash(false).toString('hex')
      console.log("txHash= " + txHash);
      self.broadcastRawTx(raw_tx, txHash);
      resolve(validTransaction);
    }
    self.httpSend(relayUrl + "/relay", jsonRequestData, callback)
  });
}

var logreq = false
var unique_id = 1

RelayClient.prototype.httpSend = function(url, jsonRequestData, callback) {

  let localid = unique_id++
  if ( logreq ) {
    console.log( "sending request:",localid,url, JSON.stringify(jsonRequestData).slice(0,40))
  }

  callback1 = function (e, r) {
    if (e && ("" + e).indexOf("Invalid JSON RPC response") >= 0) {
      e = { error: "invalid-json" }
    }
    if (logreq) {
      console.log( "got response:",localid, JSON.stringify(r).slice(0,40), "err=",JSON.stringify(e).slice(0,40))
    }
    callback(e, r)
  }
  new web3.providers.HttpProvider(url).sendAsync(jsonRequestData, callback1);
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
  self.web3.eth.sendRawTransaction(raw_tx, function (error, result) {
    if (!error) {
      console.log(JSON.stringify(result));
      return
    }
    if (error.message.includes("the tx doesn't have the correct nonce")) {
      self.web3.eth.getTransaction(tx_hash, function (err, tx) {
        // console.log(tx);
        if (tx === null) {
          console.error("Cheating relay!");
          // TODO: At this point, I do know relay cheated on my nonce. Can punish him for this.
        }
      });
    }
    else {
      console.error("Failed to retransmit relayed tx: " + error.message);
    }
  });
}

/**
 * check the balance of the given target contract.
 * the method will fail if the target is not a RelayRecipient.
 * (not strictly a client operation, but without a balance, the target contract can't accept calls)
 */
RelayClient.prototype.balanceOf = async function (target) {
  let relayRecipient = this.RelayRecipient.at(target)
  let relayHubAddress = await promisify(relayRecipient.get_relay_hub.call)()
  let relayHub = this.RelayHub.at(relayHubAddress)

  //note that the returned value is a promise too, returning BigNumber
  return relayHub.balanceOf(target)
}

/**
 * Options include standard transaction params: from,to, gasprice, gaslimit
 * can also override default relayUrl, relayFee
 * return value is the same as from sendTransaction
 */
RelayClient.prototype.relayTransaction = async function (encodedFunctionCall, options) {
  let relayRecipient = this.RelayRecipient.at(options.to)

  let relayHubAddress = await promisify(relayRecipient.get_relay_hub.call)()

  let relayUrl = this.config.relayUrl;
  let relayAddress = this.config.relayAddress;

  if (!relayUrl || !relayAddress) {

    let res = await this.findRelay(relayHubAddress, this.config.minStake, this.config.minDelay, this.config.backups)

    let r = res.firstRelayToRespond
    relayUrl = r.relayUrl
    relayAddress = r.RelayServerAddress
  }

  let relayHub = this.RelayHub.at(relayHubAddress)

  var nonce = (await promisify(relayHub.get_nonce.call)(options.from)).toNumber()

  let hash =
    utils.getTransactionHash(
      options.from,
      options.to,
      encodedFunctionCall,
      options.txfee,
      options.gas_price,
      options.gas_limit,
      nonce,
      relayHub.address,
      relayAddress);

  let signature
  if (typeof this.config.signForAccount === "function") {
    console.log("=== using signForAccount")
    signature = this.config.signForAccount(options.from, hash);
  } else {
    signature = await getTransactionSignature(options.from, hash);
  }

  return this.sendViaRelay(
    relayUrl,
    signature,
    options.from,
    options.to,
    encodedFunctionCall,
    options.gas_price,
    options.gas_limit,
    options.txfee,
    nonce,
    relayHub.address,
    relayAddress
  )
}

/**
 * Wraps all transactions methods in given contract object with Relay logic.
 * Note: does not return a copy, modifies a given instance
 * See {@link enableRelay}
 * @param {*} contract - a relay recepient contract 
 */
RelayClient.prototype.hook = function (contract) {
  enableRelay(contract, {
    verbose: this.config.verbose,
    runRelay: this.runRelay.bind(this)
  })
}

RelayClient.prototype.runRelay = function (payload, callback) {

  let params = payload.params[0]
  let relayClientOptions = this.config

  let relayOptions = {
    from: params.from,
    to: params.to,
    txfee: relayClientOptions.txfee,
    gas_limit: relayClientOptions.force_gasLimit || parseInt(params.gas, 16),
    gas_price: relayClientOptions.force_gasPrice || parseInt(params.gasPrice, 16)
  }

  if (relayClientOptions.verbose)
    console.log('RR: ', payload.id, relayOptions)

  this.relayTransaction(params.data, relayOptions)
    .then(validTransaction => {

      if (relayClientOptions.verbose)
        console.log("RR response: ", payload.id, validTransaction)

      validTransaction.chainId = 1
      var hash = "0x" + validTransaction.hash(false).toString('hex')
      callback(null, { jsonrpc: '2.0', id: payload.id, result: hash })
    })
    .catch(err => {
      if (relayClientOptions.verbose)
        console.log("RR error: ", err)
      callback(err, null)
    })
}


/**
 //returns struct from the relay server, and adds the URL to it:
 // { relayUrl: url,
//   RelayServerAddress: address
// }
 */
RelayClient.prototype.getRelayAddress = function (relayUrl) {
  let self=this
  return new Promise(function (resolve, reject) {
    let callback = function (error, body) {
      if (error) {
        reject(error);
        return
      }
      try {
        body.relayUrl = relayUrl
        resolve(body);
      }
      catch (err) {
        reject(err);
      }
    }
    self.httpSend(relayUrl + "/getaddr", {}, callback)
  });
}

RelayClient.prototype.postAuditTransaction = function(signedTx, relayUrl) {
  let self=this
  return new Promise(function (resolve, reject) {
    let callback = function (error, response) {
      if (error) {
        reject(error);
        return
      }
      resolve(response);
    }
    self.httpSend(relayUrl + "/audit", { signedTx: signedTx }, callback);  });
}

/**
 * Send a transaction signed by a relay to other relays for audit. 
 * This is done in order to prevent nonce reuse by a misbehaving relay.
 * 
 * @param {*} transaction 
 * @param {*} auditingRelays - array of URLs of known relays to report this transaction to 
 */
RelayClient.prototype.auditTransaction = async function (transaction, auditingRelays) {
  for (relay in auditingRelays) {
    await this.postAuditTransaction(transaction, auditingRelays[relay]);
  }
}

module.exports = RelayClient;
