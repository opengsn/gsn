import RelayClient from './RelayClient'
import RelayServer from '../relayserver/RelayServer'
import HttpServer from '../relayserver/HttpServer'
import { sleep } from '../common/utils'

const ow = require('ow')
const KeyManager = require('../relayserver/KeyManager')
const TxStoreManager = require('../relayserver/TxStoreManager').TxStoreManager
const RelayHubABI = require('../common/interfaces/IRelayHub')
const StakeManagerABI = require('../common/interfaces/IStakeManager')
const axios = require('axios')

const dayInSec = 24 * 60 * 60
const weekInSec = dayInSec * 7

// wait for relay until waitFuntion return true value, or until a timeout.
async function waitForRelay (url, timeout, waitFunction) {
  const timeoutTime = Date.now + timeout
  while (Date.now <= timeoutTime) {
    let res
    try {
      res = await axios.get(url)
    } catch (e) {
      res = e
    }
    const ret = waitFunction(res)
    if (ret) {
      return ret
    }
    await sleep(400)
  }
  throw new Error('timed-out')
}

export async function runServer ({
  web3provider,
  workdir = '/tmp/gsn.dev.provider',
  relayHub,
  relayUrl = 'http://localhost:8092',
  listenPort, // if not defined, extracted from relayUrl
  baseRelayFee = 0,
  pctRelayFee = 0,
  gasPriceFactor = 1,
  devMode = true
}) {
  // TODO: read key-pair from temp file?
  // (otherwise, we deploy a new relay each time)
  const keyManager = new KeyManager({ ecdsaKeyPair: KeyManager.newKeypair() })
  const txStoreManager = new TxStoreManager({ workdir })
  const relayServer = new RelayServer({
    web3provider,
    txStoreManager,
    keyManager,
    // owner: relayOwner,
    hubAddress: relayHub,
    url: relayUrl,
    baseRelayFee,
    pctRelayFee,
    gasPriceFactor,
    devMode
  })
  relayServer.on('error', (e) => {
    console.error('ERR:', e.message)
  })
  if (!listenPort) {
    const m = relayUrl.match(/(?:(https?):\/\/(\S+?)(?::(\d+))?)?$/)
    if (!m[0].startsWith('http')) {
      throw Error('invalid server URL protocol ' + m[0])
    }
    listenPort = m[3] ? m[3] : (m[0] === 'http' ? 80 : 443)
  }

  const httpServer = new HttpServer({
    port: listenPort,
    backend: relayServer
  })
  httpServer.start()
  return {
    httpServer,
    relayServer
  }
}

class DevRelayClient extends RelayClient {
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
    await this._initializeRelay()
    const preferredRelays = 'http://localhost:2345'
    return super.relayTransaction(encodedFunction, {
      preferredRelays,
      ...options
    })
  }

  // stop background relay
  stop () {
    if (!this.serverStarted) {
      return
    }
    if (this.httpServer) {
      this.httpServer.stop()
      this.httpServer = undefined
    }
    if (this.relayServer) {
      this.relayServer.stop()
      this.relayServer = undefined
    }
  }

  /**
   * initialize a local relay
   * @private
   */
  async _initializeRelay () {
    if (this.serverStarted) {
      return
    }

    // flag early, so only the first call will try to bring up a relay
    // (TODO: other calls should still wait for the relay to start)
    this.serverStarted = true

    const {
      relayOwner, workdir, relayHub, listenPort,
      baseRelayFee, pctRelayFee, gasPriceFactor, devMode
    } = this.config

    const relayUrl = this.config.relayUrl || 'http://localhost:8091'

    ow(relayHub, ow.string)
    ow(relayOwner, ow.string)
    const web3provider = this.web3.currentProvider
    const { httpServer, relayServer } = await runServer({
      web3provider,
      workdir,
      relayHub,
      relayUrl,
      listenPort, // if not defined, extracted from relayUrl
      baseRelayFee,
      pctRelayFee,
      gasPriceFactor,
      devMode
    })
    this.relayServer = relayServer
    this.httpServer = httpServer

    const hub = new this.web3.eth.Contract(RelayHubABI, relayHub)
    const stakeManagerAddress = await hub.methods.getStakeManager().call()
    const stakeManager = new this.web3.eth.Contract(StakeManagerABI, stakeManagerAddress)
    const estim = await stakeManager.methods.stakeForAddress(relayServer.address, weekInSec)
      .estimateGas({ value: 1e18 })
    this.debug('== staking relay gas estim:', estim)
    await stakeManager.methods.stakeForAddress(relayServer.address, weekInSec).send({
      from: relayOwner,
      value: 1e18,
      gas: estim
    })
    this.debug('== sending balance to relayServer', relayServer.address)
    await stakeManager.methods.authorizeHub(relayServer.address, relayHub).send({ from: relayOwner })
    await this.web3.eth.sendTransaction({
      from: relayOwner,
      to: relayServer.address,
      value: 1e18
    })
    this.debug('== waiting for relay')
    await waitForRelay(relayUrl + '/getaddr', 5000, (res) => {
      return res && res.data && res.data.Ready
    })
    this.debug('== relay ready')
  }

  debug (msg) {
    if (this.config.verbose) console.log(msg)
  }
}

module.exports = DevRelayClient
