import ow from 'ow'
import { PrefixedHexString } from 'ethereumjs-tx'

export interface PenalizeRequest {
  signedTx: PrefixedHexString
}

export interface PenalizeResponse {
  penalizeTxHash?: PrefixedHexString
  message?: string
}

export const PenalizeRequestShape = {
  signedTx: ow.string
}
