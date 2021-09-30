import BN from 'bn.js'
import { bufferToHex, PrefixedHexString } from 'ethereumjs-util'
import { encode, List } from 'rlp'
import { toBN } from 'web3-utils'

import { RelayRequest } from '../EIP712/RelayRequest'
import { Address, Web3ProviderBaseInterface } from '../types/Aliases'
import { DomainSpecificInputDecompressorInstance } from '@opengsn/contracts'
import { Contract, TruffleContract } from '../LightTruffleContract'
import relayHubAbi from '../interfaces/IRelayHub.json'

// all inputs must be a BN so they are RLP-encoded as values, not strings
// gasLimit of 0 will be replaced with some on-chain hard-coded value for this methodSignature
export interface BatchItem {
  id: BN
  nonce: BN
  paymaster: BN
  sender: BN
  target: BN
  methodSignature: BN
  gasLimit: BN
  methodData: Buffer
}

// TODO: this is to allow RelayServers to add elements to cache without user transactions (TBD)
export interface AddToCacheItem {
  externallyOwnedAccounts: Address[]
  paymasters: Address[]
  recipients: Address[]
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
   * Compress a structure into a {@link BatchItem} that can be efficiently RLP-encoded.
   */
  async relayRequestToBatchItem (batchItemID: BN, relayRequest: RelayRequest): Promise<BatchItem> {
    const nonce = toBN(Date.now())
    const paymaster = toBN(Date.now())
    const sender = await this.addressToId(relayRequest.request.from, SeparatelyCachedAddressTypes.eoa)
    const target = await this.addressToId(relayRequest.request.to, SeparatelyCachedAddressTypes.recipients)
    const methodSignature = toBN(0xffffffff)
    const gasLimit = toBN(Date.now())
    const methodData = Buffer.from([10, 12, 14])
    return {
      id: batchItemID,
      nonce,
      paymaster,
      sender,
      target,
      methodSignature,
      gasLimit,
      methodData
    }
  }

  async addressToId (address: Address, type: SeparatelyCachedAddressTypes): Promise<BN> {
    return toBN(address)
  }
}

export function encodeBatch (
  _: {
    maxAcceptanceBudget: BN
    blsSignature: BN[]
    items: BatchItem[]
    addToCache?: AddToCacheItem
  }
): PrefixedHexString {
  const batchItems: List[] = _.items.map(it => { return [it.id, it.nonce, it.paymaster, it.sender, it.target, it.gasLimit, it.methodSignature, it.methodData] })
  const list: List = [
    _.maxAcceptanceBudget,
    _.blsSignature[0],
    _.blsSignature[1],
    batchItems]
  return bufferToHex(encode(list))
}
