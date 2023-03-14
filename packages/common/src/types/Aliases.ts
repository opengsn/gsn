import { PrefixedHexString } from 'ethereumjs-util'
import { JsonRpcProvider, Log } from '@ethersproject/providers'
import { LogDescription } from '@ethersproject/abi'

import { PingResponse } from '../PingResponse'
import { RelayRequest } from '../EIP712/RelayRequest'
import { GsnTransactionDetails } from './GsnTransactionDetails'
import { RegistrarRelayInfo, PartialRelayInfo } from './RelayInfo'
import { TypedMessage } from '@metamask/eth-sig-util'
import { Environment } from '../environments/Environments'

export type Address = string
export type EventName = string
export type IntString = string
export type SemVerString = string
/**
 * For legacy reasons, to filter out the relay this filter has to throw.
 * TODO: make ping filtering sane!
 */
export type PingFilter = (pingResponse: PingResponse, gsnTransactionDetails: GsnTransactionDetails) => void

/**
 * As the "PaymasterData" is included in the user-signed request, it cannot have access to the "relayRequestId" value.
 */
export type PaymasterDataCallback = (relayRequest: RelayRequest) => Promise<PrefixedHexString>

export type ApprovalDataCallback = (relayRequest: RelayRequest, relayRequestId: PrefixedHexString) => Promise<PrefixedHexString>

export type SignTypedDataCallback = (signedData: TypedMessage<any>, from: Address) => Promise<PrefixedHexString>

/**
 * Different L2 rollups and side-chains have different behavior for the calldata gas cost.
 * This means the calldata estimation cannot be hard-coded and new implementations should be easy to add.
 * Note that both Relay Client and Relay Server must come to the same number.
 * Also, this value does include the base transaction cost (2100 on mainnet).
 */
export type CalldataGasEstimation = (calldata: PrefixedHexString, environment: Environment, calldataEstimationSlackFactor: number, provider: JsonRpcProvider) => Promise<number>

export type RelayFilter = (registrarRelayInfo: RegistrarRelayInfo) => boolean

export type EventData = Log & LogDescription

export function notNull<TValue> (value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined
}

/**
 * This is an intersection of NPM log levels and 'loglevel' library methods.
 */
export type NpmLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'

export interface RelaySelectionResult {
  relayInfo: PartialRelayInfo
  maxDeltaPercent: number
  updatedGasFees: EIP1559Fees
}

export interface EIP1559Fees {
  maxFeePerGas: PrefixedHexString
  maxPriorityFeePerGas: PrefixedHexString
}

export interface ObjectMap<T> {
  [key: string]: T
}
