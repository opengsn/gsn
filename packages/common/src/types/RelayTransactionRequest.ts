import { PrefixedHexString } from 'ethereumjs-util'
import ow from 'ow'

import { Address } from './Aliases'
import { RelayRequest } from '../EIP712/RelayRequest'
import { AuthorizationElement } from '../bls/CacheDecoderInteractor'

export interface RelayMetadata {
  approvalData: PrefixedHexString
  relayHubAddress: Address
  relayMaxNonce: number
  signature: PrefixedHexString
  maxAcceptanceBudget: PrefixedHexString
  calldataCacheDecoder?: Address
  authorization?: AuthorizationElement
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
      validUntil: ow.string
    },
    relayData: {
      gasPrice: ow.string,
      pctRelayFee: ow.string,
      baseRelayFee: ow.string,
      transactionCalldataGasUsed: ow.string,
      relayWorker: ow.string,
      paymaster: ow.string,
      paymasterData: ow.string,
      clientId: ow.string,
      forwarder: ow.string
    }
  },
  metadata: {
    approvalData: ow.string,
    relayHubAddress: ow.string,
    relayMaxNonce: ow.number,
    signature: ow.string,
    maxAcceptanceBudget: ow.string,
    calldataCacheDecoder: ow.any(ow.string, ow.undefined),
    authorization: ow.object // TODO - define authorization's shape
  }
}
