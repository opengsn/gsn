const ow = require('ow')

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
/*
cannot read TS module if executed by node. Use ts-node to run or, better, fix.
const Environments = require('../relayclient/types/Environments').environments
const gtxdatanonzero = Environments.constantinople.gtxdatanonzero
 */
const gtxdatanonzero = 16
const StoredTx = require('./TxStoreManager').StoredTx
const Mutex = require('async-mutex').Mutex

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(StakeManagerABI)

const VERSION = '0.0.1' // eslint-disable-line no-unused-vars
const minimumRelayBalance = 1e17 // 0.1 eth
const defaultWorkerMinBalance = 0.01e18
const defaultWorkerTargetBalance = 0.3e18
const confirmationsNeeded = 12
const pendingTransactionTimeout = 5 * 60 * 1000 // 5 minutes in milliseconds
const maxGasPrice = 100e9
const GAS_RESERVE = 100000
const retryGasPriceFactor = 1.2
const DEBUG = false
const SPAM = false

const toBN = Web3.utils.toBN

function debug () {
  if (DEBUG) console.log(...arguments)
}

function spam () {
  if (SPAM) debug(...arguments)
}

class StateError extends Error {}

class RelayServer extends EventEmitter {
  constructor (
    {
      txStoreManager,
      keyManager,
      owner,
      hubAddress,
      url,
      baseRelayFee,
      pctRelayFee,
      gasPriceFactor,
      web3provider,
      workerMinBalance = defaultWorkerMinBalance,
      workerTargetBalance = defaultWorkerTargetBalance,
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
        url,
        baseRelayFee,
        pctRelayFee,
        gasPriceFactor,
        web3provider,
        workerMinBalance,
        workerTargetBalance,
        devMode
      })
    this.web3 = new Web3(web3provider)
    this.relayHubContract = new this.web3.eth.Contract(RelayHubABI, hubAddress)

    this.paymasterContract = new this.web3.eth.Contract(PayMasterABI)
    this.lastScannedBlock = 0
    this.ready = false
    this.removed = false
    this.nonceMutex = new Mutex()

    // todo: initialize nonces for all signers (currently one manager, one worker)
    this.nonces = { 0: 0, 1: 0 }

    this.keyManager.generateKeys(2)
    this.managerAddress = keyManager.getAddress(0)

    debug('gasPriceFactor', gasPriceFactor)
  }

  getManagerAddress () {
    return this.managerAddress
  }

  // index zero is not a worker, but the manager.
  getAddress (index) {
    ow(index, ow.number)
    return this.keyManager.getAddress(index)
  }

  getMinGasPrice () {
    return this.gasPrice
  }

  isReady () {
    return this.ready && !this.removed
  }

  pingHandler () {
    return {
      RelayServerAddress: this.getAddress(1),
      RelayManagerAddress: this.managerAddress,
      RelayHubAddress: this.relayHubContract.options.address,
      MinGasPrice: this.getMinGasPrice(),
      Ready: this.isReady(),
      Version: this.VERSION
    }
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

    // TODO: currently we hard-code a single worker. should find a "free" one to use from a pool
    const workerIndex = 1

    // TODO: should replenish earlier, so client can validate the worker has funds to pay for the tx
    await this.replenishWorker(1)

    // Check that max nonce is valid
    const nonce = await this._pollNonce(workerIndex)
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
      relayWorker: this.getAddress(1)
    })
    // TODO: should not use signedData at all. only the relayRequest.
    const signedData = getDataToSign({
      chainId: this.chainId,
      verifier: relayHubAddress,
      relayRequest
    })
    const method = this.relayHubContract.methods.relayCall(signedData.message, signature, approvalData)
    const calldataSize = method.encodeABI().length / 2
    debug('calldatasize', calldataSize)
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
    const maxPossibleGas = GAS_RESERVE + utils.calculateTransactionMaxPossibleGas({
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
      approvalData).call({ from: this.getAddress(workerIndex) })
    debug('canRelayRet', canRelayRet)
    if (!canRelayRet) {
      canRelayRet = {}
    }
    if (!canRelayRet.success) {
      throw new Error('canRelay failed in server: ' + canRelayRet.returnValue)
    }
    // Send relayed transaction
    debug('maxPossibleGas is', typeof maxPossibleGas, maxPossibleGas)
    const maxCharge = parseInt(
      await this.relayHubContract.methods.calculateCharge(maxPossibleGas, {
        gasPrice,
        pctRelayFee,
        baseRelayFee,
        gasLimit: 0
      }).call())
    const paymasterBalance = parseInt(await this.relayHubContract.methods.balanceOf(paymaster).call())
    if (paymasterBalance < maxCharge) {
      throw new Error(`paymaster balance too low: ${paymasterBalance}, maxCharge: ${maxCharge}`)
    }
    debug(`Estimated max charge of relayed tx: ${maxCharge}, GasLimit of relayed tx: ${maxPossibleGas}`)
    const { signedTx } = await this._sendTransaction(
      {
        signerIndex: workerIndex,
        method,
        destination: relayHubAddress,
        gasLimit: maxPossibleGas,
        gasPrice
      })
    // after sending a transaction is a good time to check the worker's balance, and replenish it.
    await this.replenishWorker(1)
    return signedTx
  }

  start () {
    debug('Subscribing to new blocks')
    this.subscription = this.web3.eth.subscribe('newBlockHeaders', (error, result) => {
      if (error) {
        console.error('web3 subscription:', error)
      }
    }).on('data', this._workerSemaphore.bind(this)).on('error', (e) => { console.error('worker:', e) })
    setTimeout(() => { this._workerSemaphore.bind(this)({ number: 1 }) }, 1)
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
      debug('Different worker is not finished yet')
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

  fatal (message) {
    console.error('FATAL: ' + message)
    process.exit(1)
  }

  async _init () {
    const relayHubAddress = this.relayHubContract.options.address
    console.log('Server address', this.managerAddress)
    const code = await this.web3.eth.getCode(relayHubAddress)
    if (code.length < 10) {
      this.fatal(`No RelayHub deployed at address ${relayHubAddress}.`)
    }
    const version = await this.relayHubContract.methods.getVersion().call().catch(e => 'no getVersion() method')
    if (version !== '1.0.0') {
      this.fatal(`Not a valid RelayHub at ${relayHubAddress}: version: ${version}`)
    }
    const stakeManagerAddress = await this.relayHubContract.methods.getStakeManager().call()
    this.stakeManagerContract = new this.web3.eth.Contract(StakeManagerABI, stakeManagerAddress)
    const stakeManagerTopics = [Object.keys(this.stakeManagerContract.events).filter(x => (x.includes('0x')))]
    this.topics = stakeManagerTopics.concat([['0x' + '0'.repeat(24) + this.managerAddress.slice(2)]])

    this.chainId = await this.web3.eth.getChainId()
    this.networkId = await this.web3.eth.net.getId()
    if (this.devMode && (this.chainId < 1000 || this.networkId < 1000)) {
      console.log('Don\'t use real network\'s chainId & networkId while in devMode.')
      process.exit(-1)
    }
    this.initialized = true
  }

  async replenishWorker (workerIndex) {
    const workerAddress = this.getAddress(workerIndex)
    const workerBalance = toBN(await this.web3.eth.getBalance(workerAddress))
    if (workerBalance.lt(toBN(this.workerMinBalance))) {
      const refill = toBN(this.workerTargetBalance).sub(workerBalance)
      console.log(`== replenishWorker(${workerIndex}): mgr balance=${this.balance.toString() / 1e18} worker balance=${workerBalance.toString() / 1e18} refill=${refill.toString() / 1e18}`)
      if (refill.lt(this.balance.sub(toBN(minimumRelayBalance)))) {
        await this._sendTransaction({
          signerIndex: 0,
          destination: workerAddress,
          value: refill,
          gasLimit: 300000
          // gasPrice:1
        })
        this.refreshBalance()
      } else {
        console.log(`== replenishWorker: can't replenish: mgr balance too low ${this.balance.toString() / 1e18} refil=${refill.toString() / 1e18}`)
      }
    }
  }

  async _worker (blockHeader) {
    try {
      if (!this.initialized) {
        await this._init()
      }
      const gasPriceString = await this.web3.eth.getGasPrice()
      this.gasPrice = Math.floor(parseInt(gasPriceString) * this.gasPriceFactor)
      if (!this.gasPrice) {
        throw new StateError('Could not get gasPrice from node')
      }
      await this.refreshBalance()
      if (!this.balance || this.balance.lt(toBN(minimumRelayBalance))) {
        throw new StateError(
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
          case 'HubAuthorized':
            receipt = await this._handleHubAuthorizedEvent(dlog)
            break
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

      if (!this.stake) {
        throw new StateError('Waiting for stake')
      }
      // todo check if registered!!
      // TODO: now even more todo then before. This is a hotfix.
      if (!this.isAddressAdded) {
        throw new StateError('Not registered yet...')
      }
      this.lastScannedBlock = parseInt(blockHeader.number)
      if (!this.state) {
        console.log('Relay is Ready.')
      }
      this.ready = true
      delete this.lastError
      await this._resendUnconfirmedTransactions(blockHeader)
      return receipt
    } catch (e) {
      if (e instanceof StateError) {
        if (e.message !== this.lastError) {
          this.lastError = e.message
          console.log('worker: ', this.lastError)
          this.ready = false
        }
      } else {
        this.emit('error', e)
        console.error('error in worker:', e)
      }
    }
  }

  async refreshBalance () {
    this.balance = toBN(await this.web3.eth.getBalance(this.managerAddress))
    return this.balance
  }

  async refreshStake () {
    if (!this.initialized) {
      await this._init()
    }
    const stakeInfo = await this.stakeManagerContract.methods.getStakeInfo(this.managerAddress).call()
    this.stake = parseInt(stakeInfo.stake)
    if (!this.stake) {
      return 0
    }
    // first time getting stake, setting owner
    if (!this.owner) {
      this.owner = stakeInfo.owner
      debug(`Got staked for the first time. Owner: ${this.owner}. Stake: ${this.stake}`)
    }
    this.unstakeDelay = stakeInfo.unstakeDelay
    this.withdrawBlock = stakeInfo.withdrawBlock
    return this.stake
  }

  async _handleRelayRemovedEvent (dlog) {
    // todo
    console.log('handle RelayRemoved event')
    // sanity checks
    if (dlog.name !== 'RelayRemoved' || dlog.args.relay.toLowerCase() !== this.managerAddress.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    this.removed = true
    this.emit('removed')
  }

  async _handleHubAuthorizedEvent (dlog) {
    if (dlog.name !== 'HubAuthorized' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    if (dlog.args.relayHub.toLowerCase() === this.relayHubContract.options.address.toLowerCase()) {
      this.authorizedHub = true
    }

    return this._registerIfNeeded()
  }

  async _handleStakedEvent (dlog) {
    // todo
    // sanity checks
    if (dlog.name !== 'StakeAdded' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    await this.refreshStake()

    return this._registerIfNeeded()
  }

  async _registerIfNeeded () {
    if (!this.authorizedHub || !this.stake) {
      debug(`can't register yet: auth=${this.authorizedHub} stake=${this.stake}`)
      return
    }

    const workersAddedEvents = await this.relayHubContract.getPastEvents('RelayWorkersAdded', {
      fromBlock: 1,
      filter: { relayManager: this.managerAddress }
    })

    // add worker only if not already added
    if (!workersAddedEvents.find(e => e.returnValues.newRelayWorkers.map(a => a.toLowerCase()).includes(this.managerAddress.toLowerCase()))) {
      // register on chain
      const addRelayWorkerMethod = this.relayHubContract.methods.addRelayWorkers([this.getAddress(1)])
      await this._sendTransaction(
        {
          signerIndex: 0,
          method: addRelayWorkerMethod,
          destination: this.relayHubContract.options.address
        })
    }
    const registerMethod = this.relayHubContract.methods.registerRelayServer(this.baseRelayFee, this.pctRelayFee,
      this.url)
    const { receipt } = await this._sendTransaction(
      {
        signerIndex: 0,
        method: registerMethod,
        destination: this.relayHubContract.options.address
      })
    debug(`Relay ${this.managerAddress} registered on hub ${this.relayHubContract.options.address}. `)

    this.isAddressAdded = true
    return receipt
  }

  async _handleUnstakedEvent (dlog) {
    // todo: send balance to owner
    console.log('handle Unstaked event', dlog)
    // sanity checks
    if (dlog.name !== 'StakeUnlocked' || dlog.args.relayManager.toLowerCase() !== this.managerAddress.toLowerCase()) {
      throw new Error(`PANIC: handling wrong event ${dlog.name} or wrong event relay ${dlog.args.relay}`)
    }
    this.balance = toBN(await this.web3.eth.getBalance(this.managerAddress))
    const gasPrice = await this.web3.eth.getGasPrice()
    const gasLimit = 21000
    console.log(`Sending balance ${this.balance} to owner`)
    if (this.balance < gasLimit * gasPrice) {
      throw new Error(`balance too low: ${this.balance}, tx cost: ${gasLimit * gasPrice}`)
    }
    const { receipt } = await this._sendTransaction({
      signerIndex: 0,
      destination: this.owner,
      gasLimit,
      gasPrice,
      value: this.balance.sub(toBN(gasLimit * gasPrice))
    })
    this.emit('unstaked')
    return receipt
  }

  /**
   * resend Txs of all signers (manager, workers)
   * @return the receipt from the first request
   */
  async _resendUnconfirmedTransactions (blockHeader) {
    // repeat separately for each signer (manager, all workers)
    let receipt;
    [0, 1].forEach(signerIndex => {
      const ret = this._resendUnconfirmedTransactionsForSigner(blockHeader, signerIndex)
      if (ret) {
        receipt = ret
      }
    })
    return receipt
  }

  async _resendUnconfirmedTransactionsForSigner (blockHeader, signerIndex) {
    const signer = this.getAddress(signerIndex)
    // Load unconfirmed transactions from store, and bail if there are none
    let sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return
    }
    debug('resending unconfirmed transactions')
    // Get nonce at confirmationsNeeded blocks ago
    const confirmedBlock = blockHeader.number - confirmationsNeeded
    let nonce = await this.web3.eth.getTransactionCount(signer, confirmedBlock)
    debug(
      `resend ${signerIndex}: Removing confirmed txs until nonce ${nonce - 1}. confirmedBlock: ${confirmedBlock}. block number: ${blockHeader.number}`)
    // Clear out all confirmed transactions (ie txs with nonce less than the account nonce at confirmationsNeeded blocks ago)
    await this.txStoreManager.removeTxsUntilNonce({ signer, nonce: nonce - 1 })

    // Load unconfirmed transactions from store again
    sortedTxs = await this.txStoreManager.getAllBySigner(signer)
    if (sortedTxs.length === 0) {
      return
    }
    // Check if the tx was mined by comparing its nonce against the latest one
    nonce = await this.web3.eth.getTransactionCount(signer)
    if (sortedTxs[0].nonce < nonce) {
      debug('resend', signerIndex, ': awaiting confirmations for next mined transaction', nonce, sortedTxs[0].nonce, sortedTxs[0].txId)
      return
    }

    // If the tx is still pending, check how long ago we sent it, and resend it if needed
    if (Date.now() - (new Date(sortedTxs[0].createdAt)).getTime() < pendingTransactionTimeout) {
      spam(Date.now(), (new Date()), (new Date()).getTime())
      spam(sortedTxs[0].createdAt, (new Date(sortedTxs[0].createdAt)), (new Date(sortedTxs[0].createdAt)).getTime())
      debug('resend', signerIndex, ': awaiting transaction', sortedTxs[0].txId, 'to be mined. nonce:', nonce)
      return
    }
    const { receipt, signedTx } = await this._resendTransaction({ tx: sortedTxs[0] })
    debug('resent transaction', sortedTxs[0].nonce, sortedTxs[0].txId, 'as',
      receipt.transactionHash)
    if (sortedTxs[0].attempts > 2) {
      debug(`resend ${signerIndex}: Sent tx ${sortedTxs[0].attempts} times already`)
    }
    return signedTx
  }

  // signerIndex is the index into addresses array. zero is relayManager, the rest are workers
  async _sendTransaction ({ signerIndex, method, destination, value, gasLimit, gasPrice }) {
    const encodedCall = method && method.encodeABI ? method.encodeABI() : ''
    gasPrice = gasPrice || await this.web3.eth.getGasPrice()
    gasPrice = parseInt(gasPrice)
    debug('gasPrice', gasPrice)
    const gas = (gasLimit && parseInt(gasLimit)) || (method && await method.estimateGas({ from: this.managerAddress }))
    debug('gasLimit', gas)
    debug('nonceMutex locked?', this.nonceMutex.isLocked())
    const releaseMutex = await this.nonceMutex.acquire()
    let signedTx
    let storedTx
    try {
      const nonce = await this._pollNonce(signerIndex)
      debug('nonce', nonce)
      // TODO: change to eip155 chainID
      const signer = this.getAddress(signerIndex)
      const txToSign = new Transaction({
        from: signer,
        to: destination,
        value: value || 0,
        gas,
        gasPrice,
        data: encodedCall ? Buffer.from(encodedCall.slice(2), 'hex') : Buffer.alloc(0),
        nonce
      })
      spam('txToSign', txToSign)
      signedTx = this.keyManager.signTransaction(signer, txToSign)
      storedTx = new StoredTx({
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
      this.nonces[signerIndex]++
      await this.txStoreManager.putTx({ tx: storedTx })
    } finally {
      releaseMutex()
    }
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx)
    debug('\ntxhash is', receipt.transactionHash)
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
      debug('Capping gas price to max value of', maxGasPrice)
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
    const signedTx = this.keyManager.signTransaction(tx.from, txToSign)
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
    await this.txStoreManager.putTx({ tx: storedTx, updateExisting: true })

    debug('resending tx with nonce', txToSign.nonce, 'from', tx.from)
    debug('account nonce', await this.web3.eth.getTransactionCount(tx.from))
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

  async _pollNonce (signerIndex) {
    const signer = this.getAddress(signerIndex)
    const nonce = await this.web3.eth.getTransactionCount(signer, 'pending')
    if (nonce > this.nonces[signerIndex]) {
      debug('NONCE FIX for index=', signerIndex, 'signer=', signer, ': nonce=', nonce, this.nonces[signerIndex])
      this.nonces[signerIndex] = nonce
    }
    return nonce
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
