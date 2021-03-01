import ow from 'ow'
import { PrefixedHexString } from 'ethereumjs-tx'

export interface AuditRequest {
  signedTx: PrefixedHexString
}

export interface AuditResponse {
  commitTxHash?: PrefixedHexString
  message?: string
}

export const AuditRequestShape = {
  signedTx: ow.string
}
