import { PrefixedHexString } from 'ethereumjs-tx'

import PingResponse from '../../common/PingResponse'
import RelayRequest from '../../common/EIP712/RelayRequest'
import RelayRegisteredEventInfo from './RelayRegisteredEventInfo'

export type Address = string
export type IntString = string
export type Bytes = number[]

export type PingFilter = (pingResponse: PingResponse) => void
export type AsyncApprove = (relayRequest: RelayRequest) => Promise<PrefixedHexString>
export type RelayFilter = (registeredEventInfo: RelayRegisteredEventInfo) => boolean
