import BN from 'bn.js'
import { bufferToHex, PrefixedHexString } from 'ethereumjs-util'
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

// all inputs must be a BN so they are RLP-encoded as values, not strings
// gasLimit of 0 will be replaced with some on-chain hard-coded value for this methodSignature
export interface RelayRequestsElement {
  id: BN
  nonce: BN
  paymaster: BN
  sender: BN
  target: BN
  gasLimit: BN
  calldataGas: BN
  methodData: Buffer
  cacheDecoder: BN
}

export interface SignedKeyAuthorization {
  authorizer: Address
  blsPublicKey: BN[]
  signature: string
}

enum SeparatelyCachedAddressTypes {
  paymasters,
  recipients,
  eoa
}

enum ERC20MethodSignatures {
  Transfer,
  TransferFrom,
  Approve,
  Mint,
  Burn,
  Permit
}

/**
 * Interacts with a 'Decompressor' contract in order to substitute actual values with their cached IDs.
 */
export class CacheDecodersInteractor {
  private readonly provider: Web3ProviderBaseInterface
  private readonly BatchGatewayCacheDecoder: Contract<BatchGatewayCacheDecoderInstance>
  private readonly ERC20CacheDecoder: Contract<ERC20CacheDecoderInstance>

  private decompressor!: BatchGatewayCacheDecoderInstance
  private erc20cacheDecoder!: ERC20CacheDecoderInstance

  constructor (_: {
    provider: Web3ProviderBaseInterface
  }) {
    this.provider = _.provider
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
   */
  async compressRelayRequest (batchItemID: BN, relayRequest: RelayRequest): Promise<RelayRequestsElement> {
    const nonce = toBN(relayRequest.request.nonce)
    const paymaster = toBN(relayRequest.relayData.paymaster)
    const sender = await this.addressToId(relayRequest.request.from, SeparatelyCachedAddressTypes.eoa)
    const target = await this.addressToId(relayRequest.request.to, SeparatelyCachedAddressTypes.recipients)
    const gasLimitBN = toBN(relayRequest.request.gas)
    // https://github.com/indutny/bn.js/issues/112#issuecomment-190560276
    // "I can't really think about anything other than rn? Like returns number." srsly?
    if (gasLimitBN.modn(10000) !== 0) {
      throw new Error('gas limit must be a multiple of 10000')
    }
    const gasLimit = gasLimitBN.divn(10000)
    const calldataGas = toBN(relayRequest.relayData.transactionCalldataGasUsed)
    const methodData = Buffer.from(relayRequest.request.data.replace('0x', ''), 'hex')
    const cacheDecoder = toBN(1) // use encodedData as-is
    return {
      id: batchItemID,
      nonce,
      paymaster,
      sender,
      target,
      gasLimit,
      calldataGas,
      methodData,
      cacheDecoder
    }
  }

  async compressErc20Transfer (destination: Address, value: IntString): Promise<PrefixedHexString> {
    const destinationId = await this.erc20addressToId(destination)
    const methodSig = toBN(ERC20MethodSignatures.Transfer)
    const list: List = [methodSig, destinationId, toBN(value)]
    return bufferToHex(encode(list))
  }

  async compressErc20Approve (): Promise<PrefixedHexString> {
    return ''
  }

  // TODO: either a) separate this class into many or b) find a better way to organize this
  async addressToId (address: Address, type: SeparatelyCachedAddressTypes): Promise<BN> {
    return toBN(address)
  }

  async erc20addressToId (address: Address): Promise<BN> {
    const [compressedAddress] = await this.erc20cacheDecoder.convertAddressesToIds([address])
    return compressedAddress
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
  authorizations: SignedKeyAuthorization[]
  relayRequestElements: RelayRequestsElement[]
}

export function encodeBatch (
  input: RLPBatchCompressedInput
): PrefixedHexString {
  const batchItems: List[] = input.relayRequestElements.map(it => {
    return [
      it.id,
      it.nonce,
      it.paymaster,
      it.sender,
      it.target,
      it.gasLimit,
      it.calldataGas,
      it.methodData,
      it.cacheDecoder
    ]
  })
  const approvalItems: List[] = input.authorizations?.map(it => { return [it.authorizer, it.blsPublicKey, it.signature] }) ?? []
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
