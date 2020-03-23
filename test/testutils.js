const childProcess = require('child_process')

const Transaction = require('ethereumjs-tx')
const EthUtils = require('ethereumjs-util')

const HttpWrapper = require('../src/js/relayclient/HttpWrapper')

const localhostOne = 'http://localhost:8090'
const zeroAddr = '0'.repeat(40)

module.exports = {

  // start a background relay process.
  // rhub - relay hub contract
  // options:
  //  verbose: enable background process logging.
  //  stake, delay, pctRelayFee, url, relayOwner: parameters to pass to registerNewRelay, to stake and register it.
  //
  startRelay: async function (rhub, options) {
    // eslint-disable-next-line no-path-concat
    const server = __dirname + '/../build/server/bin/RelayHttpServer'

    options = options || {}
    const args = []
    args.push('-Workdir', './build/server')
    args.push('-DevMode')
    if (rhub) {
      args.push('-RelayHubAddress', rhub.address)
    }
    if (options.EthereumNodeUrl) {
      args.push('-EthereumNodeUrl', options.EthereumNodeUrl)
    }
    if (options.GasPricePercent) {
      args.push('-GasPricePercent', options.GasPricePercent)
    }
    if (options.pctRelayFee) {
      args.push('-PercentFee', options.pctRelayFee)
    }
    if (options.baseRelayFee) {
      args.push('-BaseFee', options.baseRelayFee)
    }
    const proc = childProcess.spawn(server, args)

    let relaylog = function () {
    }
    if (process.env.relaylog) { relaylog = (msg) => msg.split('\n').forEach(line => console.log('relay-' + proc.pid + '> ' + line)) }

    await new Promise((resolve, reject) => {
      let lastresponse
      const listener = data => {
        const str = data.toString().replace(/\s+$/, '')
        lastresponse = str
        relaylog(str)
        if (str.indexOf('Listening on port') >= 0) {
          proc.alreadystarted = 1
          resolve(proc)
        }
      }
      proc.stdout.on('data', listener)
      proc.stderr.on('data', listener)
      const doaListener = (code) => {
        if (!proc.alreadystarted) {
          relaylog('died before init code=' + code)
          reject(lastresponse)
        }
      }
      proc.on('exit', doaListener.bind(proc))
    })

    let res
    const http = new HttpWrapper()
    let count1 = 3
    while (count1-- > 0) {
      try {
        res = await http.sendPromise(localhostOne + '/getaddr')
        if (res) break
      } catch (e) {
        console.log('startRelay getaddr error', e)
      }
      console.log('sleep before cont.')
      await module.exports.sleep(1000)
    }
    assert.ok(res, 'can\'t ping server')
    const relayServerAddress = res.RelayServerAddress
    console.log('Relay Server Address', relayServerAddress)
    await web3.eth.sendTransaction({
      to: relayServerAddress,
      from: options.relayOwner,
      value: web3.utils.toWei('2', 'ether')
    })
    await rhub.stake(relayServerAddress, options.delay || 3600, {
      from: options.relayOwner,
      value: options.stake
    })

    // now ping server until it "sees" the stake and funding, and gets "ready"
    res = ''
    let count = 25
    while (count-- > 0) {
      res = await http.sendPromise(localhostOne + '/getaddr')
      if (res && res.Ready) break
      await module.exports.sleep(1500)
    }
    assert.ok(res.Ready, 'Timed out waiting for relay to get staked and registered')

    return proc
  },
  sleep: function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  stopRelay: function (proc) {
    proc && proc.kill()
  },

  registerNewRelay: async function ({
    relayHub,
    stake,
    delay,
    baseRelayFee,
    pctRelayFee,
    url,
    relayAccount,
    ownerAccount
  }) {
    await relayHub.stake(relayAccount, delay, {
      from: ownerAccount,
      value: stake
    })
    return relayHub.registerRelay(baseRelayFee, pctRelayFee, url, { from: relayAccount })
  },

  registerNewRelayWithPrivkey: async function ({
    relayHub,
    stake,
    delay,
    baseRelayFee,
    pctRelayFee,
    url,
    ownerAccount,
    web3,
    privKey
  }) {
    const address = '0x' + EthUtils.privateToAddress(privKey).toString('hex')
    await relayHub.stake(address, delay, {
      from: ownerAccount,
      value: stake
    })
    await web3.eth.sendTransaction({
      to: address,
      from: ownerAccount,
      value: web3.utils.toWei('1', 'ether')
    })
    const nonce = await web3.eth.getTransactionCount(address)
    const registerData = relayHub.contract.methods.registerRelay(baseRelayFee, pctRelayFee, url).encodeABI()
    const validTransaction = new Transaction({
      nonce: nonce,
      gasPrice: 1,
      gasLimit: 1000000,
      to: relayHub.address,
      value: 0,
      data: registerData
    })
    validTransaction.sign(privKey)
    const rawTx = '0x' + validTransaction.serialize().toString('hex')

    return new Promise((resolve, reject) => {
      web3.eth.sendSignedTransaction(rawTx, (err, res) => {
        if (err) {
          reject(err)
        } else {
          resolve(res)
        }
      })
    })
  },

  increaseTime: function (time) {
    return new Promise((resolve, reject) => {
      web3.currentProvider.send({
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [time],
        id: new Date().getSeconds()
      }, (err) => {
        if (err) return reject(err)
        module.exports.evmMine()
          .then(r => resolve(r))
          .catch(e => reject(e))
      })
    })
  },

  evmMineMany: async function (count) {
    for (let i = 0; i < count; i++) {
      await this.evmMine()
    }
  },

  evmMine: function () {
    return new Promise((resolve, reject) => {
      web3.currentProvider.send({
        jsonrpc: '2.0',
        method: 'evm_mine',
        params: [],
        id: new Date().getSeconds()
      }, (e, r) => {
        if (e) {
          reject(e)
        } else {
          resolve(r)
        }
      })
    })
  },

  /**
   * If ganache is run without '-b' parameter, reverted transaction return
   * error message instantly. Otherwise, revert will only occur once 'evm_mine'
   * is executed, and the error will be generated by truffle.
   *
   * @param {*} error - returned by web3 from RPC call
   * @param {*} errorMessage - expected error message
   */
  assertErrorMessageCorrect: function (error, errorMessage) {
    const blocktimeModeError = 'does not trigger a Solidity `revert` statement'
    if (!error || !error.message) {
      console.log('no error: ', error, 'expected:', errorMessage)
      assert.equals(errorMessage, error) // expected some error, got null
    }
    if (error.message.includes(errorMessage) || error.message.includes(blocktimeModeError)) { return true }
    console.log('invalid error message: ' + error.message + '\n(expected: ' + errorMessage + ')')
    assert.ok(false, 'invalid error message: ' + error.message + '\n(expected: ' + errorMessage + ')')
  },

  zeroAddr
}
