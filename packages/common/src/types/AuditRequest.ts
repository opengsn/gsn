import ow from 'ow'
import { PrefixedHexString } from 'ethereumjs-util'

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
