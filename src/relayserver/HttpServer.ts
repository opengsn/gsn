import express, { Express } from 'express'
import jsonrpc from 'jsonrpc-lite'
import bodyParser from 'body-parser'
import cors from 'cors'
import { RelayServer } from './RelayServer'
import { Server } from 'http'

export class HttpServer {
  app: Express
  private serverInstance: Server | undefined;
  constructor (private readonly port: number, private readonly backend: RelayServer) {
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

  start (): void {
    if (this.serverInstance === undefined) {
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

  stop (): void {
    this.serverInstance?.close()
    console.log('Http server stopped.\nShutting down relay...')
  }

  close (): void {
    console.log('Stopping relay worker...')
    this.backend.stop()
    // process.exit()
  }

  // TODO: use this when changing to jsonrpc
  async rootHandler (req: any, res: any): Promise<void> {
    let status
    try {
      let res
      // @ts-ignore
      const func = this.backend[req.body.method]
      // @ts-ignore
      if (func != null) {
        // @ts-ignore
        res = await func.apply(this.backend, [req.body.params]) ?? { code: 200 }
      } else {
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw Error(`Implementation of method ${req.body.params} not found on backend!`)
      }

      // @ts-ignore
      status = jsonrpc.success(req.body.id, res)
    } catch (e) {
      let stack = e.stack.toString()
      // remove anything after 'rootHandler'
      stack = stack.replace(/(rootHandler.*)[\s\S]*/, '$1')
      // @ts-ignore
      status = jsonrpc.error(req.body.id, new jsonrpc.JsonRpcError(stack, -125))
    }
    res.send(status)
  }

  pingHandler (req: any, res: any): void {
    const pingResponse = this.backend.pingHandler()
    res.send(pingResponse)
    console.log(`address ${pingResponse.RelayServerAddress} sent. ready: ${pingResponse.Ready}`)
  }

  async relayHandler (req: any, res: any): Promise<void> {
    if (!this.backend.isReady()) {
      res.send('Error: relay not ready')
      return
    }

    try {
      // @ts-ignore
      const signedTx = await this.backend.createRelayTransaction(req.body)
      res.send({ signedTx })
    } catch (e) {
      res.send({ error: e.message })
      console.log('tx failed:', e)
    }
  }
}

module.exports = HttpServer
