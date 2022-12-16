import { PrefixedHexString } from 'ethereumjs-util'
import ow from 'ow'

import { Address } from './Aliases'
import { RelayRequest } from '../EIP712/RelayRequest'

export interface RelayMetadata {
  approvalData: PrefixedHexString
  relayHubAddress: Address
  relayLastKnownNonce: number
  relayRequestId: PrefixedHexString
  relayMaxNonce: number
  signature: PrefixedHexString
  maxAcceptanceBudget: PrefixedHexString
  domainSeparatorName: string
}

export interface RelayTransactionRequest {
  relayRequest: RelayRequest
  metadata: RelayMetadata
}

export const RelayTransactionRequestShape = {
  relayRequest: {
    request: {
      from: ow.string,
      to: ow.string,
      data: ow.string,
      value: ow.string,
      nonce: ow.string,
      gas: ow.string,
      validUntilTime: ow.string
    },
    relayData: {
      maxPriorityFeePerGas: ow.string,
      maxFeePerGas: ow.string,
      transactionCalldataGasUsed: ow.string,
      relayWorker: ow.string,
      paymaster: ow.string,
      paymasterData: ow.string,
      clientId: ow.string,
      forwarder: ow.string
    }
  },
  metadata: {
    domainSeparatorName: ow.string,
    relayLastKnownNonce: ow.number,
    approvalData: ow.string,
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    relayRequestId: ow.string,
    signature: ow.string,
    maxAcceptanceBudget: ow.string
  }
}
