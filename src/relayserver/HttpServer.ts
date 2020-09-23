import express, { Express } from 'express'
import jsonrpc from 'jsonrpc-lite'
import bodyParser from 'body-parser'
import cors from 'cors'
import { RelayServer } from './RelayServer'
import { Server } from 'http'
import log from 'loglevel'

export class HttpServer {
  app: Express
  private serverInstance?: Server

  constructor (private readonly port: number, readonly backend: RelayServer) {
    this.app = express()
    this.app.use(cors())

    this.app.use(bodyParser.urlencoded({ extended: false }))
    this.app.use(bodyParser.json())

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
        this.startBackend()
      })
    }
  }

  startBackend (): void {
    try {
      this.backend.start()
    } catch (e) {
      log.error('relay task error', e)
    }
  }

  stop (): void {
    this.serverInstance?.close()
    console.log('Http server stopped.\nShutting down relay...')
  }

  close (): void {
    console.log('Stopping relay worker...')
    this.backend.stop()
  }

  // TODO: use this when changing to jsonrpc
  async rootHandler (req: any, res: any): Promise<void> {
    let status
    try {
      let res
      // @ts-ignore
      const func = this.backend[req.body.method]
      if (func != null) {
        res = await func.apply(this.backend, [req.body.params]) ?? { code: 200 }
      } else {
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
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

  pingHandler (req: any, res: any): void {
    const pingResponse = this.backend.pingHandler(req.query.paymaster)
    res.send(pingResponse)
    console.log(`address ${pingResponse.relayWorkerAddress} sent. ready: ${pingResponse.ready}`)
  }

  async relayHandler (req: any, res: any): Promise<void> {
    try {
      const signedTx = await this.backend.createRelayTransaction(req.body)
      res.send({ signedTx })
    } catch (e) {
      res.send({ error: e.message })
      console.log('tx failed:', e)
    }
  }
}
