const EventEmitter = require('events')
const Web3 = require('web3')
const abiDecoder = require('abi-decoder')
const { Transaction } = require('ethereumjs-tx')
const ethUtils = require('ethereumjs-util')
const RelayHubABI = require('../common/interfaces/IRelayHub')
const PayMasterABI = require('../common/interfaces/IPaymaster')
const StakeManagerABI = require('../common/interfaces/IStakeManager')
const getDataToSign = require('../common/EIP712/Eip712Helper')
const RelayRequest = require('../common/EIP712/RelayRequest')
const utils = require('../common/utils')
const Environments = require('../relayclient/types/Environments')
const gtxdatanonzero = Environments.constantinople.gtxdatanonzero
const StoredTx = require('./TxStoreManager').StoredTx

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const VERSION = '0.0.1' // eslint-disable-line no-unused-vars
const minimumRelayBalance = 1e17 // 0.1 eth
const confirmationsNeeded = 12
const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
const maxGasPrice = 100e9
const GAS_RESERVE = 100000
const retryGasPriceFactor = 1.2
const DEBUG = false
const SPAM = false

function debug () {
  if (DEBUG) console.log(...arguments)
}

function spam () {
  if (SPAM) debug(...arguments)
}

class RelayServer extends EventEmitter {
  constructor (
    {
      txStoreManager,
      keyManager,
      owner,
      hubAddress,
      stakeManagerAddress,
      url,
      baseRelayFee,
      pctRelayFee,
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
        txStoreManager,
        keyManager,
        owner,
        hubAddress,
        stakeManagerAddress,
        url,
        baseRelayFee,
        pctRelayFee,
        gasPriceFactor,
        ethereumNodeUrl,
        web3provider,
        devMode
      })
    this.web3 = new Web3(web3provider)
    this.address = keyManager.address()
    this.stakeManagerContract = new this.web3.eth.Contract(StakeManagerABI, stakeManagerAddress)
    this.relayHubContract = new this.web3.eth.Contract(RelayHubABI, hubAddress)
    this.paymasterContract = new this.web3.eth.Contract(PayMasterABI)
    const stakeManagerTopics = [Object.keys(this.stakeManagerContract.events).filter(x => (x.includes('0x')))]
    this.topics = stakeManagerTopics.concat([['0x' + '0'.repeat(24) + this.address.slice(2)]])
    this.lastScannedBlock = 0
    this.ready = false
    this.removed = false
    this.nonce = 0
    debug('gasPriceFactor', gasPriceFactor)
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
      paymaster,
      gasPrice,
      gasLimit,
      senderNonce,
      relayMaxNonce,
      baseRelayFee,
      pctRelayFee,
      relayHubAddress
    }) {
    debug('dump request params', arguments[0])
    if (!encodedFunction) {
      throw new Error(`invalid encodedFunction given: ${encodedFunction}`)
    }
    if (!approvalData) {
      throw new Error(`invalid approvalData given: ${approvalData}`)
    }
    if (!signature) {
      throw new Error(`invalid signature given: ${signature}`)
    }
    // Check that the relayhub is the correct one
    if (relayHubAddress !== this.relayHubContract.options.address) {
      throw new Error(
        `Wrong hub address.\nRelay server's hub address: ${this.relayHubContract.options.address}, request's hub address: ${relayHubAddress}\n`)
    }

    // Check that the fee is acceptable
    if (isNaN(parseInt(pctRelayFee)) || parseInt(pctRelayFee) < this.pctRelayFee) {
      throw new Error(`Unacceptable pctRelayFee: ${pctRelayFee} relayServer's pctRelayFee: ${this.pctRelayFee}`)
    }
    if (isNaN(parseInt(baseRelayFee)) || parseInt(baseRelayFee) < this.baseRelayFee) {
      throw new Error(`Unacceptable baseRelayFee: ${baseRelayFee} relayServer's baseRelayFee: ${this.baseRelayFee}`)
    }

    // Check that the gasPrice is initialized & acceptable
    if (!this.gasPrice) {
      throw new Error('gasPrice not initialized')
    }
    if (this.gasPrice > gasPrice) {
      throw new Error(`Unacceptable gasPrice: relayServer's gasPrice:${this.gasPrice} request's gasPrice: ${gasPrice}`)
    }

    // Check that max nonce is valid
    const nonce = await this._pollNonce()
    if (nonce > relayMaxNonce) {
      throw new Error(`Unacceptable relayMaxNonce: ${relayMaxNonce}. current nonce: ${nonce}`)
    }

    // Check canRelay view function to see if we'll get paid for relaying this tx
    const relayRequest = new RelayRequest({
      senderAddress: from,
      senderNonce: senderNonce.toString(),
      target: to,
      encodedFunction,
      baseRelayFee: baseRelayFee.toString(),
      pctRelayFee: pctRelayFee.toString(),
      gasPrice: gasPrice.toString(),
      gasLimit: gasLimit.toString(),
      paymaster: paymaster,
      relayWorker: this.address
    })
    // TODO: should not use signedData at all. only the relayRequest.
    const signedData = getDataToSign({
      chainId: this.chainId,
      verifier: relayHubAddress,
      relayRequest
    })

    const relayCallExtraBytes = 32 * 8 // there are 8 parameters in RelayRequest now
    const calldataSize =
      (encodedFunction ? encodedFunction.length : 1) +
      signature.length +
      approvalData.length +
      relayCallExtraBytes
    debug('encodedFunction', encodedFunction, encodedFunction.length)
    debug('signature', signature, signature.length)
    debug('approvalData', approvalData, approvalData.length)

    let gasLimits
    try {
      this.paymasterContract.options.address = paymaster
      gasLimits = await this.paymasterContract.methods.getGasLimits().call()
    } catch (e) {
      if (
        e.message.includes(
          'Returned values aren\'t valid, did it run Out of Gas? You might also see this error if you are not using the correct ABI for the contract you are retrieving data from, requesting data from a block number that does not exist, or querying a node which is not fully synced.'
        )
      ) {
        throw new Error(`non-existent or incompatible paymaster contract: ${paymaster}`)
      }
      throw new Error(`unknown paymaster error: ${e.message}`)
    }

    const hubOverhead = parseInt(await this.relayHubContract.methods.getHubOverhead().call())
    const maxPossibleGas = utils.calculateTransactionMaxPossibleGas({
      gasLimits,
      hubOverhead,
      relayCallGasLimit: parseInt(gasLimit),
      calldataSize,
      gtxdatanonzero: gtxdatanonzero
    })

    let canRelayRet = await this.relayHubContract.methods.canRelay(
      signedData.message,
      maxPossibleGas,
      gasLimits.acceptRelayedCallGasLimit,
      signature,
      approvalData).call()
    debug('canRelayRet', canRelayRet)
    if (!canRelayRet) {
      canRelayRet = {}
    }
    if (!canRelayRet.success) {
      throw new Error('canRelay failed in server: ' + canRelayRet.returnValue)
    }
    // Send relayed transaction
    const method = this.relayHubContract.methods.relayCall(signedData.message, signature, approvalData)
    const requiredGas = maxPossibleGas + GAS_RESERVE
    debug('maxPossibleGas is', typeof maxPossibleGas, maxPossibleGas)
    debug('requiredGas is', typeof requiredGas, requiredGas)
    const maxCharge = parseInt(
      await this.relayHubContract.methods.calculateCharge(requiredGas, {
        gasPrice,
        pctRelayFee,
        baseRelayFee,
        gasLimit: 0
      }).call())
    const paymasterBalance = parseInt(await this.relayHubContract.methods.balanceOf(paymaster).call())
    if (paymasterBalance < maxCharge) {
      throw new Error(`paymaster balance too low: ${paymasterBalance}, maxCharge: ${maxCharge}`)
    }
    console.log(`Estimated max charge of relayed tx: ${maxCharge}, GasLimit of relayed tx: ${requiredGas}`)
    const { signedTx } = await this._sendTransaction(
      {
        method,
        destination: relayHubAddress,
        gasLimit: requiredGas,
        gasPrice
      })
    return signedTx
  }

  start () {
    console.log('Subscribing to new blocks')
    this.subscription = this.web3.eth.subscribe('newBlockHeaders', function (error, result) {
      if (error) {
        console.error(error)
      }
    }).on('data', this._workerSemaphore.bind(this)).on('error', console.error)
  }

  stop () {
    this.subscription.unsubscribe(function (error, success) {
      if (success) {
        console.log('Successfully unsubscribed!')
      } else if (error) {
        throw error
      }
    })
  }

  _workerSemaphore (blockHeader) {
    if (this._workerSemaphoreOn) {
      console.log('Different worker is not finished yet')
      return
    }
    this._workerSemaphoreOn = true
    this._worker(blockHeader)
      .then(() => {
        this._workerSemaphoreOn = false
      })
      .catch(() => {
        this._workerSemaphoreOn = false
      })
  }

  async _worker (blockHeader) {
    try {
      if (!this.chainId) {
        this.chainId = await this.web3.eth.getChainId()
      }
      if (!this.chainId) {
        this.ready = false
        throw new Error('Could not get chainId from node')
      }
      if (!this.networkId) {
        this.networkId = await this.web3.eth.net.getId()
      }
      if (!this.networkId) {
        this.ready = false
        throw new Error('Could not get networkId from node')
      }
      if (this.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
        console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
        process.exit(-1)
      }
      const gasPriceString = await this.web3.eth.getGasPrice()
      this.gasPrice = Math.floor(parseInt(gasPriceString) * this.gasPriceFactor)
      if (!this.gasPrice) {
        this.ready = false
        throw new Error('Could not get gasPrice from node')
      }
      await this.refreshBalance()
      if (!this.balance || this.balance < minimumRelayBalance) {
        this.ready = false
        throw new Error(
          `Server's balance too low ( ${this.balance}, required ${minimumRelayBalance}). Waiting for funding...`)
      }
      const options = {
        fromBlock: this.lastScannedBlock + 1,
        toBlock: 'latest',
        address: this.stakeManagerContract.options.address,
        topics: this.topics
      }
      const logs = await this.web3.eth.getPastLogs(options)
      spam('logs?', logs)
      spam('options? ', options)
      const decodedLogs = abiDecoder.decodeLogs(logs).map(this._parseEvent)
      let receipt
      // TODO: what about 'penalize' events? should send balance to owner, I assume
      // TODO TODO TODO 'StakeAdded' is not the event you want to cat upon if there was no 'HubAuthorized' event
      for (const dlog of decodedLogs) {
        switch (dlog.name) {
          case 'StakeAdded':
            receipt = await this._handleStakedEvent(dlog)
            break
          // There is no such event now
          // case 'RelayRemoved':
          //   await this._handleRelayRemovedEvent(dlog)
          //   break
          case 'StakeUnlocked':
            receipt = await this._handleUnstakedEvent(dlog)
            break
        }
      }
      if (!(await this.refreshStake())) {
        this.ready = false
        throw new Error('Waiting for stake...')
      }
      // todo check if registered!!
      // TODO: now even more todo then before. This is a hotfix.
      if (!this.isAddressAdded) {
        this.ready = false
        throw new Error('Not registered yet...')
      }
      this.lastScannedBlock = parseInt(blockHeader.number)
      console.log('READY!')
      this.ready = true
      await this._resendUnconfirmedTransactions(blockHeader)
      return receipt
    } catch (e) {
      this.emit('error', e)
      console.error('error in worker:', e.message)
    }
  }

  async refreshBalance () {
    this.balance = parseInt(await this.web3.eth.getBalance(this.address))
    return this.balance
  }

  async refreshStake () {
    const stakeInfo = await this.stakeManagerContract.methods.getStakeInfo(this.address).call()
    this.stake = parseInt(stakeInfo.stake)
    if (!this.stake) {
      return 0
    }
    // first time getting stake, setting owner
    if (!this.owner) {
      this.owner = stakeInfo.owner
      console.log(`Got staked for the first time. Owner: ${this.owner}. Stake: ${this.stake}`)
    }
    this.unstakeDelay = stakeInfo.unstakeDelay
    this.withdrawBlock = stakeInfo.withdrawBlock
    return this.stake
  }

  async _handleRelayRemovedEvent (dlog) {
    // todo
    console.log('handle RelayRemoved event')
    // sanity checks
    if (dlog.name !== 'RelayRemoved' || dlog.args.relay.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    this.removed = true
    this.emit('removed')
  }

  async _handleStakedEvent (dlog) {
    // todo
    console.log('handle relay staked. Registering relay...')
    // sanity checks
    if (dlog.name !== 'StakeAdded' || dlog.args.relayManager.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    // register on chain
    const addRelayWorkerMethod = this.relayHubContract.methods.addRelayWorkers([this.address])
    await this._sendTransaction(
      {
        method: addRelayWorkerMethod,
        destination: this.relayHubContract.options.address
      })
    const registerMethod = this.relayHubContract.methods.registerRelayServer(this.baseRelayFee, this.pctRelayFee, this.url)
    const { receipt } = await this._sendTransaction(
      {
        method: registerMethod,
        destination: this.relayHubContract.options.address
      })
    console.log(`Relay ${this.address} registered on hub ${this.relayHubContract.options.address}. `)
    this.isAddressAdded = true
    return receipt
  }

  async _handleUnstakedEvent (dlog) {
    // todo: send balance to owner
    console.log('handle Unstaked event', dlog)
    // sanity checks
    if (dlog.name !== 'StakeUnlocked' || dlog.args.relayManager.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    this.balance = await this.web3.eth.getBalance(this.address)
    const gasPrice = await this.web3.eth.getGasPrice()
    const gasLimit = 21000
    console.log(`Sending balance ${this.balance} to owner`)
    if (this.balance < gasLimit * gasPrice) {
      throw new Error(`balance too low: ${this.balance}, tx cost: ${gasLimit * gasPrice}`)
    }
    const { receipt } = await this._sendTransaction({
      destination: this.owner,
      gasLimit,
      gasPrice,
      value: this.balance - gasLimit * gasPrice
    })
    this.emit('unstaked')
    return receipt
  }

  async _resendUnconfirmedTransactions (blockHeader) {
    // Load unconfirmed transactions from store, and bail if there are none
    let sortedTxs = await this.txStoreManager.getAll()
    if (sortedTxs.length === 0) {
      return
    }
    console.log('resending unconfirmed transactions')
    // Get nonce at confirmationsNeeded blocks ago
    const confirmedBlock = blockHeader.number - confirmationsNeeded
    let nonce = await this.web3.eth.getTransactionCount(this.address, confirmedBlock)
    debug(
      `Removing confirmed txs until nonce ${nonce - 1}. confirmedBlock: ${confirmedBlock}. block number: ${blockHeader.number}`)
    // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
    await this.txStoreManager.removeTxsUntilNonce({ nonce: nonce - 1 })

    // Load unconfirmed transactions from store again
    sortedTxs = await this.txStoreManager.getAll()
    if (sortedTxs.length === 0) {
      return
    }

    // Check if the tx was mined by comparing its nonce against the latest one
    nonce = await this.web3.eth.getTransactionCount(this.address)
    if (sortedTxs[0].nonce < nonce) {
      console.log('awaiting confirmations for next mined transaction', nonce, sortedTxs[0].nonce, sortedTxs[0].txId)
      return
    }

    // If the tx is still pending, check how long ago we sent it, and resend it if needed
    if (Date.now() - (new Date(sortedTxs[0].createdAt)).getTime() < pendingTransactionTimeout) {
      spam(Date.now(), (new Date()), (new Date()).getTime())
      spam(sortedTxs[0].createdAt, (new Date(sortedTxs[0].createdAt)), (new Date(sortedTxs[0].createdAt)).getTime())
      console.log('awaiting transaction', sortedTxs[0].txId, 'to be mined. nonce:', nonce)
      return
    }
    const { receipt, signedTx } = await this._resendTransaction({ tx: sortedTxs[0] })
    console.log('resent transaction', sortedTxs[0].nonce, sortedTxs[0].txId, 'as',
      receipt.transactionHash)
    if (sortedTxs[0].attempts > 2) {
      console.log(`Sent tx ${sortedTxs[0].attempts} times already`)
    }
    return signedTx
  }

  async _sendTransaction ({ method, destination, value, gasLimit, gasPrice }) {
    const encodedCall = method && method.encodeABI ? method.encodeABI() : ''
    gasPrice = gasPrice || await this.web3.eth.getGasPrice()
    gasPrice = parseInt(gasPrice)
    debug('gasPrice', gasPrice)
    const gas = (gasLimit && parseInt(gasLimit)) || await method.estimateGas({ from: this.address }) + 21000
    debug('gasLimit', gas)
    const nonce = await this._pollNonce()
    debug('nonce', nonce)
    // TODO: change to eip155 chainID
    const txToSign = new Transaction({
      from: this.address,
      to: destination,
      value: value || 0,
      gas,
      gasPrice,
      data: encodedCall ? Buffer.from(encodedCall.slice(2), 'hex') : Buffer.alloc(0),
      nonce
    })
    spam('txToSign', txToSign)
    const signedTx = this.keyManager.signTransaction(txToSign)
    const storedTx = new StoredTx({
      from: txToSign.from,
      to: txToSign.to,
      value: txToSign.value,
      gas: txToSign.gas,
      gasPrice: txToSign.gasPrice,
      data: txToSign.data,
      nonce: txToSign.nonce,
      txId: ethUtils.bufferToHex(txToSign.hash()),
      attempts: 1
    })
    await this.txStoreManager.putTx({ tx: storedTx })
    this.nonce++
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx)
    console.log('\ntxhash is', receipt.transactionHash)
    if (receipt.transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${receipt.transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      receipt,
      signedTx
    }
  }

  async _resendTransaction ({ tx }) {
    // Calculate new gas price as a % increase over the previous one
    let newGasPrice = parseInt(tx.gasPrice * retryGasPriceFactor)
    // Sanity check to ensure we are not burning all our balance in gas fees
    if (newGasPrice > maxGasPrice) {
      console.log('Capping gas price to max value of', maxGasPrice)
      newGasPrice = maxGasPrice
    }
    // Resend transaction with exactly the same values except for gas price
    const txToSign = new Transaction({
      from: tx.from,
      to: tx.to,
      value: tx.value,
      gas: tx.gas,
      gasPrice: newGasPrice,
      data: tx.data,
      nonce: tx.nonce
    })
    spam('txToSign', txToSign)
    // TODO: change to eip155 chainID
    const signedTx = this.keyManager.signTransaction(txToSign)
    const storedTx = new StoredTx({
      from: txToSign.from,
      to: txToSign.to,
      value: txToSign.value,
      gas: txToSign.gas,
      gasPrice: txToSign.gasPrice,
      data: txToSign.data,
      nonce: txToSign.nonce,
      txId: ethUtils.bufferToHex(txToSign.hash()),
      attempts: tx.attempts + 1
    })
    await this.txStoreManager.putTx({ tx: storedTx })
    debug('resending tx with nonce', txToSign.nonce)
    debug('account nonce', await this.web3.eth.getTransactionCount(this.address))
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx)
    console.log('\ntxhash is', receipt.transactionHash)
    if (receipt.transactionHash.toLowerCase() !== storedTx.txId.toLowerCase()) {
      throw new Error(`txhash mismatch: from receipt: ${receipt.transactionHash} from txstore:${storedTx.txId}`)
    }
    return {
      receipt,
      signedTx
    }
  }

  async _pollNonce () {
    const nonce = await this.web3.eth.getTransactionCount(this.address, 'pending')
    if (nonce > this.nonce) {
      this.nonce = nonce
    }
    return this.nonce
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
}

module.exports = RelayServer
