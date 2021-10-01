import { EIP712Domain, EIP712TypedData, EIP712TypeProperty, EIP712Types } from 'eth-sig-util'

import { Address, IntString } from '../types/Aliases'
import { EIP712DomainType, getDomainSeparator } from '../EIP712/TypedRequestData'

const ApprovalDataType = [
  { name: 'blsPublicKey0', type: 'uint256' },
  { name: 'blsPublicKey1', type: 'uint256' },
  { name: 'blsPublicKey2', type: 'uint256' },
  { name: 'blsPublicKey3', type: 'uint256' },
  { name: 'clientMessage', type: 'string' }
]

export interface ApprovalDataInterface {
  blsPublicKey0: IntString
  blsPublicKey1: IntString
  blsPublicKey2: IntString
  blsPublicKey3: IntString
  clientMessage: string
}

interface Types extends EIP712Types {
  EIP712Domain: EIP712TypeProperty[]
  ApprovalData: EIP712TypeProperty[]
}

export class TypedApprovalData implements EIP712TypedData {
  readonly types: Types
  readonly domain: EIP712Domain
  readonly primaryType: string
  readonly message: any

  constructor (
    chainId: number,
    verifier: Address,
    approvalData: ApprovalDataInterface) {
    this.types = {
      EIP712Domain: EIP712DomainType,
      ApprovalData: ApprovalDataType
    }
    this.domain = getDomainSeparator(verifier, chainId)
    this.primaryType = 'ApprovalData'
    // in the signature, all "request" fields are flattened out at the top structure.
    this.message = {
      ...approvalData
    }
  }
}
