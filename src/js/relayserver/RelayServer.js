const EventEmitter = require('events')
const Web3 = require('web3')
const abiDecoder = require('abi-decoder')
const abi = require('ethereumjs-abi')
// import { URL } from 'url'
// import querystring from 'querystring'
const RelayHubABI = require('../relayclient/interfaces/IRelayHub')
const utils = require('../relayclient/utils')
const getDataToSign = require('../relayclient/EIP712/Eip712Helper')

// const RelayHub = web3.eth.contract(RelayHubABI)
abiDecoder.addABI(RelayHubABI)

const VERSION = '0.0.1'
const minimumRelayBalance = 1e17 // 0.1 eth
const blockTimeMS = 10000
const DEBUG = true
const SPAM = false
const gtxdatanonzero = 68
const gtxdatazero = 4

function debug () {
  if (DEBUG) console.log(...arguments)
}

function spam () {
  if (SPAM) debug(...arguments)
}

class RelayServer extends EventEmitter {
  constructor (
    {
      keyManager,
      owner,
      hubAddress,
      url,
      txFee,
      gasPriceFactor,
      ethereumNodeUrl,
      web3provider,
      devMode
    }) {
    super()
    if (url === undefined) {
      url = 'http://localhost:8090'
    }
    Object.assign(this,
      {
        keyManager,
        owner,
        hubAddress,
        url,
        txFee,
        gasPriceFactor,
        ethereumNodeUrl,
        web3provider,
        devMode
      })
    this.web3 = new Web3(web3provider)
    this.address = keyManager.address()
    this.relayHubContract = new this.web3.eth.Contract(RelayHubABI, hubAddress)
    const relayHubTopics = Object.keys(this.relayHubContract.events).filter(x => (x.includes('0x')))
    this.topics = relayHubTopics.concat([['0x' + '0'.repeat(24) + this.address.slice(2)]])
    this.lastScannedBlock = 0
    this.ready = false
    this.removed = false
  }

  getMinGasPrice () {
    return this.gasPrice
  }

  isReady () {
    return this.ready && !this.removed
  }

  async createRelayTransaction (
    {
      encodedFunction,
      approvalData,
      signature,
      from,
      to,
      gasSponsor,
      gasPrice,
      gasLimit,
      senderNonce,
      relayMaxNonce,
      relayFee,
      relayHubAddress
    }) {
    // Check that the relayhub is the correct one
    if (relayHubAddress !== this.relayHubContract.options.address) {
      throw new Error(
        `Wrong hub address.\nRelay server\'s hub address: ${this.relayHubContract.options.address}, request\'s hub address: ${relayHubAddress}\n`)
    }

    // Check that the fee is acceptable
    if (relayFee < this.txFee) {
      throw new Error(`Unacceptable fee: ${relayFee}`)
    }

    // Check that the gasPrice is initialized & acceptable
    if (!this.gasPrice) {
      throw new Error('gasPrice not initialized')
    }
    if (this.gasPrice > gasPrice) {
      throw new Error(`Unacceptable gasPrice: ${gasPrice}`)
    }

    // Check that max nonce is valid
    if (this.nonce > relayMaxNonce) {
      throw new Error(`Unacceptable relayMaxNonce: ${relayMaxNonce}`)
    }

    // Check canRelay view function to see if we'll get paid for relaying this tx
    const signedData = getDataToSign({
      senderAccount: from,
      senderNonce,
      target: to,
      encodedFunction,
      pctRelayFee: relayFee,
      gasPrice,
      gasLimit,
      gasSponsor,
      relayHub: relayHubAddress,
      relayAddress: this.address
    })
    const canRelayRet = await this.relayHubContract.methods.canRelay(signedData.message, signature, approvalData).call()
    console.log('canRelayRet', canRelayRet)
    if (!canRelayRet || canRelayRet.status !== '0') {
      throw new Error('canRelayFailed on server:' + (canRelayRet ? canRelayRet.status : 'jsonrpc call failed'))
    }
    // TODO: Send relayed transaction
    const maxCharge = parseInt(
      await this.relayHubContract.methods.maxPossibleCharge(gasLimit, gasPrice, relayFee).call())
    const sponsorBalance = parseInt(await this.relayHubContract.methods.balanceOf(gasSponsor).call())
    if (sponsorBalance < maxCharge) {
      throw new Error(`sponsor balance too low: ${sponsorBalance}, maxCharge: ${maxCharge}`)
    }
    let requiredGas = parseInt(await this.relayHubContract.methods.requiredGas(gasLimit).call())
    requiredGas += this._correctGasCost(Buffer.from(encodedFunction.slice(2), 'hex'), gtxdatanonzero, gtxdatazero)
    requiredGas += this._correctGasCost(Buffer.from(approvalData.slice(2), 'hex'), gtxdatanonzero, gtxdatazero)
    console.log(`Estimated max charge of relayed tx: ${maxCharge}, GasLimit of relayed tx: ${requiredGas}`)
    const method = this.relayHubContract.methods.relayCall(signedData.message, signature, approvalData)
    const { receipt, signedTx } = await this._sendTransaction(
      { method, destination: relayHubAddress, gasLimit: requiredGas, gasPrice })
    return signedTx
  }

  start () {
    console.log('Subscribing to new blocks')
    this.subscription = this.web3.eth.subscribe('newBlockHeaders', function (error, result) {
      if (error) {
        console.error(error)
      }
    }).on('data', this._worker.bind(this)).on('error', console.error)
  }

  async stop () {
    this.subscription.unsubscribe(function (error, success) {
      if (success) {
        console.log('Successfully unsubscribed!')
      } else if (error) {
        throw error
      }
    })
  }

  async _worker (blockHeader) {
    this.gasPrice = (await this.web3.eth.getGasPrice()) * this.gasPriceFactor
    if (!this.gasPrice) {
      this.ready = false
      throw new Error('Could not get gasPrice from node')
    }
    this.balance = await this.web3.eth.getBalance(this.address)
    if (!this.balance || this.balance < minimumRelayBalance) {
      throw new Error(
        `Server\'s balance too low ( ${this.balance}, required ${minimumRelayBalance}). Waiting for funding...`)
    }
    const options = {
      fromBlock: this.lastScannedBlock + 1,
      toBlock: 'latest',
      address: this.relayHubContract.options.address,
      topics: [this.topics]
    }
    const logs = await this.web3.eth.getPastLogs(options)
    spam('logs?', logs)
    debug('options? ', options)
    const decodedLogs = abiDecoder.decodeLogs(logs).map(this._parseEvent)
    spam('decodedLogs?', decodedLogs)
    for (const dlog of decodedLogs) {
      switch (dlog.name) {
        case 'Staked':
          await this._handleStakedEvent(dlog)
          break
        case 'RelayRemoved':
          await this._handleRelayRemovedEvent(dlog)
          break
        case 'Unstaked':
          await this._handleUnstakedEvent(dlog)
          break
      }
    }
    if (logs[0] && logs[0].blockNumber) {
      this.lastScannedBlock = logs[logs.length - 1].blockNumber
    }
  }

  /**
   * This function initializes chainId, awaits for owner to fund and stake the relay,
   * and then sends the first registerRelay tx.
   * Must be called before start().
   * @returns {Promise<TransactionReceipt>}
   */
  async init () {
    if (!this.chainId) {
      this.chainId = await this.web3.eth.net.getId()
    }
    if (!this.chainId) {
      throw new Error('Could not get chainId from node')
    }
    if (this.devMode && this.chainId < 1000) {
      throw new Error('Don\'t use real network\'s chainId while on devMode.')
    }
    await this.waitForOwnerActions()
    // register on chain
    const registerMethod = this.relayHubContract.methods.registerRelay(this.txFee, this.url)
    const { receipt, } = await this._sendTransaction(
      { method: registerMethod, destination: this.relayHubContract.options.address })
    return receipt
  }

  async waitForOwnerActions () {
    while (!(await this.getStake())) {
      console.log('Waiting for stake...')
      await utils.sleep(blockTimeMS)
    }
    while (!(await this.getBalance()) || this.balance < minimumRelayBalance) {
      this.ready = false
      console.log(
        `Server\'s balance too low ( ${this.balance}, required ${minimumRelayBalance}). Waiting for funding...`)
      await utils.sleep(blockTimeMS)
    }
  }

  async getBalance () {
    this.balance = parseInt(await this.web3.eth.getBalance(this.address))
    return this.balance
  }

  async getStake () {
    const relayInfo = await this.relayHubContract.methods.getRelay(this.address).call()
    this.stake = relayInfo.totalStake
    if (!this.stake) {
      return 0
    }
    // first time getting stake, setting owner
    if (!this.owner) {
      this.owner = relayInfo.owner
      console.log(`Got staked for the first time. Owner: ${this.owner}. Stake: ${this.stake}`)

    }
    this.unstakeDelay = relayInfo.unstakeDelay
    this.unstakeTime = relayInfo.unstakeTime
    this.blockchainState = relayInfo.state

    return this.stake
  }

  async _handleRelayRemovedEvent (dlog) {
    // todo
    console.log('handle RelayRemoved event')
    // sanity checks
    if (dlog.name !== 'RelayRemoved' || dlog.args.relay.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event args ${dlog.args}`)
    }
    this.removed = true
    this.emit('removed')
  }

  async _handleStakedEvent (dlog) {
    // todo
    console.log('handle relay staked')
  }

  async _handleUnstakedEvent (dlog) {
    // todo: send balance to owner
    console.log('handle Unstaked event')
    // sanity checks
    if (dlog.name !== 'Unstaked' || dlog.args.relay.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event args ${dlog.args}`)
    }
    this.balance = await this.web3.eth.getBalance(this.address)
    const gasPrice = await this.web3.eth.getGasPrice()
    const gasLimit = 21000
    const { receipt, signedTx } = await this._sendTransaction({
      destination: this.owner,
      gasLimit,
      gasPrice,
      value: this.balance - gasLimit * gasPrice
    })
    this.emit('unstaked')
  }

  async _sendTransaction ({ method, destination, value, gasLimit, gasPrice }) {
    const encodedCall = method && method.encodeABI ? method.encodeABI() : ''
    gasPrice = gasPrice || await this.web3.eth.getGasPrice()
    gasPrice = parseInt(gasPrice)
    debug('gasPrice', gasPrice)
    const gas = (gasLimit && parseInt(gasLimit)) || await method.estimateGas({ from: this.address }) + 21000
    debug('gasLimit', gas)
    const nonce = await this.web3.eth.getTransactionCount(this.address)
    debug('nonce', nonce)
    const txToSign = {
      to: destination,
      value: value || 0,
      gasPrice: gasPrice,
      gas: gas,
      data: encodedCall ? Buffer.from(encodedCall.slice(2), 'hex') : Buffer.alloc(0),
      nonce
    }
    debug('txToSign', txToSign)
    const signedTx = this.keyManager.signTransaction(txToSign)
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx)
    console.log('\ntxhash is', receipt.transactionHash)
    return { receipt, signedTx }
  }

  _parseEvent (event) {
    if (!event || !event.events) {
      return 'not event: ' + event
    }
    const args = {}
    // event arguments is for some weird reason give as ".events"
    for (const eventArgument of event.events) {
      args[eventArgument.name] = eventArgument.value
    }
    return {
      name: event.name,
      address: event.address,
      args: args
    }
  }

  _correctGasCost (buffer, nonzerocost, zerocost) {
    let gasCost = 0
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) {
        gasCost += zerocost
      } else {
        gasCost += nonzerocost
      }
    }
    return gasCost
  }
}

module.exports = RelayServer
