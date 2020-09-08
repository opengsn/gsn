import { PrefixedHexString } from 'ethereumjs-tx'

import { Address } from './Aliases'
import RelayRequest from '../../common/EIP712/RelayRequest'

export interface RelayMetadata {
  approvalData: PrefixedHexString
  relayHubAddress: Address
  relayMaxNonce: number
  signature: PrefixedHexString
}

export interface RelayTransactionRequest {
  relayRequest: RelayRequest
  metadata: RelayMetadata
}
