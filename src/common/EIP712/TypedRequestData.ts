import { Address } from '../../relayclient/types/Aliases'
import RelayRequest from './RelayRequest'
import { EIP712Domain, EIP712TypedData, EIP712TypeProperty, EIP712Types, TypedDataUtils } from 'eth-sig-util'

import { bufferToHex } from 'ethereumjs-util'
import { PrefixedHexString } from 'ethereumjs-tx'

const EIP712DomainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]

const RelayDataType = [
  { name: 'gasPrice', type: 'uint256' },
  { name: 'pctRelayFee', type: 'uint256' },
  { name: 'baseRelayFee', type: 'uint256' },
  { name: 'relayWorker', type: 'address' },
  { name: 'paymaster', type: 'address' }
]

const ForwardRequestType = [
  { name: 'to', type: 'address' },
  { name: 'data', type: 'bytes' },
  { name: 'value', type: 'uint256' },
  { name: 'from', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'gas', type: 'uint256' }
]

const RelayRequestType = [
  ...ForwardRequestType,
  { name: 'relayData', type: 'RelayData' }
]

interface Types extends EIP712Types {
  EIP712Domain: EIP712TypeProperty[]
  RelayRequest: EIP712TypeProperty[]
  RelayData: EIP712TypeProperty[]
}

export function getDomainSeparator (verifier: Address, chainId: number): any {
  return {
    name: 'GSN Relayed Transaction',
    version: '2',
    chainId: chainId,
    verifyingContract: verifier
  }
}

export function getDomainSeparatorHash (verifier: Address, chainId: number): PrefixedHexString {
  return bufferToHex(TypedDataUtils.hashStruct('EIP712Domain', getDomainSeparator(verifier, chainId), { EIP712Domain: EIP712DomainType }))
}

export default class TypedRequestData implements EIP712TypedData {
  readonly types: Types
  readonly domain: EIP712Domain
  readonly primaryType: string
  readonly message: any

  constructor (
    chainId: number,
    verifier: Address,
    relayRequest: RelayRequest) {
    this.types = {
      EIP712Domain: EIP712DomainType,
      RelayRequest: RelayRequestType,
      RelayData: RelayDataType
    }
    this.domain = getDomainSeparator(verifier, chainId)
    this.primaryType = 'RelayRequest'
    // in the signature, all "request" fields are flattened out at the top structure.
    // other params are inside "relayData" sub-type
    this.message = {
      ...relayRequest.request,
      relayData: relayRequest.relayData
    }
  }
}

export const GsnRequestType = {
  typeName: 'RelayRequest',
  typeSuffix: 'RelayData relayData)RelayData(uint256 gasPrice,uint256 pctRelayFee,uint256 baseRelayFee,address relayWorker,address paymaster)'
}
