import { PrefixedHexString } from 'ethereumjs-util'
import { Transaction } from '@ethereumjs/tx'
import { toHex } from 'web3-utils'

import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { Address, IntString, ObjectMap } from '@opengsn/common/dist/types/Aliases'
import { RelayMetadata, RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import { asRelayCallAbi, getRelayRequestID, GSNBatchingContractsDeployment } from '@opengsn/common'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'

import {
  AuthorizationElement,
  CacheDecoderInteractor, CachingGasConstants
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'

import {
  GSNContractsDeploymentResolvedForRequest,
  GSNUnresolvedConstructorInput,
  RelayClient,
  RelayingAttempt
} from '../RelayClient'

import { GsnSendToRelayerEvent, GsnSignRequestEvent } from '../GsnEvents'
import { ICalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ICalldataCacheDecoderInteractor'
import { ERC20CalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ERC20CalldataCacheDecoderInteractor'

export interface GSNBatchingUnresolvedConstructorInput extends GSNUnresolvedConstructorInput {
  // TODO: this only supports one target and does not allow stubbing
  target: Address
  calldataCacheDecoder: Address
  batchingContractsDeployment: GSNBatchingContractsDeployment
}

export class BatchRelayClient extends RelayClient {
  private readonly rawBatchConstructorInput: GSNBatchingUnresolvedConstructorInput
  cacheDecoderInteractor!: CacheDecoderInteractor

  constructor (
    rawBatchConstructorInput: GSNBatchingUnresolvedConstructorInput
  ) {
    super(rawBatchConstructorInput)
    this.rawBatchConstructorInput = rawBatchConstructorInput
  }

  async init (): Promise<this> {
    await super.init()
    const cachingGasConstants: CachingGasConstants = {
      authorizationCalldataBytesLength: 1,
      authorizationStorageSlots: 1,
      gasPerSlotL2: 1
    }
    const calldataCacheDecoderInteractors: ObjectMap<ICalldataCacheDecoderInteractor> = {}
    calldataCacheDecoderInteractors[this.rawBatchConstructorInput.target.toLowerCase()] = new ERC20CalldataCacheDecoderInteractor({
      provider: this.rawBatchConstructorInput.provider,
      erc20CacheDecoderAddress: this.rawBatchConstructorInput.calldataCacheDecoder
    })
    this.cacheDecoderInteractor = new CacheDecoderInteractor({
      provider: this.rawBatchConstructorInput.provider,
      batchingContractsDeployment: this.rawBatchConstructorInput.batchingContractsDeployment,
      contractInteractor: this.dependencies.contractInteractor,
      calldataCacheDecoderInteractors,
      cachingGasConstants
    })
    await this.cacheDecoderInteractor.init()
    return this
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
    if (relayInfo.pingResponse.validUntil == null) {
      throw new Error('validUntil missing in PingResponse')
    }
    // TODO: check validUntil is far enough in the future
    return relayInfo.pingResponse.validUntil
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
      from: this.rawBatchConstructorInput.batchingContractsDeployment.batchGateway,
      to: this._getResolvedDeployment().relayHubAddress,
      gasPrice: toHex(httpRequest.relayRequest.relayData.gasPrice),
      gas: toHex(viewCallGasLimit),
      data: encodedRelayCall
    }
  }

  async prepareRelayRequestMetadata (relayRequest: RelayRequest, relayInfo: RelayInfo, deployment: GSNContractsDeploymentResolvedForRequest): Promise<RelayMetadata> {
    this.emit(new GsnSignRequestEvent())
    let authorizationElement: AuthorizationElement | undefined
    const authorizationIssued = await this.dependencies.accountManager.isAuthorizationIssuedToCurrentBLSPrivateKey(relayRequest.request.from)
    if (!authorizationIssued) {
      authorizationElement = await this.dependencies.accountManager.createAccountAuthorizationElement(relayRequest.request.from, this.rawBatchConstructorInput.batchingContractsDeployment.authorizationsRegistrar)
    }
    await this._fillInComputedFieldsWithAuthorization(relayRequest, authorizationElement)
    const signature = await this.dependencies.accountManager.signBLSALTBN128(relayRequest)
    return {
      maxAcceptanceBudget: relayInfo.pingResponse.maxAcceptanceBudget,
      relayHubAddress: deployment.relayHubAddress,
      signature,
      approvalData: '0x',
      relayMaxNonce: Number.MAX_SAFE_INTEGER,
      calldataCacheDecoder: this.cacheDecoderInteractor.getCalldataCacheDecoderForTarget(relayRequest.request.to),
      authorizationElement
    }
  }

  /**
   * Modifies the input object itself to include fields computed on an almost full {@link RelayRequest}
   * @param relayRequest - an object that will be modified by this method
   * @param authorizationElement - only used to calculate calldata costs
   * @returns PrefixedHexString and RLP-encoded {@link AuthorizationElement} to be passed to the server
   */
  async _fillInComputedFieldsWithAuthorization (relayRequest: RelayRequest, authorizationElement: AuthorizationElement | undefined): Promise<void> {
    const combinedCachingResult = await this.cacheDecoderInteractor.compressRelayRequestAndCalldata(relayRequest)
    const { totalCost } = await this.cacheDecoderInteractor.calculateTotalCostForRelayRequestsElement(combinedCachingResult, authorizationElement)
    // TODO: sanitize types
    relayRequest.relayData.transactionCalldataGasUsed = totalCost.toString()
    relayRequest.relayData.paymasterData = '0x'
  }

  /**
   * Send transaction with batching REST API. Nothing to do with a 200 OK response so far.
   */
  async _sendRelayRequestToServer (relayRequestID: string, httpRequest: RelayTransactionRequest, relayInfo: RelayInfo): Promise<RelayingAttempt> {
    this.emit(new GsnSendToRelayerEvent(relayInfo.relayInfo.relayUrl))
    try {
      const relayRequestIDFromServer = await this.dependencies.httpClient.relayTransactionInBatch(relayInfo.relayInfo.relayUrl, httpRequest)
      this._validateRelayRequestID(relayRequestID, relayRequestIDFromServer)
      const blockNumber = await this.dependencies.contractInteractor.getBlockNumberRightNow()
      this._saveTransactionDetailsForLater(relayRequestID, blockNumber, httpRequest.relayRequest.request.validUntil)
      return {}
    } catch (error) {
      return this._onRelayTransactionError(error, relayInfo, httpRequest)
    }
  }

  _validateRelayRequestID (relayRequestID: string, relayRequestIDFromServer: string): void {
    if (relayRequestID.toLowerCase() !== relayRequestIDFromServer.toLowerCase()) {
      throw new Error(`Returned relayRequestID ${relayRequestIDFromServer} did not match local ${relayRequestID}`)
    }
  }

  _saveTransactionDetailsForLater (
    relayRequestID: string,
    submissionBlock: number,
    validUntil: string): void {
    this.submittedRelayRequests.set(relayRequestID, {
      validUntil,
      submissionBlock
    })
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

  // noinspection JSMethodCanBeStatic
  _getRelayRequestID (relayRequest: RelayRequest, _: PrefixedHexString): PrefixedHexString {
    return getRelayRequestID(relayRequest)
  }
}
