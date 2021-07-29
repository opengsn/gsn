import { PrefixedHexString } from 'ethereumjs-util'

import { PingResponse } from './PingResponse'
import { LoggerInterface } from './LoggerInterface'

import { HttpWrapper } from './HttpWrapper'
import { RelayTransactionRequest } from './types/RelayTransactionRequest'
import { AuditRequest, AuditResponse } from './types/AuditRequest'

export class HttpClient {
  private readonly httpWrapper: HttpWrapper
  private readonly logger: LoggerInterface

  constructor (httpWrapper: HttpWrapper, logger: LoggerInterface) {
    this.httpWrapper = httpWrapper
    this.logger = logger
  }

  async getPingResponse (relayUrl: string, paymaster?: string): Promise<PingResponse> {
    const paymasterSuffix = paymaster == null ? '' : '?paymaster=' + paymaster
    const pingResponse: PingResponse = await this.httpWrapper.sendPromise(relayUrl + '/getaddr' + paymasterSuffix)
    this.logger.info(`pingResponse: ${JSON.stringify(pingResponse)}`)
    if (pingResponse == null) {
      throw new Error('Relay responded without a body')
    }
    return pingResponse
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<PrefixedHexString> {
    const { signedTx, error }: { signedTx: string, error: string } = await this.httpWrapper.sendPromise(relayUrl + '/relay', request)
    this.logger.info(`relayTransaction response: ${signedTx}, error: ${error}`)
    if (error != null) {
      throw new Error(`Got error response from relay: ${error}`)
    }
    if (signedTx == null) {
      throw new Error('body.signedTx field missing.')
    }
    return signedTx
  }

  async auditTransaction (relayUrl: string, signedTx: PrefixedHexString): Promise<AuditResponse> {
    const auditRequest: AuditRequest = { signedTx }
    const auditResponse: AuditResponse = await this.httpWrapper.sendPromise(relayUrl + '/audit', auditRequest)
    this.logger.info(`auditTransaction response: ${JSON.stringify(auditResponse)}`)
    return auditResponse
  }
}
