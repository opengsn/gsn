const utils = require('./utils')
const getEip712Signature = utils.getEip712Signature
const parseHexString = utils.parseHexString
const removeHexPrefix = utils.removeHexPrefix
const padTo64 = utils.padTo64

const ServerHelper = require('./ServerHelper')
const HttpWrapper = require('./HttpWrapper')
const ethUtils = require('ethereumjs-util')
const ethWallet = require('ethereumjs-wallet')
const Transaction = require('ethereumjs-tx')
const abiDecoder = require('abi-decoder')
const sigUtil = require('eth-sig-util')

const getDataToSign = require('./EIP712/Eip712Helper')
const RelayRequest = require('./EIP712/RelayRequest')
const relayHubAbi = require('./interfaces/IRelayHub')
// This file is only needed so we don't change IRelayHub code, which would affect RelayHub expected deployed address
// TODO: Once we change RelayHub version, we should add abstract method "function version() external returns (string memory);" to IRelayHub.sol and remove IRelayHubVersionAbi.json
const versionAbi = require('./IRelayHubVersionAbi')
relayHubAbi.push(versionAbi)

const paymasterAbi = require('./interfaces/IPaymaster')

const SecondsPerBlock = 12

// default history lookup for relays
// assuming 12 seconds per block
const relayLookupLimitBlocks = 3600 * 24 / SecondsPerBlock * 30
abiDecoder.addABI(relayHubAbi)

// default timeout (in ms) for http requests
const DEFAULT_HTTP_TIMEOUT = 10000

const Environments = require('./Environments')

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
   *    preferredRelays - if set, try to use these relays first. only if none of them return
   *      a valid address (by calling its "/getaddr"), use the use the lookup mechanism.
   *    pctRelayFee
   *    validateCanRelay - client calls canRelay before calling the relay the first time (defaults to true)
   *lookup for relay
   *    minStake - ignore relays with stake below this (wei) value.
   *    minDelay - ignore relays with delay lower this (sec) value
   *    relayLookupLimitBlocks - how many blocks back to look for relays. default = ~30 days
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

  createPaymaster (addr) {
    return new this.web3.eth.Contract(paymasterAbi, addr)
  }

  createRelayHub (addr) {
    return new this.web3.eth.Contract(relayHubAbi, addr)
  }

  /**
   * Decode the signed transaction returned from the Relay Server, compare it to the
   * requested transaction and validate its signature.
   * @returns a signed {@link Transaction} instance for broadcasting, or null if returned
   * transaction is not valid.
   */
   
  validateRelayResponse (
    returnedTx, addressRelay,
    senderAddress, target, encodedFunction, baseRelayFee, pctRelayFee, gasPrice, gasLimit, paymaster, senderNonce,
    relayHubAddress, relayAddress, sig, approvalData) {
    const tx = new Transaction(returnedTx)

    const message = tx.hash(false)
    if (this.config.verbose) {
      console.log('returnedTx is', tx.v, tx.r, tx.s, tx.to, tx.data, tx.gasLimit, tx.gasPrice, tx.value)
    }

    const signer = ethUtils.bufferToHex(ethUtils.pubToAddress(ethUtils.ecrecover(message, tx.v[0], tx.r, tx.s)))

    const relayRequestOrig = new RelayRequest({
      senderAddress,
      target,
      encodedFunction,
      gasPrice,
      gasLimit,
      baseRelayFee,
      pctRelayFee,
      senderNonce,
      relayAddress,
      paymaster
    })

    const relayHub = this.createRelayHub(relayHubAddress)
    const relayRequestAbiEncode = relayHub.methods.relayCall(relayRequestOrig, sig, approvalData).encodeABI()

    if (
      utils.isSameAddress(ethUtils.bufferToHex(tx.to), relayHubAddress) &&
      relayRequestAbiEncode === ethUtils.bufferToHex(tx.data) &&
      utils.isSameAddress(addressRelay, signer)
    ) {
      if (this.config.verbose) {
        console.log('validateRelayResponse - valid transaction response')
      }
      return tx
    } else {
      console.error('validateRelayResponse: req', relayRequestAbiEncode, relayHubAddress, addressRelay)
      console.error('validateRelayResponse: rsp', ethUtils.bufferToHex(tx.data), ethUtils.bufferToHex(tx.to), signer)
    }
  }

  /**
   * Performs a '/relay' HTTP request to the given url
   * @returns a Promise that resolves to an instance of {@link Transaction} signed by a relay
   */
  async sendViaRelay (
    {
      relayAddress,
      from,
      to,
      encodedFunction,
      pctRelayFee,
      baseRelayFee,
      gasPrice,
      gasLimit,
      paymaster,
      senderNonce,
      signature,
      approvalData,
      relayUrl,
      relayHubAddress,
      relayMaxNonce
    }) {
    var self = this

    return new Promise(function (resolve, reject) {
      const jsonRequestData = {
        encodedFunction: encodedFunction,
        signature: parseHexString(signature.replace(/^0x/, '')),
        approvalData: parseHexString(approvalData.toString('hex').replace(/^0x/, '')),
        from: from,
        to: to,
        gasPrice,
        gasLimit,
        paymaster,
        percentRelayFee: parseInt(pctRelayFee),
        baseRelayFee: parseInt(baseRelayFee),
        senderNonce: parseInt(senderNonce),
        relayMaxNonce: parseInt(relayMaxNonce),
        relayHubAddress: relayHubAddress
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
        if (!body) {
          reject(Error('Empty body received from server.'))
          return
        }
        if (body.error) {
          console.log('Got error response from relay', body.error)
          reject(body.error)
          return
        }
        if (!body.signedTx) {
          console.log('body is', body)
          reject(Error('body.signedTx field missing.'))
          return
        }

        let validTransaction
        // TODO: this 'try/catch' is concealing all errors and makes development harder. Fix.
        try {
          validTransaction = self.validateRelayResponse(
            body.signedTx, relayAddress, from, to, encodedFunction,
            baseRelayFee,
            pctRelayFee, gasPrice.toString(), gasLimit.toString(), paymaster, senderNonce,
            relayHubAddress, relayAddress, signature, approvalData)
        } catch (error) {
          console.error('validateRelayResponse threw error:\n', error, error.stack)
        }

        if (!validTransaction) {
          reject(Error('Failed to validate response'))
          return
        }
        const receivedNonce = validTransaction.nonce.readUIntBE(0, validTransaction.nonce.byteLength)
        if (receivedNonce > relayMaxNonce) {
          // TODO: need to validate that client retries the same request and doesn't double-spend.
          // Note that this transaction is totally valid from the EVM's point of view
          reject(
            Error('Relay used a tx nonce higher than requested. Requested ' + relayMaxNonce + ' got ' + receivedNonce))
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
      if (!('' + error).match(/the tx doesn't have the correct nonce|known transaction/)) {
        console.log('broadcastTx: ', error || result)
      }

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
    const relayHub = await this.createRelayHubFromPaymaster(target)
    // note that the returned value is a promise too, returning BigNumber
    return relayHub.methods.balanceOf(target).call()
  }

  /**
   * Options include standard transaction params: from,to, gas_price, gas_limit
   * relay-specific params:
   *  pctRelayFee (override config.pctRelayFee)
   *  validateCanRelay - client calls canRelay before calling the relay the first time (defaults to true)
   *  paymaster - the contract that is compensating the relay for the gas (defaults to transaction destination 'to')
   * can also override default relayUrl, relayFee
   * return value is the same as from sendTransaction
   */
  async relayTransaction (encodedFunction, options) {
    const self = this

    // validateCanRelay defaults (in config). to disable, explicitly set options.validateCanRelay=false
    options = Object.assign({ validateCanRelay: this.config.validateCanRelay }, options)

    const paymaster = options.paymaster || options.to
    const relayHub = await this.createRelayHubFromPaymaster(paymaster)

    // TODO: refactor! wrong instance is created for accidentally same method!
    if (!utils.isSameAddress(paymaster, options.to)) {
      const recipientHub = await this.createPaymaster(options.to).methods.getHubAddr().call()

      if (!utils.isSameAddress(relayHub._address, recipientHub)) {
        throw Error('Paymaster\'s and recipient\'s RelayHub addresses do not match')
      }
    }

    const senderNonce = (await relayHub.methods.getNonce(options.from).call()).toString()

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

    // TODO: should add gas estimation for encodedFunction (tricky, since its not a real transaction)
    const gasLimit = this.config.force_gasLimit || options.gas_limit

    const blockNow = await this.web3.eth.getBlockNumber()
    const blockFrom = Math.max(1, blockNow - relayLookupLimitBlocks)
    const pinger = await this.serverHelper.newActiveRelayPinger(blockFrom, gasPrice)
    const errors = []
    let firstTry = true
    for (; ;) {
      const activeRelay = await pinger.nextRelay()
      if (!activeRelay) {
        const error = new Error('No relay responded! ' +
          pinger.relaysCount +
          ' attempted, ' +
          pinger.pingedRelays +
          ' pinged\nOther errors thrown during relay lookup:\n' +
          JSON.stringify(errors)
        )
        error.otherErrors = errors
        throw error
      }
      const relayAddress = activeRelay.RelayServerAddress
      const relayUrl = activeRelay.relayUrl
      const pctRelayFee = (options.pctRelayFee || activeRelay.pctRelayFee).toString()
      const baseRelayFee = (options.baseRelayFee || activeRelay.baseRelayFee).toString()
      const relayRequest = new RelayRequest({
        senderAddress: options.from,
        target: options.to,
        encodedFunction,
        senderNonce,
        pctRelayFee,
        baseRelayFee,
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        paymaster,
        relayHub: relayHub._address,
        relayAddress
      })

      if (this.web3.eth.getChainId === undefined) {
        throw new Error(`getChainId is undefined. Web3 version is ${this.web3.version}, minimum required is 1.2.2`)
      }
      const chainId = await this.web3.eth.getChainId()

      let signature
      let signedData
      // TODO: refactor so signedData is created regardless of ephemeral key used or not
      if (typeof self.ephemeralKeypair === 'object' && self.ephemeralKeypair !== null) {
        signedData = await getDataToSign({
          chainId,
          relayHub: relayHub._address,
          relayRequest
        })
        signature = sigUtil.signTypedData_v4(self.ephemeralKeypair.privateKey, { data: signedData })
      } else {
        const eip712Sig = await getEip712Signature(
          {
            web3: this.web3,
            methodSuffix: options.methodSuffix || '',
            jsonStringifyRequest: options.jsonStringifyRequest || false,
            relayHub: relayHub._address,
            chainId,
            relayRequest
          })
        signature = eip712Sig.signature
        signedData = eip712Sig.data
      }

      let approvalData = options.approvalData || '0x'
      if (typeof options.approveFunction === 'function') {
        approvalData = '0x' + await options.approveFunction({
          from: options.from,
          to: options.to,
          encodedFunctionCall: encodedFunction,
          pctRelayFee: options.pctRelayFee,
          gas_price: gasPrice,
          gas_limit: gasLimit,
          nonce: senderNonce,
          relay_hub_address: relayHub._address,
          relay_address: relayAddress
        })
      }

      if (self.config.verbose) {
        console.log('relayTransaction', 'from: ', options.from, 'sig: ', signature)
        const rec = sigUtil.recoverTypedSignature_v4({
          data: signedData,
          sig: signature
        })
        if (rec.toLowerCase() === options.from.toLowerCase()) {
          console.log('relayTransaction recovered:', rec, 'signature is correct')
        } else {
          console.error('relayTransaction recovered:', rec, 'signature error')
        }
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
        let res
        const paymasterContract = this.createPaymaster(paymaster)
        // TODO: validate this calculation in a test. Or, better, make '.encodeABI()' here with stub data.
        const relayCallExtraBytes = 32 * 8 // there are 8 parameters in RelayRequest now
        const calldataSize =
          signedData.message.encodedFunction.length +
          signature.length +
          approvalData.length +
          relayCallExtraBytes

        const gasLimits = await paymasterContract.methods.getGasLimits().call()
        const hubOverhead = parseInt(await relayHub.methods.getHubOverhead().call())
        const maxPossibleGas = utils.calculateTransactionMaxPossibleGas({
          gasLimits,
          hubOverhead,
          relayCallGasLimit: gasLimit,
          calldataSize,
          gtxdatanonzero: options.gtxdatanonzero || Environments.default.gtxdatanonzero
        })
        try {
          res = await relayHub.methods.canRelay(
            signedData.message,
            maxPossibleGas,
            gasLimits.acceptRelayedCallGasLimit,
            signature,
            approvalData
          ).call()
        } catch (e) {
          throw new Error('canRelay reverted (should not happen): ' + e)
        }
        if (res.status !== '0') {
          // in case of error, the context is an error message.
          const errorMsg = res.recipientContext ? Buffer.from(res.recipientContext.slice(2), 'hex').toString() : ''
          const status = canRelayStatus[res.status] || res.status
          throw new Error('canRelay failed: ' + status + ': ' + errorMsg)
        }
      }

      try {
        return await self.sendViaRelay({
          relayAddress,
          from: options.from,
          to: options.to,
          encodedFunction: encodedFunction,
          pctRelayFee,
          baseRelayFee,
          gasPrice,
          gasLimit,
          paymaster,
          senderNonce: senderNonce,
          signature,
          approvalData,
          relayUrl,
          relayHubAddress: relayHub._address,
          relayMaxNonce
        })
      } catch (error) {
        console.log('error??', error)
        errors.push(error)
        if (self.config.verbose) {
          console.log('relayTransaction: req:', {
            from: options.from,
            to: options.to,
            encodedFunctionCall: encodedFunction,
            pctRelayFee: options.pctRelayFee,
            baseRelayFee: options.baseRelayFee,
            gasPrice,
            gasLimit,
            nonce: senderNonce,
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

    const { pctRelayFee, baseRelayFee, gas, gasPrice } = params
    const relayOptions = {
      ...params,
      pctRelayFee: pctRelayFee || relayClientOptions.pctRelayFee,
      baseRelayFee: baseRelayFee || relayClientOptions.baseRelayFee,
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

  async createRelayHubFromPaymaster (paymasterAddress) {
    const relayRecipient = this.createPaymaster(paymasterAddress)

    let relayHubAddress
    try {
      relayHubAddress = await relayRecipient.methods.getHubAddr().call()
    } catch (err) {
      throw new Error(`Could not get relay hub address from paymaster at ${paymasterAddress} (${err.message}). Make sure it is a valid paymaster contract.`)
    }

    if (!relayHubAddress || ethUtils.isZeroAddress(relayHubAddress)) {
      throw new Error(`The relay hub address is set to zero in paymaster at ${paymasterAddress}. Make sure it is a valid paymaster contract.`)
    }

    const relayHub = this.createRelayHub(relayHubAddress)

    let hubVersion
    try {
      hubVersion = await relayHub.methods.version().call()
    } catch (err) {
      throw new Error(
        `Could not query relay hub version at ${relayHubAddress} (${err.message}). Make sure the address corresponds to a relay hub.`)
    }

    if (!hubVersion.startsWith('1')) {
      throw new Error(`Unsupported relay hub version '${hubVersion}'.`)
    }

    return relayHub
  }
}

module.exports = RelayClient
