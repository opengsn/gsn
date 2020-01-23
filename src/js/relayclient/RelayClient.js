const utils = require('./utils')
const getEip712Signature = utils.getEip712Signature
const getTransactionSignatureWithKey = utils.getTransactionSignatureWithKey
const parseHexString = utils.parseHexString
const removeHexPrefix = utils.removeHexPrefix
const padTo64 = utils.padTo64

const ServerHelper = require('./ServerHelper')
const HttpWrapper = require('./HttpWrapper')
const ethUtils = require('ethereumjs-util')
const ethWallet = require('ethereumjs-wallet')
const Transaction = require('ethereumjs-tx')
const abiDecoder = require('abi-decoder')

const relayHubAbi = require('./IRelayHub')
// This file is only needed so we don't change IRelayHub code, which would affect RelayHub expected deployed address
// TODO: Once we change RelayHub version, we should add abstract method "function version() external returns (string memory);" to IRelayHub.sol and remove IRelayHubVersionAbi.json
const versionAbi = require('./IRelayHubVersionAbi')
relayHubAbi.push(versionAbi)

const relayRecipientAbi = require('./IRelayRecipient')

const relayLookupLimitBlocks = 6000
abiDecoder.addABI(relayHubAbi)

// default timeout (in ms) for http requests
const DEFAULT_HTTP_TIMEOUT = 10000

// default gas price (unless client specifies one): the web3.eth.gasPrice*(100+GASPRICE_PERCENT)/100
const GASPRICE_PERCENT = 20

const canRelayStatus = {
  1: '1 WrongSignature', // The transaction to relay is not signed by requested sender
  2: '2 WrongNonce', // The provided nonce has already been used by the sender
  3: '3 AcceptRelayedCallReverted', // The recipient rejected this call via acceptRelayedCall
  4: '4 InvalidRecipientStatusCode' // The recipient returned an invalid (reserved) status code
}

class RelayClient {
  /**
   * create a RelayClient library object, to force contracts to go through a relay.
   * @param web3  - the web3 instance to use.
   * @param {object} config options
   *    txfee
   *    validateCanRelay - client calls canRelay before calling the relay the first time (defaults to true)
   *lookup for relay
   *    minStake - ignore relays with stake below this (wei) value.
   *    minDelay - ignore relays with delay lower this (sec) value
   *
   *    calculateRelayScore - function to give a "score" to a relay, based on its properties:
   *          transactionFee, stake, unstakeDelay, relayUrl.
   *          return null to filter-out the relay completely
   *          default function uses just trasnactionFee (gives highest score to lowest fee)
   *
   *    gaspriceFactorPercent - increase (in %) over current gasPrice average. default is 10%.
   *          Note that the resulting gasPrice must be accepted by relay (above its minGasPrice)
   *
   *manual settings: these can be used to override the default setting.
   *    relayUrl, relayAddress - avoid lookup on relayHub for relays, and always use this URL/address
   *    force_gasLimit - force gaslimit, instead of transaction paramter
   *    force_gasPrice - force gasPrice, instread of transaction parameter.
   */
  constructor (web3, config) {
    // TODO: require sign() or privKey
    // fill in defaults:
    this.config = Object.assign({
      validateCanRelay: true,
      httpTimeout: DEFAULT_HTTP_TIMEOUT
    }, config)

    this.web3 = web3
    this.httpSend = this.config.httpSend || new HttpWrapper({ timeout: this.config.httpTimeout })
    this.failedRelays = {}
    this.serverHelper = this.config.serverHelper || new ServerHelper(this.httpSend, this.failedRelays, this.config)
  }

  createRelayRecipient (addr) {
    return new this.web3.eth.Contract(relayRecipientAbi, addr)
  }

  createRelayHub (addr) {
    return new this.web3.eth.Contract(relayHubAbi, addr)
  }

  /**
   * Decode the signed transaction returned from the Relay Server, compare it to the
   * requested transaction and validate its signature.
   * @returns a signed {@link ethJsTx} instance for broacasting, or null if returned
   * transaction is not valid.
   */
  validateRelayResponse (returnedTx, addressRelay,
    from, to, transactionOrig, transactionFee, gasPrice, gasLimit, nonce,
    relayHubAddress, relayAddress, sig, approvalData) {
    var tx = new Transaction({
      nonce: returnedTx.nonce,
      gasPrice: returnedTx.gasPrice,
      gasLimit: returnedTx.gas,
      to: returnedTx.to,
      value: returnedTx.value,
      data: returnedTx.input
    })

    const message = tx.hash(false)
    const txV = Buffer.from(removeHexPrefix(returnedTx.v), 'hex')
    const txR = Buffer.from(padTo64(removeHexPrefix(returnedTx.r)), 'hex')
    const txS = Buffer.from(padTo64(removeHexPrefix(returnedTx.s)), 'hex')

    const signer = ethUtils.bufferToHex(ethUtils.pubToAddress(ethUtils.ecrecover(message, txV[0], txR, txS)))
    const requestDecodedParams = abiDecoder.decodeMethod(returnedTx.input).params
    const returnedTxParamsHash = utils.getTransactionHash(
      requestDecodedParams[0].value,
      requestDecodedParams[1].value,
      requestDecodedParams[2].value,
      requestDecodedParams[3].value,
      requestDecodedParams[4].value,
      requestDecodedParams[5].value,
      requestDecodedParams[6].value,
      returnedTx.to,
      signer
    )
    const transactionOrigParamsHash = utils.getTransactionHash(
      from, to, transactionOrig, transactionFee, gasPrice, gasLimit, nonce, relayHubAddress, relayAddress)

    if (returnedTxParamsHash === transactionOrigParamsHash && utils.isSameAddress(addressRelay, signer)) {
      if (this.config.verbose) {
        console.log('validateRelayResponse - valid transaction response')
      }
      tx.v = txV
      tx.r = txR
      tx.s = txS
      return tx
    } else {
      console.error('validateRelayResponse: req', JSON.stringify(requestDecodedParams))
      console.error('validateRelayResponse: rsp', {
        returned_tx: returnedTx,
        address_relay: addressRelay,
        from,
        to,
        transaction_orig: transactionOrig,
        transaction_fee: transactionFee,
        gas_price: gasPrice,
        gas_limit: gasLimit,
        nonce,
        sig,
        approvalData,
        signer
      })
    }
  }

  /**
   * Performs a '/relay' HTTP request to the given url
   * @returns a Promise that resolves to an instance of {@link Transaction} signed by a relay
   */
  sendViaRelay (relayAddress, from, to, encodedFunction, relayFee, gasprice, gaslimit, recipientNonce, signature, approvalData, relayUrl, relayHubAddress, relayMaxNonce) {
    var self = this

    return new Promise(function (resolve, reject) {
      const jsonRequestData = {
        encodedFunction: encodedFunction,
        signature: parseHexString(signature.replace(/^0x/, '')),
        approvalData: parseHexString(approvalData.toString('hex').replace(/^0x/, '')),
        from: from,
        to: to,
        gasPrice: gasprice,
        gasLimit: gaslimit,
        relayFee: relayFee,
        RecipientNonce: parseInt(recipientNonce),
        RelayMaxNonce: parseInt(relayMaxNonce),
        RelayHubAddress: relayHubAddress
      }

      const callback = async function (error, body) {
        if (error) {
          if (error.error && error.error.indexOf('timeout') !== -1) {
            self.failedRelays[relayUrl] = {
              lastError: new Date().getTime(),
              address: relayAddress,
              url: relayUrl
            }
          }
          reject(error)
          return
        }
        if (self.config.verbose) {
          console.log('sendViaRelay resp=', body)
        }
        if (body && body.error) {
          reject(body.error)
          return
        }
        if (!body || !body.nonce) {
          reject(Error('Empty body received from server, or neither \'error\' nor \'nonce\' fields present.'))
          return
        }

        let validTransaction
        try {
          validTransaction = self.validateRelayResponse(
            body, relayAddress, from, to, encodedFunction,
            relayFee, gasprice, gaslimit, recipientNonce, relayHubAddress, relayAddress, signature, approvalData)
        } catch (error) {
          console.error('validateRelayResponse ' + error)
        }

        if (!validTransaction) {
          reject(Error('Failed to validate response'))
          return
        }
        const receivedNonce = validTransaction.nonce.readUIntBE(0, validTransaction.nonce.byteLength)
        if (receivedNonce > relayMaxNonce) {
          // TODO: need to validate that client retries the same request and doesn't double-spend.
          // Note that this transaction is totally valid from the EVM's point of view
          reject(Error('Relay used a tx nonce higher than requested. Requested ' + relayMaxNonce + ' got ' + receivedNonce))
          return
        }

        var rawTx = '0x' + validTransaction.serialize().toString('hex')
        const txHash = '0x' + validTransaction.hash(true).toString('hex')
        console.log('txHash= ' + txHash)
        self.broadcastRawTx(rawTx, txHash)
        resolve(validTransaction)
      }

      if (self.config.verbose) {
        const replacer = (key, value) => {
          if (key === 'signature') { return signature } else { return value }
        }
        console.log('sendViaRelay to URL: ' + relayUrl + ' ' + JSON.stringify(jsonRequestData, replacer))
      }
      self.httpSend.send(relayUrl + '/relay', jsonRequestData, callback)
    })
  }

  /**
   * In case Relay Server does not broadcast the signed transaction to the network,
   * client also broadcasts the same transaction. If the transaction fails with nonce
   * error, it indicates Relay may have signed multiple transactions with same nonce,
   * causing a DoS attack.
   *
   * @param {*} rawTx - raw transaction bytes, signed by relay
   * @param {*} txHash - this transaction's ID
   */
  broadcastRawTx (rawTx, txHash) {
    var self = this

    self.web3.eth.sendSignedTransaction(rawTx, function (error, result) {
      // TODO: at this point both client and relay has sent the transaction to the blockchain.
      // client should send the transaction to a SECONDARY relay, so it can wait and attempt
      // to penalize original relay for cheating: returning one transaction to the client, and
      // broadcasting another with the same nonce.
      // see the EIP for description of the attack

      // don't display error for the known-good cases
      if (!('' + error).match(/the tx doesn't have the correct nonce|known transaction/)) { console.log('broadcastTx: ', error || result) }

      if (error) {
        // note that nonce-related errors at this point are VALID reponses: it means that
        // the client confirms the relay didn't attempt to delay broadcasting the transaction.
        // the only point is that different node versions return different error strings:
        // ganache:  "the tx doesn't have the correct nonce"
        // ropsten: "known transaction"
      } else {
        if (result === txHash) {
          // transaction already on chain
        }
      }
    })
  }

  /**
   * check the balance of the given target contract.
   * the method will fail if the target is not a RelayRecipient.
   * (not strictly a client operation, but without a balance, the target contract can't accept calls)
   */
  async balanceOf (target) {
    const relayHub = await this.createRelayHubFromRecipient(target)
    // note that the returned value is a promise too, returning BigNumber
    return relayHub.methods.balanceOf(target).call()
  }

  /**
   * Options include standard transaction params: from,to, gas_price, gas_limit
   * relay-specific params:
   *  txfee (override config.txfee)
   *  validateCanRelay - client calls canRelay before calling the relay the first time (defaults to true)
   * can also override default relayUrl, relayFee
   * return value is the same as from sendTransaction
   */
  async relayTransaction (encodedFunctionCall, options) {
    // validateCanRelay defaults (in config). to disable, explicitly set options.validateCanRelay=false
    options = Object.assign({ validateCanRelay: this.config.validateCanRelay }, options)

    var self = this
    const relayHub = await this.createRelayHubFromRecipient(options.to)

    var nonce = parseInt(await relayHub.methods.getNonce(options.from).call())

    this.serverHelper.setHub(relayHub)

    // gas-price multiplicator: either default (10%) or configuration factor
    const pct = (this.config.gaspriceFactorPercent || GASPRICE_PERCENT)

    let networkGasPrice = await this.web3.eth.getGasPrice()
    // Sometimes, xDai netwiork returns '0'
    // eslint-disable-next-line eqeqeq
    if (!networkGasPrice || networkGasPrice == 0) {
      networkGasPrice = 1e9
    }

    const gasPrice = this.config.force_gasPrice || // forced gasprice
      options.gas_price || // user-supplied gas price
      Math.round((networkGasPrice) * (pct + 100) / 100)

    // TODO: should add gas estimation for encodedFunctionCall (tricky, since its not a real transaction)
    const gasLimit = this.config.force_gasLimit || options.gas_limit

    const blockNow = await this.web3.eth.getBlockNumber()
    const blockFrom = Math.max(1, blockNow - relayLookupLimitBlocks)
    const pinger = await this.serverHelper.newActiveRelayPinger(blockFrom, gasPrice)
    const errors = []
    let firstTry = true
    for (; ;) {
      const activeRelay = await pinger.nextRelay()
      if (!activeRelay) {
        const error = new Error('No relay responded! ' + pinger.relaysCount + ' attempted, ' + pinger.pingedRelays + ' pinged')
        error.otherErrors = errors
        throw error
      }
      const relayAddress = activeRelay.RelayServerAddress
      const relayUrl = activeRelay.relayUrl
      const txfee = parseInt(options.txfee || activeRelay.transactionFee)

      // const hash =
      //   utils.getTransactionHash(
      //     options.from,
      //     options.to,
      //     encodedFunctionCall,
      //     txfee,
      //     gasPrice,
      //     gasLimit,
      //     nonce,
      //     relayHub._address,
      //     relayAddress)

      let signature
      if (typeof self.ephemeralKeypair === 'object' && self.ephemeralKeypair !== null) {
        signature = await getTransactionSignatureWithKey(self.ephemeralKeypair.privateKey, hash)
      } else {
        signature = (await getEip712Signature(
          {
            web3: this.web3,
            methodAppendix: '',
            senderAccount: options.from,
            senderNonce: nonce.toString(),
            target: options.to,
            encodedFunction: encodedFunctionCall,
            pctRelayFee: txfee.toString(),
            gasPrice: gasPrice.toString(),
            gasLimit: gasLimit.toString(),
            relayHub: relayHub._address,
            relayAddress
          })).signature
      }

      let approvalData = options.approvalData || '0x'
      if (typeof options.approveFunction === 'function') {
        approvalData = '0x' + await options.approveFunction({
          from: options.from,
          to: options.to,
          encodedFunctionCall: encodedFunctionCall,
          txfee: options.txfee,
          gas_price: gasPrice,
          gas_limit: gasLimit,
          nonce: nonce,
          relay_hub_address: relayHub._address,
          relay_address: relayAddress
        })
      }

      if (self.config.verbose) {
        console.log('relayTransaction', 'from: ', options.from, 'sig: ', signature)
        // const rec = utils.getEcRecoverMeta(hash, signature)
        // if (rec.toLowerCase() === options.from.toLowerCase()) {
        //   console.log('relayTransaction recovered:', rec, 'signature is correct')
        // } else {
        //   console.error('relayTransaction recovered:', rec, 'signature error')
        // }
      }

      // max nonce is not signed, as contracts cannot access addresses' nonces.
      let allowedRelayNonceGap = this.config.allowed_relay_nonce_gap
      if (typeof allowedRelayNonceGap === 'undefined') {
        allowedRelayNonceGap = 3
      }
      const relayMaxNonce = (await this.web3.eth.getTransactionCount(relayAddress)) + allowedRelayNonceGap

      // on first found relay, call canRelay to make sure that on-chain this request can pass
      if (options.validateCanRelay && firstTry) {
        firstTry = false
        const res = await relayHub.methods.canRelay(
          relayAddress,
          options.from,
          options.to,
          encodedFunctionCall,
          txfee,
          gasPrice,
          gasLimit,
          nonce,
          signature,
          approvalData
        ).call()
        if (res.status !== '0') {
          // in case of error, the context is an error message.
          const errorMsg = res.recipientContext ? Buffer.from(res.recipientContext.slice(2), 'hex').toString() : ''
          const status = canRelayStatus[res.status] || res.status
          throw new Error('canRelay failed: ' + status + ': ' + errorMsg)
        }
      }

      try {
        const validTransaction = await self.sendViaRelay(
          relayAddress,
          options.from,
          options.to,
          encodedFunctionCall,
          txfee,
          gasPrice,
          gasLimit,
          nonce,
          signature,
          approvalData,
          relayUrl,
          relayHub._address,
          relayMaxNonce
        )
        return validTransaction
      } catch (error) {
        errors.push(error)
        if (self.config.verbose) {
          console.log('relayTransaction: req:', {
            from: options.from,
            to: options.to,
            encodedFunctionCall,
            txfee: options.txfee,
            gasPrice,
            gasLimit,
            nonce,
            relayhub: relayHub._address,
            relayAddress
          })
          console.log('relayTransaction:', ('' + error).replace(/ (\w+:)/g, '\n$1 '))
        }
      }
    }
  }

  fixTransactionReceiptResp (respResult) {
    if (respResult && respResult.logs) {
      const logs = abiDecoder.decodeLogs(respResult.logs)
      const canRelayFailed = logs.find(e => e && e.name === 'CanRelayFailed')
      const transactionRelayed = logs.find(e => e && e.name === 'TransactionRelayed')

      const setErrorStatus = (reason) => {
        console.log(`${reason}. changing status to zero`)
        respResult.status = 0
      }

      if (canRelayFailed) {
        setErrorStatus(`canRelay failed: ${canRelayFailed.events.find(e => e.name === 'reason').value}`)
      } else if (transactionRelayed) {
        const status = transactionRelayed.events.find(e => e.name === 'status').value
        // 0 signifies success
        if (status !== '0') {
          setErrorStatus(`reverted relayed transaction, status code ${status}`)
        }
      }
    }
  }

  runRelay (payload, callback) {
    const params = payload.params[0]
    const relayClientOptions = this.config

    const { txfee, txFee, gas, gasPrice } = params
    const relayOptions = {
      ...params,
      txfee: txFee || txfee || relayClientOptions.txfee,
      gas_limit: gas && parseInt(gas, 16),
      gas_price: gasPrice && parseInt(gasPrice, 16)
    }

    if (relayClientOptions.verbose) { console.log('RR: ', payload.id, relayOptions) }

    this.relayTransaction(params.data, relayOptions)
      .then(validTransaction => {
        var hash = '0x' + validTransaction.hash(true).toString('hex')
        callback(null, {
          jsonrpc: '2.0',
          id: payload.id,
          result: hash
        })
      })
      .catch(err => {
        if (relayClientOptions.verbose) { console.log('RR error: ', err) }
        callback(err, null)
      })
  }

  postAuditTransaction (signedTx, relayUrl) {
    var self = this
    return new Promise(function (resolve, reject) {
      const callback = function (error, response) {
        if (error) {
          reject(error)
          return
        }
        resolve(response)
      }
      self.httpSend.send(relayUrl + '/audit', { signedTx: signedTx }, callback)
    })
  }

  /**
   * Send a transaction signed by a relay to other relays for audit.
   * This is done in order to prevent nonce reuse by a misbehaving relay.
   *
   * @param {*} transaction
   * @param {*} auditingRelays - array of URLs of known relays to report this transaction to
   */
  async auditTransaction (transaction, auditingRelays) {
    for (const relay in auditingRelays) {
      await this.postAuditTransaction(transaction, auditingRelays[relay])
    }
  }

  static newEphemeralKeypair () {
    const a = ethWallet.generate()
    return {
      privateKey: a.privKey,
      address: '0x' + a.getAddress().toString('hex')
    }
  }

  useKeypairForSigning (ephemeralKeypair) {
    if (ephemeralKeypair && (typeof ephemeralKeypair.privateKey) === 'string') {
      ephemeralKeypair.privateKey = Buffer.from(removeHexPrefix(ephemeralKeypair.privateKey), 'hex')
    }
    this.ephemeralKeypair = ephemeralKeypair
  }

  async createRelayHubFromRecipient (recipientAddress) {
    const relayRecipient = this.createRelayRecipient(recipientAddress)

    let relayHubAddress
    try {
      relayHubAddress = await relayRecipient.methods.getHubAddr().call()
    } catch (err) {
      throw new Error(`Could not get relay hub address from recipient at ${recipientAddress} (${err.message}). Make sure it is a valid recipient contract.`)
    }

    if (!relayHubAddress || ethUtils.isZeroAddress(relayHubAddress)) {
      throw new Error(`The relay hub address is set to zero in recipient at ${recipientAddress}. Make sure it is a valid recipient contract.`)
    }

    const relayHub = this.createRelayHub(relayHubAddress)

    let hubVersion
    try {
      hubVersion = await relayHub.methods.version().call()
    } catch (err) {
      throw new Error(`Could not query relay hub version at ${relayHubAddress} (${err.message}). Make sure the address corresponds to a relay hub.`)
    }

    if (!hubVersion.startsWith('1')) {
      throw new Error(`Unsupported relay hub version '${hubVersion}'.`)
    }

    return relayHub
  }
}

module.exports = RelayClient
