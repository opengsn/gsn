const express = require('express')
const jsonrpc = require('jsonrpc-lite')
const bodyParser = require('body-parser')
const cors = require('cors')

class HttpServer {
  constructor ({ port, backend }) {
    this.port = port
    this.backend = backend
    this.app = express()
    this.app.use(cors())

    this.app.use(bodyParser.urlencoded({ extended: false }))
    this.app.use(bodyParser.json())

    console.log('setting handlers')
    this.app.post('/', this.rootHandler.bind(this))
    // TODO change all to jsonrpc
    this.app.post('/getaddr', this.pingHandler.bind(this))
    this.app.post('/relay', this.relayHandler.bind(this))
  }

  start () {
    if (!this.serverInstance) {
      this.serverInstance = this.app.listen(this.port, () => {
        console.log('listening on port', this.port)
      })
    }
    this.backend.start()
    this.backend.on('removed', this.stop.bind(this))
  }

  stop () {
    this.serverInstance.close()
    console.log('Http server stopped.\nShutting down relay...')
    this.backend('unstaked', this.close.bind(this))
  }

  close () {
    process.exit()
  }

  // TODO: use this when changing to jsonrpc
  async rootHandler (req, res) {
    let status
    try {
      let res
      let func
      if ((func = this.backend[req.body.method])) {
        res = await func.apply(this.backend, [req.body.params]) || { code: 200 }
      } else {
        throw Error(`Implementation of method ${req.body.params} not found on backend!`)
      }

      status = jsonrpc.success(req.body.id, res)
    } catch (e) {
      let stack = e.stack.toString()
      // remove anything after 'rootHandler'
      stack = stack.replace(/(rootHandler.*)[\s\S]*/, '$1')
      status = jsonrpc.error(req.body.id, new jsonrpc.JsonRpcError(stack, -125))
    }
    res.send(status)
  }

  async pingHandler (req, res) {
    const pingResponse = {
      relayServerAddress: this.backend.address,
      minGasPrice: this.backend.getMinGasPrice(),
      ready: this.backend.isReady(),
      version: this.backend.VERSION
    }
    res.send(pingResponse)
    console.log(`address ${this.backend.address} sent`)
  }

  async relayHandler (req, res) {
    if (!this.backend.isReady()) {
      res.send('Error: relay not ready')
      return
    }
    const signedTx = await this.backend.createRelayTransaction(req)
    res.send(signedTx)
  }
}

module.exports = HttpServer