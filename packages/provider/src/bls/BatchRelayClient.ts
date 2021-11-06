import { PrefixedHexString } from 'ethereumjs-util'

import {
  GSNContractsDeploymentResolvedForRequest, GSNUnresolvedConstructorInput,
  RelayClient, RelayingAttempt
} from '../RelayClient'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { Address, IntString } from '@opengsn/common/dist/types/Aliases'
import { PingResponseBatchMode } from '@opengsn/common/dist/PingResponse'
import { Transaction } from '@ethereumjs/tx'
import { RelayMetadata, RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { GsnSendToRelayerEvent, GsnSignRequestEvent } from '../GsnEvents'
import { asRelayCallAbi } from '@opengsn/common'
import { toBN, toHex } from 'web3-utils'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import {
  AuthorizationElement,
  CacheDecoderInteractor,
  TargetType
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'

export class BatchRelayClient extends RelayClient {
  cacheDecoderInteractor: CacheDecoderInteractor

  constructor (
    rawConstructorInput: GSNUnresolvedConstructorInput,
    cacheDecoderInteractor: CacheDecoderInteractor
  ) {
    super(rawConstructorInput)
    this.cacheDecoderInteractor = cacheDecoderInteractor
  }

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

  /**
   * Sends local view call from the BatchGateway address and with empty signature to pass origin, signature checks.
   */
  async _getLocalViewCallParameters (httpRequest: RelayTransactionRequest): Promise<TransactionConfig> {
    const viewCallGasLimit =
      await this.dependencies.contractInteractor.getMaxViewableGasLimit(httpRequest.relayRequest, this.config.maxViewableGasLimit)
    const httpRequestWithoutSignature = Object.assign({}, httpRequest, { metadata: Object.assign({}, httpRequest.metadata, { signature: '0x' }) })
    const encodedRelayCall = this.dependencies.contractInteractor.encodeABI(asRelayCallAbi(httpRequestWithoutSignature))

    return {
      from: this.cacheDecoderInteractor.batchingContractsDeployment.batchGateway,
      to: this._getResolvedDeployment().relayHubAddress,
      gasPrice: toHex(httpRequest.relayRequest.relayData.gasPrice),
      gas: toHex(viewCallGasLimit),
      data: encodedRelayCall
    }
  }

  async prepareRelayRequestMetadata (relayRequest: RelayRequest, relayInfo: RelayInfo, deployment: GSNContractsDeploymentResolvedForRequest): Promise<RelayMetadata> {
    this.emit(new GsnSignRequestEvent())
    const authorization = await this._fillInComputedFieldsWithAuthorization(relayRequest)
    const signature = await this.dependencies.accountManager.signBLSALTBN128(relayRequest)
    return {
      maxAcceptanceBudget: relayInfo.pingResponse.maxAcceptanceBudget,
      relayHubAddress: deployment.relayHubAddress,
      signature,
      approvalData: '0x',
      relayMaxNonce: Number.MAX_SAFE_INTEGER,
      authorization
    }
  }

  /**
   * Modifies the input object itself to include fields computed on an almost full {@link RelayRequest}
   * @param relayRequest - an object that will be modified by this method
   * @returns PrefixedHexString and RLP-encoded {@link AuthorizationElement} to be passed to the server
   */
  async _fillInComputedFieldsWithAuthorization (relayRequest: RelayRequest): Promise<AuthorizationElement | undefined> {
    let authorizationElement: AuthorizationElement | undefined
    const authorizationIssued = await this.dependencies.accountManager.authorizationIssued(relayRequest.request.from)
    if (!authorizationIssued) {
      authorizationElement = await this.dependencies.accountManager.createAccountAuthorizationElement(relayRequest.request.from, this.cacheDecoderInteractor.batchingContractsDeployment.authorizationsRegistrar)
    }
    const targetType = this._getTargetType(relayRequest.request.to)
    const compressedData = await this.cacheDecoderInteractor.compressAbiEncodedCalldata(targetType, relayRequest.request.data)
    const compressRelayRequest = await this.cacheDecoderInteractor.compressRelayRequest(relayRequest, compressedData.cachedEncodedData)
    const calldataCost = this.cacheDecoderInteractor.estimateCalldataCostForRelayRequestsElement(compressRelayRequest.relayRequestElement, authorizationElement)
    const writeSlotsCount = compressRelayRequest.writeSlotsCount + compressedData.writeSlotsCount
    const storageL2Cost = this.cacheDecoderInteractor.writeSlotsToL2Gas(writeSlotsCount)

    // TODO: sanitize types
    relayRequest.relayData.transactionCalldataGasUsed = toBN(calldataCost).and(storageL2Cost).toString()
    return authorizationElement
  }

  _getTargetType (_target: Address): TargetType {
    // TODO: add constructor param with mapping of address to target
    return TargetType.ERC20
  }

  /**
   * Send transaction with batching REST API. Nothing to do with a 200 OK response so far.
   */
  async _sendRelayRequestToServer (relayRequestID: string, httpRequest: RelayTransactionRequest, relayInfo: RelayInfo): Promise<RelayingAttempt> {
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      await this.dependencies.httpClient.relayTransactionInBatch(relayInfo.relayInfo.relayUrl, httpRequest)
      return {}
    } catch (error) {
      return this._onRelayTransactionError(error, relayInfo, httpRequest)
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
}
