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
    this.app.get('/getaddr', this.pingHandler.bind(this))
    this.app.post('/relay', this.relayHandler.bind(this))
    this.backend.once('removed', this.stop.bind(this))
    this.backend.once('unstaked', this.close.bind(this))
    this.backend.on('error', (e) => { console.error('httpServer:', e) })
  }

  start () {
    if (!this.serverInstance) {
      this.serverInstance = this.app.listen(this.port, () => {
        console.log('Listening on port', this.port)
      })
    }
    try {
      this.backend.start()
      console.log('Relay worker started.')
    } catch (e) {
      console.log('relay task error', e)
    }
  }

  stop () {
    this.serverInstance.close()
    console.log('Http server stopped.\nShutting down relay...')
  }

  close () {
    console.log('Stopping relay worker...')
    this.backend.stop()
    // process.exit()
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
    const pingResponse = this.backend.pingHandler()
    res.send(pingResponse)
    console.log(`address ${pingResponse.RelayServerAddress} sent. ready: ${pingResponse.Ready}`)
  }

  async relayHandler (req, res) {
    if (!this.backend.isReady()) {
      res.send('Error: relay not ready')
      return
    }

    try {
      const signedTx = await this.backend.createRelayTransaction(req.body)
      res.send({ signedTx })
    } catch (e) {
      res.send({ error: e.message })
      console.log('tx failed:', e)
    }
  }
}

module.exports = HttpServer
