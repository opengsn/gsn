import BN from 'bn.js'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'
import { encode, List } from 'rlp'
import { toBN } from 'web3-utils'

import {
  BatchGatewayCacheDecoderInstance
} from '@opengsn/contracts'

import { Address, ObjectMap, Web3ProviderBaseInterface } from '../types/Aliases'
import { Contract, TruffleContract } from '../LightTruffleContract'
import { RelayRequest } from '../EIP712/RelayRequest'

import batchGatewayCacheDecoder from '../interfaces/IBatchGatewayCacheDecoder.json'
import { ContractInteractor } from '../ContractInteractor'
import { GSNBatchingContractsDeployment } from '../GSNContractsDeployment'
import {
  AddressesCachingResult,
  CalldataCachingResult,
  ICalldataCacheDecoderInteractor
} from './ICalldataCacheDecoderInteractor'

export interface BatchRelayRequestInfo {
  relayRequestElement: RelayRequestElement
  authorizationElement?: AuthorizationElement
  blsSignature: PrefixedHexString[] // what is the format for bls signature?
}

export interface BatchInfo {
  id: number
  workerAddress: Address
  transactions: BatchRelayRequestInfo[]
  defaultCalldataCacheDecoder: Address
  aggregatedSignature: BN[]
  isOpen: boolean
  targetSize: number
  targetBlock: number
  targetGasLimit: BN
  targetSubmissionTimestamp: number
  gasPrice: BN
  pctRelayFee: number
  baseRelayFee: number
  maxAcceptanceBudget: number
}

// all inputs must be a BN so they are RLP-encoded as values, not strings
// gasLimit of 0 will be replaced with some on-chain hard-coded value for this methodSignature
export interface RelayRequestElement {
  nonce: BN
  paymaster: BN
  sender: BN
  target: BN
  gasLimit: BN
  calldataGas: BN
  methodData: Buffer
  cacheDecoder: BN
}

export interface AuthorizationElement {
  authorizer: Address
  blsPublicKey: PrefixedHexString[]
  signature: PrefixedHexString
}

export enum SeparatelyCachedAddressTypes {
  paymasters,
  recipients,
  decoders,
  eoa
}

/**
 * Caching operation performs a view call to a cache contract and converts all values from original values
 * to their cached IDs.
 * For each value that is not cached, it returns an original value and increments {@link writeSlotsCount}
 * by the number of slots that will be written when caching it.
 * Note: edge-case with repeated new values (e.g. 'transferFrom(addr1, addr1, val)') is not handled.
 */

export interface RelayRequestCachingResult {
  relayRequestElement: RelayRequestElement
  writeSlotsCount: number
}

export interface CombinedCachingResult {
  cachedEncodedData: PrefixedHexString
  relayRequestElement: RelayRequestElement
  writeSlotsCount: number
}

export interface BatchInfoCachingResult {
  batchCompressedInput: RLPBatchCompressedInput
  writeSlotsCount: number
}

export interface CachingGasConstants {
  authorizationCalldataBytesLength: number
  authorizationStorageSlots: number
  gasPerSlotL2: number
}

/**
 * Interacts with BatchGatewayCacheDecoder and various CalldataCacheDecoder contracts in order
 * to substitute actual values with their cached IDs whenever possible.
 */
export class CacheDecoderInteractor {
  private readonly contractInteractor: ContractInteractor
  private readonly BatchGatewayCacheDecoder: Contract<BatchGatewayCacheDecoderInstance>
  private readonly calldataCacheDecoderInteractors: ObjectMap<ICalldataCacheDecoderInteractor>
  private readonly cachingGasConstants: CachingGasConstants
  private readonly batchingContractsDeployment: GSNBatchingContractsDeployment

  private batchGatewayCacheDecoder!: BatchGatewayCacheDecoderInstance

  constructor (_: {
    provider: Web3ProviderBaseInterface
    contractInteractor: ContractInteractor
    batchingContractsDeployment: GSNBatchingContractsDeployment
    calldataCacheDecoderInteractors: ObjectMap<ICalldataCacheDecoderInteractor>
    cachingGasConstants: CachingGasConstants
  }) {
    this.contractInteractor = _.contractInteractor
    this.batchingContractsDeployment = _.batchingContractsDeployment
    this.cachingGasConstants = _.cachingGasConstants
    this.calldataCacheDecoderInteractors = _.calldataCacheDecoderInteractors

    this.BatchGatewayCacheDecoder = TruffleContract({
      contractName: 'BatchGatewayCacheDecoder',
      abi: batchGatewayCacheDecoder
    })

    this.BatchGatewayCacheDecoder.setProvider(_.provider, undefined)
  }

  async init (): Promise<this> {
    this.batchGatewayCacheDecoder = await this.BatchGatewayCacheDecoder.at(this.batchingContractsDeployment.batchGatewayCacheDecoder!)
    return this
  }

  /**
   * Compress a structure into a {@link RelayRequestElement} that can be efficiently RLP-encoded.
   * @param _.relayRequest - a raw {@link RelayRequest} to compress, except for method data
   * @param _.compressedData - an already compressed method data that will be included as-is
   */
  async compressRelayRequest (_: { relayRequest: RelayRequest, cachedEncodedData?: PrefixedHexString }): Promise<RelayRequestCachingResult> {
    const nonce = toBN(_.relayRequest.request.nonce)

    // TODO: return the tuple of 'address, type' so that all addresses can be queried in one RPC request!
    const resolved = await this.compressAddressesToIds(
      [_.relayRequest.request.from],
      [_.relayRequest.request.to],
      [_.relayRequest.relayData.paymaster],
      [])
    const gasLimitBN = toBN(_.relayRequest.request.gas)
    if (gasLimitBN.modn(10000) !== 0) {
      throw new Error('gas limit must be a multiple of 10000')
    }
    const gasLimit = gasLimitBN.divn(10000)
    const calldataGas = toBN(_.relayRequest.relayData.transactionCalldataGasUsed)
    let methodData: Buffer
    if (_.cachedEncodedData == null) {
      methodData = toBuffer(_.relayRequest.request.data)
    } else {
      methodData = toBuffer(_.cachedEncodedData)
    }
    const cacheDecoder = toBN(1)  //TODO: for un-compressed calldata
    const relayRequestElement = {
      nonce,
      paymaster: resolved.paymasterAsIds[0],
      sender: resolved.senderAsIds[0],
      target: resolved.targetAsIds[0],
      gasLimit,
      calldataGas,
      methodData,
      cacheDecoder, // resolved.cacheDecoder[0] ???
    }
    return {
      relayRequestElement,
      writeSlotsCount: resolved.writeSlotsCount
    }
  }

  /**
   * In order to be able to operate on a provider level, we support receiving a transaction request as an ABI-encoded
   * calldata input and target.
   * We will have to ABI-decode that input into a meaningful data structure and encode it again using RLP and cache.
   */
  async compressAbiEncodedCalldata (_: { target: Address, abiEncodedCalldata: PrefixedHexString }): Promise<CalldataCachingResult> {
    const calldataCacheDecoderInteractor = this.calldataCacheDecoderInteractors[_.target.toLowerCase()]
    if (calldataCacheDecoderInteractor == null) {
      // TODO: set config flag to allow unknown target types to create batch requests
      throw new Error(`Unknown target address: ${_.target}`)
    }
    return await calldataCacheDecoderInteractor.compressCalldata(_.abiEncodedCalldata)
  }

  /**
   * resolve request addresses into Ids
   * returned values are compressed values - either original value if not found in cache, or IDs if they are already cached.
   * NOTE: order matters: if multiple requests use the same to address, the first one will have the full item (to be written into cache)
   *  and the rest of the requessts will use that cache item
   * @param relqyRequest - request to get from,to,paymaster addresses from.
   * @return senderAsIds/targetAsIds/paymasterAsIds - arrays of all addresses or ids, ready to be encoded
   * @return slotsWritten how manys lot updates were needed to cache these values.
   */
  async compressAddressesToIds(froms:Address[], tos: Address[], paymasters: Address[], cacheDecoders: Address[]): Promise<AddressesCachingResult> {
    console.log('convertWordsToIds inputs=' {froms,tos,paymasters, cacheDecoders})
    const ret = await this.batchGatewayCacheDecoder.convertWordsToIds([
      froms,
      tos,
      paymasters,
      cacheDecoders,
    ])
    console.log('convertWordsToIds ret=', ret,  'map',ret.map(a=>a.map(x=>x.toString())))
  // TODO
    const countSlots = ret.flatMap(x => x)
      .reduce((sum, x) => x.gt(toBN('0xffffffff')) ? sum + 1 : sum, 0)

    return {
      senderAsIds: ret[0],
      targetAsIds: ret[1],
      paymasterAsIds: ret[2],
      cacheDecoders: ret[3],
      writeSlotsCount: countSlots
    }
  }

  _calculateCalldataCostForRelayRequestsElement (relayRequestElement: RelayRequestElement, authorizationElement ?: AuthorizationElement): BN {
    if (this.contractInteractor == null) {
      throw new Error('ContractInteractor is not initialized')
    }
    const encodedRelayRequestsElement = encodeRelayRequestsElement(relayRequestElement)
    let relayRequestElementCost = toBN(this.contractInteractor.calculateCalldataCost(encodedRelayRequestsElement))
    if (authorizationElement != null) {
      relayRequestElementCost =
        relayRequestElementCost.addn(this.contractInteractor.calculateCalldataCost(encodedRelayRequestsElement))
    }
    return relayRequestElementCost
  }

  async calculateTotalCostForRelayRequestsElement (combinedCachingResult: CombinedCachingResult, authorizationElement ?: AuthorizationElement): Promise<any> {
    const calldataCost = this._calculateCalldataCostForRelayRequestsElement(combinedCachingResult.relayRequestElement, authorizationElement)
    const storageL2Cost = toBN(this.cachingGasConstants.gasPerSlotL2 * combinedCachingResult.writeSlotsCount)
    let authorizationStorageCost = toBN(0)
    if (authorizationElement != null
    ) {
      toBN(this.cachingGasConstants.gasPerSlotL2 * this.cachingGasConstants.authorizationStorageSlots)
    }
    const totalCost = storageL2Cost.add(calldataCost).add(authorizationStorageCost)

    return {
      authorizationStorageCost,
      storageL2Cost,
      calldataCost,
      totalCost
    }
  }

  async compressBatch (batchInfo: BatchInfo): Promise<BatchInfoCachingResult> {
    const gasPrice: BN = batchInfo.gasPrice
    const validUntil: BN = toBN(batchInfo.targetBlock)
    const pctRelayFee: BN = toBN(batchInfo.pctRelayFee)
    const baseRelayFee: BN = toBN(batchInfo.baseRelayFee)
    const maxAcceptanceBudget: BN = toBN(batchInfo.maxAcceptanceBudget)

    const addressesCompressed = await this.compressAddressesToIds([batchInfo.workerAddress], [], [], [this.batchingContractsDeployment.batchGatewayCacheDecoder])

    const blsSignature: BN[] = []
    const authorizations: AuthorizationElement[] =
      batchInfo.transactions.filter(it => it.authorizationElement != null).map(it => it.authorizationElement!)
    const relayRequestElements: RelayRequestElement[] = batchInfo.transactions.map(it => it.relayRequestElement)

    const batchCompressedInput: RLPBatchCompressedInput = {
      gasPrice,
      validUntil,
      pctRelayFee,
      baseRelayFee,
      maxAcceptanceBudget,
      defaultCalldataCacheDecoder: addressesCompressed.cacheDecoders[0],
      relayWorker: addressesCompressed.senderAsIds[0],  //TODO: same cache as senders?
      blsSignature,
      authorizations,
      relayRequestElements
    }
    return {
      batchCompressedInput,
      writeSlotsCount: 0
    }
  }

  async compressRelayRequestAndCalldata (relayRequest: RelayRequest): Promise<CombinedCachingResult> {
    const { cachedEncodedData, writeSlotsCount: calldataWriteSlotsCount } =
      await this.compressAbiEncodedCalldata({
        target: relayRequest.request.to,
        abiEncodedCalldata: relayRequest.request.data
      })
    const { relayRequestElement, writeSlotsCount: relayRequestWriteSlotsCount } =
      await this.compressRelayRequest({ relayRequest, cachedEncodedData })
    const writeSlotsCount = calldataWriteSlotsCount + relayRequestWriteSlotsCount
    return { cachedEncodedData, relayRequestElement, writeSlotsCount }
  }
}

/**
 * Input to the RLP encoding. Values that are cached on-chain are already replaced with corresponding cache IDs.
 */
export interface RLPBatchCompressedInput {
  gasPrice: BN
  validUntil: BN
  relayWorker: BN
  pctRelayFee: BN
  baseRelayFee: BN
  maxAcceptanceBudget: BN
  defaultCalldataCacheDecoder: BN
  blsSignature: BN[]
  authorizations: AuthorizationElement[]
  relayRequestElements: RelayRequestElement[]
}

const relayRequestElementToRLPArray = (it: RelayRequestElement): List => {
  return [
    it.nonce,
    it.paymaster,
    it.sender,
    it.target,
    it.gasLimit,
    it.calldataGas,
    it.methodData,
    it.cacheDecoder
  ]
}

const authorizationElementToRLPArray = (it: AuthorizationElement): List => {
  return [
    it.authorizer,
    it.blsPublicKey.map(toBN),
    it.signature
  ]
}

export function encodeRelayRequestsElement (
  relayRequestsElement: RelayRequestElement
): PrefixedHexString {
  return bufferToHex(encode(relayRequestElementToRLPArray(relayRequestsElement)))
}

export function encodeBatch (
  input: RLPBatchCompressedInput
): PrefixedHexString {
  const batchItems: List[] = input.relayRequestElements.map(relayRequestElementToRLPArray)
  const approvalItems: List[] = input.authorizations?.map(authorizationElementToRLPArray) ?? []
  const list: List = [
    input.gasPrice,
    input.validUntil,
    input.pctRelayFee,
    input.baseRelayFee,
    input.maxAcceptanceBudget,
    input.relayWorker,
    input.defaultCalldataCacheDecoder,
    input.blsSignature[0],
    input.blsSignature[1],
    batchItems,
    approvalItems]
  return bufferToHex(encode(list))
}
