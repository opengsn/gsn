import { PrefixedHexString } from 'ethereumjs-util'
import ow from 'ow'

import { Address } from './Aliases'
import { RelayRequest } from '../EIP712/RelayRequest'

export interface RelayMetadata {
  approvalData: PrefixedHexString
  relayHubAddress: Address
  relayMaxNonce: number
  signature: PrefixedHexString
  maxAcceptanceBudget: PrefixedHexString
}

export interface BaseRelayTransactionRequest {
  metadata: RelayMetadata
}

export interface RelayTransactionRequest extends BaseRelayTransactionRequest {
  relayRequest: RelayRequest
}

const requestShape = {
    from: ow.string,
      to: ow.string,
      data: ow.string,
      value: ow.string,
      nonce: ow.string,
      gas: ow.string,
      validUntil: ow.string
}

  const metadataShape = {
    approvalData: ow.string,
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
    maxAcceptanceBudget: ow.string
}

  const baseRelayDataShape = {
    pctRelayFee: ow.string,
    baseRelayFee: ow.string,
    transactionCalldataGasUsed: ow.string,
    relayWorker: ow.string,
    paymaster: ow.string,
    paymasterData: ow.string,
    clientId: ow.string,
    forwarder: ow.string
}

export const RelayTransactionRequestShape = {
  relayRequest: {
    request: requestShape,
    relayData: {
      maxPriorityFeePerGas: ow.string,
      maxFeePerGas: ow.string,
      ...baseRelayDataShape
    }
  },
  metadata: metadataShape
}
