import { PrefixedHexString } from 'ethereumjs-util'
import ow from 'ow'

import { Address } from './Aliases'
import { RelayRequest } from '../EIP712/RelayRequest'

export interface RelayMetadata {
  approvalData: PrefixedHexString
  relayHubAddress: Address
  relayLastKnownNonce: number
  relayMaxNonce: number
  signature: PrefixedHexString
  maxAcceptanceBudget: PrefixedHexString
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
    relayLastKnownNonce: ow.number,
    approvalData: ow.string,
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
    maxAcceptanceBudget: ow.string
  }
}
