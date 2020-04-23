import { PrefixedHexString } from 'ethereumjs-tx'

import PingResponse from '../../common/PingResponse'
import RelayRequest from '../../common/EIP712/RelayRequest'
import GsnTransactionDetails from './GsnTransactionDetails'
import RelayFailureInfo from './RelayFailureInfo'
import { RelayRegisteredEventInfo } from './RelayRegisteredEventInfo'

export type Address = string
export type IntString = string
/**
 * For legacy reasons, to filter out the relay this filter has to throw.
 * TODO: make ping filtering sane!
 */
export type PingFilter = (pingResponse: PingResponse, gsnTransactionDetails: GsnTransactionDetails) => void
export type AsyncApprovalData = (relayRequest: RelayRequest) => Promise<PrefixedHexString>
export type RelayFilter = (registeredEventInfo: RelayRegisteredEventInfo) => boolean
export type AsyncScoreCalculator = (relay: RelayRegisteredEventInfo, txDetails: GsnTransactionDetails, failures: RelayFailureInfo[]) => Promise<number>
