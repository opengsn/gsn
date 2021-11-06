import BN from 'bn.js'
import { bufferToHex, PrefixedHexString, toBuffer } from 'ethereumjs-util'
import { encode, List } from 'rlp'
import { toBN } from 'web3-utils'

import {
  BatchGatewayCacheDecoderInstance,
  ERC20CacheDecoderInstance
} from '@opengsn/contracts'

import { Address, IntString, Web3ProviderBaseInterface } from '../types/Aliases'
import { Contract, TruffleContract } from '../LightTruffleContract'
import { RelayRequest } from '../EIP712/RelayRequest'

import batchGatewayCacheDecoder from '../interfaces/IBatchGatewayCacheDecoder.json'
import erc20CacheDecoderAbi from '../interfaces/IERC20CacheDecoder.json'
import { ContractInteractor } from '../ContractInteractor'
import { GSNBatchingContractsDeployment } from '../GSNContractsDeployment'

// all inputs must be a BN so they are RLP-encoded as values, not strings
// gasLimit of 0 will be replaced with some on-chain hard-coded value for this methodSignature
export interface RelayRequestsElement {
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
  blsPublicKey: BN[] | PrefixedHexString[]
  signature: PrefixedHexString
}

enum SeparatelyCachedAddressTypes {
  paymasters,
  recipients,
  eoa
}

export enum TargetType {
  ERC20
}

enum ERC20MethodSignatures {
  Transfer,
  TransferFrom,
  Approve,
  Mint,
  Burn,
  Permit
}

const ERC20MethodIds = [
  '0xa9059cbb',
  '0x23b872dd',
  '0x095ea7b3',
  '0x00000000',
  '0x00000000',
  '0xd505accf'
]

/**
 * Caching operation performs a view call to a cache contract and converts all values from original values
 * to their cached IDs.
 * For each value that is not cached, it returns an original value and increments {@link writeSlotsCount}
 * by the number of slots that will be written when caching it.
 * Note: edge-case with repeated new values (e.g. 'transferFrom(addr1, addr1, val)') is not handled.
 */
export interface CalldataCachingResult {
  cachedEncodedData: PrefixedHexString
  writeSlotsCount: number
}

export interface RelayRequestCachingResult {
  relayRequestElement: RelayRequestsElement
  writeSlotsCount: number
}

interface CachingGasConstants {
  authorizationCalldataBytesLength: number
  authorizationStorageSlots: number
  gasPerSlotL2: number
}

interface ERC20Call {
  method: ERC20MethodSignatures
  data: { [key: string]: any }
}

/**
 * Interacts with a 'Decompressor' contract in order to substitute actual values with their cached IDs.
 */
export class CacheDecoderInteractor {
  private readonly provider: Web3ProviderBaseInterface
  private readonly BatchGatewayCacheDecoder: Contract<BatchGatewayCacheDecoderInstance>
  private readonly ERC20CacheDecoder: Contract<ERC20CacheDecoderInstance>

  private decompressor!: BatchGatewayCacheDecoderInstance
  private erc20cacheDecoder!: ERC20CacheDecoderInstance

  private readonly cachingGasConstants!: CachingGasConstants
  private readonly contractInteractor!: ContractInteractor

  batchingContractsDeployment: GSNBatchingContractsDeployment

  constructor (_: {
    provider: Web3ProviderBaseInterface
    batchingContractsDeployment: GSNBatchingContractsDeployment
  }) {
    this.provider = _.provider
    this.batchingContractsDeployment = _.batchingContractsDeployment

    this.BatchGatewayCacheDecoder = TruffleContract({
      contractName: 'BatchGatewayCacheDecoder',
      abi: batchGatewayCacheDecoder
    })
    this.ERC20CacheDecoder = TruffleContract({
      contractName: 'IRelayHub',
      abi: erc20CacheDecoderAbi
    })

    this.BatchGatewayCacheDecoder.setProvider(this.provider, undefined)
    this.ERC20CacheDecoder.setProvider(this.provider, undefined)
  }

  async init (_: {
    decompressorAddress: Address
    erc20cacheDecoder: Address
  }): Promise<this> {
    this.decompressor = await this.BatchGatewayCacheDecoder.at(_.decompressorAddress)
    this.erc20cacheDecoder = await this.ERC20CacheDecoder.at(_.erc20cacheDecoder)
    return this
  }

  /**
   * Compress a structure into a {@link RelayRequestsElement} that can be efficiently RLP-encoded.
   * @param relayRequest - a raw {@link RelayRequest} to compress, except for method data
   * @param compressedData - an already compressed method data that will be included as-is
   */
  async compressRelayRequest (relayRequest: RelayRequest, compressedData?: PrefixedHexString): Promise<RelayRequestCachingResult> {
    const nonce = toBN(relayRequest.request.nonce)
    const paymaster = toBN(relayRequest.relayData.paymaster)
    const sender = await this.addressToId(relayRequest.request.from, SeparatelyCachedAddressTypes.eoa)
    const target = await this.addressToId(relayRequest.request.to, SeparatelyCachedAddressTypes.recipients)
    const gasLimitBN = toBN(relayRequest.request.gas)
    if (gasLimitBN.modn(10000) !== 0) {
      throw new Error('gas limit must be a multiple of 10000')
    }
    const gasLimit = gasLimitBN.divn(10000)
    const calldataGas = toBN(relayRequest.relayData.transactionCalldataGasUsed)
    let methodData: Buffer
    if (compressedData == null) {
      methodData = toBuffer(relayRequest.request.data)
    } else {
      methodData = toBuffer(compressedData)
    }
    const cacheDecoder = toBN(1) // use encodedData as-is
    const relayRequestElement = {
      nonce,
      paymaster,
      sender,
      target,
      gasLimit,
      calldataGas,
      methodData,
      cacheDecoder
    }
    return {
      relayRequestElement,
      writeSlotsCount: 0
    }
  }

  decodeAbiEncodedERC20Calldata (abiEncodedCalldata: PrefixedHexString): ERC20Call {
    const methodID = abiEncodedCalldata.substr(0, 6)
    const method = ERC20MethodIds.indexOf(methodID)
    if (method === -1) {
      throw new Error(`Failed to compress data for methodID ${methodID}: unknown methodID`)
    }
    const abiEncodedParameters = abiEncodedCalldata.substr(6)
    let data: { [key: string]: any } = {}
    switch (method) {
      case ERC20MethodSignatures.Transfer:
        data = web3.eth.abi.decodeParameters(['address', 'uint256'], abiEncodedParameters)
        break
    }

    return {
      method,
      data
    }
  }

  async compressAbiEncodedCalldata (targetType: TargetType, abiEncodedCalldata: PrefixedHexString): Promise<CalldataCachingResult> {
    switch (targetType) {
      case TargetType.ERC20: {
        const erc20Call = this.decodeAbiEncodedERC20Calldata(abiEncodedCalldata)
        return await this.compressErc20Call(erc20Call)
      }
    }
  }

  async compressErc20Call (erc20Call: ERC20Call): Promise<CalldataCachingResult> {
    switch (erc20Call.method) {
      case ERC20MethodSignatures.Transfer:
        return await this.compressErc20Transfer(erc20Call.data[0], erc20Call.data[1])
    }
    throw new Error('not implemented')
  }

  async compressErc20Transfer (destination: Address, value: IntString): Promise<CalldataCachingResult> {
    let writeSlotsCount = 0
    const destinationId = await this.erc20addressToId(destination)
    if (destinationId.eq(toBN(destination))) {
      writeSlotsCount++
    }
    const methodSig = toBN(ERC20MethodSignatures.Transfer)
    const list: List = [methodSig, destinationId, toBN(value)]
    const cachedEncodedData = bufferToHex(encode(list))
    return {
      cachedEncodedData,
      writeSlotsCount
    }
  }

  async compressErc20Approve (): Promise<CalldataCachingResult> {
    throw new Error('not implemented')
  }

  // TODO: either a) separate this class into many or b) find a better way to organize this
  async addressToId (address: Address, type: SeparatelyCachedAddressTypes): Promise<BN> {
    return toBN(address)
  }

  async erc20addressToId (address: Address): Promise<BN> {
    const [compressedAddress] = await this.erc20cacheDecoder.convertAddressesToIds([address])
    return compressedAddress
  }

  estimateCalldataCostForRelayRequestsElement (
    relayRequestElement: RelayRequestsElement,
    authorizationElement?: AuthorizationElement
  ): IntString {
    const encodedRelayRequestsElement = encodeRelayRequestsElement(relayRequestElement)
    let relayRequestElementCost = toBN(this.contractInteractor.calculateCalldataCost(encodedRelayRequestsElement))
    if (authorizationElement != null) {
      relayRequestElementCost =
        relayRequestElementCost.addn(this.contractInteractor.calculateCalldataCost(encodedRelayRequestsElement))
    }
    return relayRequestElementCost.toString()
  }

  writeSlotsToL2Gas (writeSlotsCount: number): BN {
    return toBN(this.cachingGasConstants.gasPerSlotL2 * writeSlotsCount)
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
  defaultCacheDecoder: BN
  blsSignature: BN[]
  authorizations: AuthorizationElement[]
  relayRequestElements: RelayRequestsElement[]
}

const relayRequestElementToRLPArray = (it: RelayRequestsElement): List => {
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
    it.blsPublicKey,
    it.signature
  ]
}

export function encodeRelayRequestsElement (
  relayRequestsElement: RelayRequestsElement
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
    input.defaultCacheDecoder,
    input.blsSignature[0],
    input.blsSignature[1],
    batchItems,
    approvalItems]
  return bufferToHex(encode(list))
}
