import BN from 'bn.js'
import { bufferToHex, PrefixedHexString } from 'ethereumjs-util'
import { encode, List } from 'rlp'
import { toBN } from 'web3-utils'

import { DomainSpecificInputDecompressorInstance } from '@opengsn/contracts'

import { Address, Web3ProviderBaseInterface } from '../types/Aliases'
import { Contract, TruffleContract } from '../LightTruffleContract'
import { RelayRequest } from '../EIP712/RelayRequest'

import relayHubAbi from '../interfaces/IRelayHub.json'

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
  methodSignature: BN
  methodData: Buffer
}

export interface SignedKeyAuthorization {
  authorizer: Address
  blsPublicKey: BN[]
  signature: string
}

// TODO: this is to allow RelayServers to add elements to cache without user transactions (TBD)
export interface AddToCacheItem {
  externallyOwnedAccounts: Address[]
  paymasters: Address[]
  recipients: Address[]
}

export const none: AddToCacheItem = {
  externallyOwnedAccounts: [],
  paymasters: [],
  recipients: []
}

enum SeparatelyCachedAddressTypes {
  paymasters,
  recipients,
  eoa
}

/**
 * Interacts with a 'Decompressor' contract in order to substitute actual values with their cached IDs.
 */
export class DecompressorInteractor {
  private readonly provider: Web3ProviderBaseInterface
  private readonly DomainSpecificInputDecompressor: Contract<DomainSpecificInputDecompressorInstance>

  private decompressor!: DomainSpecificInputDecompressorInstance

  constructor (_: {
    provider: Web3ProviderBaseInterface
  }) {
    this.provider = _.provider
    this.DomainSpecificInputDecompressor = TruffleContract({
      contractName: 'IRelayHub',
      abi: relayHubAbi
    })

    this.DomainSpecificInputDecompressor.setProvider(this.provider, undefined)
  }

  async init (_: { decompressorAddress: Address }): Promise<this> {
    this.decompressor = await this.DomainSpecificInputDecompressor.at(_.decompressorAddress)
    return this
  }

  /**
   * Compress a structure into a {@link RelayRequestsElement} that can be efficiently RLP-encoded.
   */
  async compressRelayRequest (batchItemID: BN, relayRequest: RelayRequest): Promise<RelayRequestsElement> {
    const nonce = toBN(Date.now())
    const paymaster = toBN(Date.now())
    const sender = await this.addressToId(relayRequest.request.from, SeparatelyCachedAddressTypes.eoa)
    const target = await this.addressToId(relayRequest.request.to, SeparatelyCachedAddressTypes.recipients)
    const methodSignature = toBN(0xffffffff)
    const gasLimit = toBN(Date.now())
    const calldataGas = toBN(relayRequest.relayData.transactionCalldataGasUsed)
    const methodData = Buffer.from([10, 12, 14])
    return {
      id: batchItemID,
      nonce,
      paymaster,
      sender,
      target,
      methodSignature,
      gasLimit,
      calldataGas,
      methodData
    }
  }

  async addressToId (address: Address, type: SeparatelyCachedAddressTypes): Promise<BN> {
    return toBN(address)
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
  blsSignature: BN[]
  authorizations: SignedKeyAuthorization[]
  relayRequestElements: RelayRequestsElement[]
  addToCache: AddToCacheItem
}

export function encodeBatch (
  input: RLPBatchCompressedInput
): PrefixedHexString {
  const batchItems: List[] = input.relayRequestElements.map(it => { return [it.id, it.nonce, it.paymaster, it.sender, it.target, it.gasLimit, it.calldataGas, it.methodSignature, it.methodData] })
  const approvalItems: List[] = input.authorizations?.map(it => { return [it.authorizer, it.blsPublicKey, it.signature] }) ?? []
  const list: List = [
    input.gasPrice,
    input.validUntil,
    input.relayWorker,
    input.pctRelayFee,
    input.baseRelayFee,
    input.maxAcceptanceBudget,
    input.blsSignature[0],
    input.blsSignature[1],
    batchItems,
    approvalItems]
  return bufferToHex(encode(list))
}
