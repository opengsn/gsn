import * as core from 'express-serve-static-core'
import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Express, Request, Response } from 'express'
import { Server } from 'http'
import ow from 'ow'

import { PenalizerService } from './penalizer/PenalizerService'
import { LoggerInterface } from '../common/LoggerInterface'
import { RelayServer } from './RelayServer'
import { AuditRequest, AuditRequestShape, AuditResponse } from '../common/types/AuditRequest'
import { RelayTransactionRequestShape } from '../common/types/RelayTransactionRequest'

export class HttpServer {
  app: Express
  private serverInstance?: Server

  constructor (
    private readonly port: number,
    readonly logger: LoggerInterface,
    readonly relayService?: RelayServer,
    readonly penalizerService?: PenalizerService
  ) {
    this.app = express()
    this.app.use(cors())

    this.app.use(bodyParser.urlencoded({ extended: false }))
    this.app.use(bodyParser.json())

    if (this.relayService != null) {
      this.app.post('/getaddr', this.pingHandler.bind(this))
      this.app.get('/getaddr', this.pingHandler.bind(this))
      this.app.post('/relay', this.relayHandler.bind(this))
      this.relayService.once('removed', this.stop.bind(this))
      this.relayService.once('unstaked', this.close.bind(this))
      this.relayService.on('error', (e) => { console.error('httpServer:', e) })
    }

    if (this.penalizerService != null) {
      this.app.post('/audit', this.auditHandler.bind(this))
    }
  }

  start (): void {
    this.serverInstance = this.app.listen(this.port, () => {
      console.log('Listening on port', this.port)
      this.relayService?.start()
    })
  }

  stop (): void {
    this.serverInstance?.close()
    console.log('Http server stopped.\nShutting down relay...')
  }

  close (): void {
    console.log('Stopping relay worker...')
    this.relayService?.stop()
    this.penalizerService?.stop()
  }

  async pingHandler (req: Request, res: Response): Promise<void> {
    if (this.relayService == null) {
      throw new Error('RelayServer not initialized')
    }
    const paymaster = req.query.paymaster
    if (!(paymaster == null || typeof paymaster === 'string')) {
      throw new Error('Paymaster address is not a valid string')
    }

    try {
      const pingResponse = await this.relayService.pingHandler(paymaster)
      res.send(pingResponse)
      console.log(`address ${pingResponse.relayWorkerAddress} sent. ready: ${pingResponse.ready}`)
    } catch (e) {
      const message: string = e.message
      res.send({ message })
      this.logger.error(`ping handler rejected: ${message}`)
    }
  }

  async relayHandler (req: Request, res: Response): Promise<void> {
    if (this.relayService == null) {
      throw new Error('RelayServer not initialized')
    }
    try {
      ow(req.body, ow.object.exactShape(RelayTransactionRequestShape))
      const signedTx = await this.relayService.createRelayTransaction(req.body)
      res.send({ signedTx })
    } catch (e) {
      const error: string = e.message
      res.send({ error })
      this.logger.error(`tx failed: ${error}`)
    }
  }

  async auditHandler (req: Request<core.ParamsDictionary, AuditResponse, AuditRequest>, res: Response<AuditResponse>): Promise<void> {
    if (this.penalizerService == null) {
      throw new Error('PenalizerService not initialized')
    }
    try {
      ow(req.body, ow.object.exactShape(AuditRequestShape))
      let message = ''
      let penalizeResponse = await this.penalizerService.penalizeRepeatedNonce(req.body)
      message += penalizeResponse.message ?? ''
      if (penalizeResponse.commitTxHash == null) {
        penalizeResponse = await this.penalizerService.penalizeIllegalTransaction(req.body)
        message += penalizeResponse.message ?? ''
      }
      res.send({
        commitTxHash: penalizeResponse.commitTxHash,
        message
      })
    } catch (e) {
      const message: string = e.message
      res.send({ message })
      this.logger.error(`penalization failed: ${message}`)
    }
  }
}
