import { PrefixedHexString } from 'ethereumjs-tx'

import PingResponse from '../../common/PingResponse'
import RelayRequest from '../../common/EIP712/RelayRequest'
import RelayRegisteredEventInfo from './RelayRegisteredEventInfo'
import GsnTransactionDetails from './GsnTransactionDetails'

export type Address = string
export type IntString = string

export type PingFilter = (pingResponse: PingResponse, gsnTransactionDetails: GsnTransactionDetails) => void
export type AsyncApprove = (relayRequest: RelayRequest) => Promise<PrefixedHexString>
export type RelayFilter = (registeredEventInfo: RelayRegisteredEventInfo) => boolean
