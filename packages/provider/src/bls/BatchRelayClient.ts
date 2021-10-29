import { PrefixedHexString, toBuffer } from 'ethereumjs-util'

import {
  RelayClient, RelayingAttempt
} from '../RelayClient'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { Address, IntString } from '@opengsn/common/dist/types/Aliases'
import { PingResponseBatchMode } from '@opengsn/common/dist/PingResponse'
import { Transaction } from '@ethereumjs/tx'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { GsnSendToRelayerEvent } from '../GsnEvents'

export class BatchRelayClient extends RelayClient {
  batchGateway: Address = '' // TODO

  /**
   * In batching mode, client must use the gas price value the server has returned in a ping
   */
  async _getRelayRequestGasPriceValue (gsnTransactionDetails: GsnTransactionDetails, relayInfo: RelayInfo): Promise<PrefixedHexString> {
    return relayInfo.pingResponse.minGasPrice
  }

  async _getRelayRequestGasPriceValueForServerLookup (gsnTransactionDetails: GsnTransactionDetails): Promise<PrefixedHexString> {
    return await super._getRelayRequestGasPriceValueForServerLookup(gsnTransactionDetails)
  }

  async _getRelayRequestValidUntilValue (relayInfo: RelayInfo): Promise<IntString> {
    return (relayInfo.pingResponse as PingResponseBatchMode).validUntil
  }

  _getFromAddressForValidation (_httpRequest: RelayTransactionRequest): Address {
    return this.batchGateway
  }

  // async _prepareRelayHttpRequest (
  //   relayInfo: RelayInfo,
  //   gsnTransactionDetails: GsnTransactionDetails
  // ): Promise<RelayTransactionRequest> {
  // difference:
  // 1. These fields are now directly given by 'getAddress' response:
  //   a. gasPrice V
  //   b. validUntil V
  //   c. clientId X
  // 2. 'estimateCalldataCostForRequest' should be accounting for storage costs for new slots in batch
  // 3. use BLS signature method V (is configuration parameter only)
  // 4. 'relayMaxNonce' does not matter - we wait for relay to send a batch anyway (configurable by setting very high maxRelayNonceGap)
  // }

  /**
   * Send transaction with batching REST API. Nothing to do with a 200 OK response so far.
   */
  async _sendRelayRequestToServer (httpRequest: RelayTransactionRequest, relayInfo: RelayInfo): Promise<RelayingAttempt> {
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      await this.dependencies.httpClient.relayTransactionInBatch(relayInfo.relayInfo.relayUrl, httpRequest)
      return {}
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        this.dependencies.knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      this.logger.info(`relayTransaction: ${JSON.stringify(httpRequest)}`)
      return { error }
    }
  }

  /**
   * Nothing is to be done after the server responds
   */
  async _onTransactionSentToServer (
    relayInfo: RelayInfo,
    httpRequest: RelayTransactionRequest,
    transaction?: Transaction,
    hexTransaction?: PrefixedHexString): Promise<{ error?: Error }> {
    return {}
  }

  // async _attemptRelay (
  //   relayInfo: RelayInfo,
  //   gsnTransactionDetails: GsnTransactionDetails
  // ): Promise<RelayingAttemptBatchMode> {
  // // difference:
  // // 1. will run local view call 'from: gateway' without signature so that it can pass signature check V
  // // NOTE: this can be done BEFORE signature, saving client a 'signature'-'rejected' flow
  // // 2. All code after sending is different. Does not call 'auditTransaction' and 'validateRelayResponse'. V
  // // Returned object is not a transaction V
  // }
}
