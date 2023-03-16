import { PrefixedHexString } from 'ethereumjs-util'

import { PingResponse } from './PingResponse'
import { LoggerInterface } from './LoggerInterface'

import { HttpWrapper } from './HttpWrapper'
import { RelayTransactionRequest } from './types/RelayTransactionRequest'
import { AuditRequest, AuditResponse } from './types/AuditRequest'
import { ConfigResponse } from './ConfigResponse'
import { Address, ObjectMap } from './types/Aliases'
import { appendSlashTrim } from './Utils'

export class HttpClient {
  private readonly httpWrapper: HttpWrapper
  private readonly logger: LoggerInterface

  constructor (httpWrapper: HttpWrapper, logger: LoggerInterface) {
    this.httpWrapper = httpWrapper
    this.logger = logger
  }

  async getPingResponse (relayUrl: string, paymaster?: string): Promise<PingResponse> {
    const url = new URL('getaddr', appendSlashTrim(relayUrl))
    if (paymaster != null) {
      url.searchParams.set('paymaster', paymaster)
    }
    const pingResponse: PingResponse = await this.httpWrapper.sendPromise(url)
    this.logger.info(`pingResponse: ${JSON.stringify(pingResponse)}`)
    if (pingResponse == null) {
      throw new Error('Relay responded without a body')
    }
    return pingResponse
  }

  async relayTransaction (relayUrl: string, request: RelayTransactionRequest): Promise<{ signedTx: PrefixedHexString, nonceGapFilled: ObjectMap<PrefixedHexString> }> {
    const url = new URL('relay', appendSlashTrim(relayUrl))
    const {
      signedTx,
      nonceGapFilled,
      error
    }: { signedTx: PrefixedHexString, nonceGapFilled: ObjectMap<PrefixedHexString>, error: string } = await this.httpWrapper.sendPromise(url, request)
    this.logger.info(`relayTransaction response: ${signedTx}, error: ${error}`)
    if (error != null) {
      throw new Error(`Got error response from relay: ${error}`)
    }
    if (signedTx == null) {
      throw new Error('body.signedTx field missing.')
    }
    return { signedTx, nonceGapFilled }
  }

  async auditTransaction (relayUrl: string, signedTx: PrefixedHexString): Promise<AuditResponse> {
    const url = new URL('audit', appendSlashTrim(relayUrl))
    const auditRequest: AuditRequest = { signedTx }
    const auditResponse: AuditResponse = await this.httpWrapper.sendPromise(url, auditRequest)
    this.logger.info(`auditTransaction response: ${JSON.stringify(auditResponse)}`)
    return auditResponse
  }

  async getNetworkConfiguration (clientDefaultConfigUrl: string): Promise<ConfigResponse> {
    const configResponse: ConfigResponse = await this.httpWrapper.sendPromise(new URL(clientDefaultConfigUrl))
    this.logger.info(`Config response: ${JSON.stringify(configResponse)}`)
    return configResponse
  }

  async getVerifyingPaymasterAddress (verifierServerUrl: string, chainId: number): Promise<Address> {
    const url = new URL('getPaymasterAddress', appendSlashTrim(verifierServerUrl))
    url.searchParams.set('chainId', chainId.toString())
    const { paymasterAddress } = await this.httpWrapper.sendPromise(url)
    this.logger.info(`VerifyingPaymaster address: ${JSON.stringify(paymasterAddress)}`)
    return paymasterAddress
  }
}
