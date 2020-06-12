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

const GasDataType = [
  { name: 'gasPrice', type: 'uint256' },
  { name: 'pctRelayFee', type: 'uint256' },
  { name: 'baseRelayFee', type: 'uint256' }
]

const RelayDataType = [
  { name: 'relayWorker', type: 'address' },
  { name: 'paymaster', type: 'address' }
]

const ForwardRequestType = [
  { name: 'to', type: 'address' },
  { name: 'data', type: 'bytes' },
  { name: 'from', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'gas', type: 'uint256' }
]

const RelayRequestType = [
  { name: 'request', type: '_ForwardRequest' },
  { name: 'gasData', type: 'GasData' },
  { name: 'relayData', type: 'RelayData' }
]

interface Types extends EIP712Types {
  EIP712Domain: EIP712TypeProperty[]
  RelayRequest: EIP712TypeProperty[]
  GasData: EIP712TypeProperty[]
  RelayData: EIP712TypeProperty[]
  _ForwardRequest: EIP712TypeProperty[]
}

export function getDomainSeparator (verifier: Address, chainId: number): any {
  return {
    name: 'GSN Relayed Transaction',
    version: '2',
    chainId: 1234, // chainId,
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
  readonly message: RelayRequest

  constructor (
    chainId: number,
    verifier: Address,
    relayRequest: RelayRequest) {
    this.types = {
      EIP712Domain: EIP712DomainType,
      RelayRequest: RelayRequestType,
      GasData: GasDataType,
      RelayData: RelayDataType,
      _ForwardRequest: ForwardRequestType
    }
    this.domain = getDomainSeparator(verifier, chainId)
    this.primaryType = 'RelayRequest'
    this.message = relayRequest
  }
}
