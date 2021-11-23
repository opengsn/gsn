import { PrefixedHexString } from 'ethereumjs-util'
import BN from 'bn.js'

export interface AddressesCachingResult {
  ids: BN[][]
  writeSlotsCount: number
}

export interface CalldataCachingResult {
  cachedEncodedData: PrefixedHexString
  writeSlotsCount: number
}

export interface ICalldataCacheDecoderInteractor {
  compressCalldata: (abiEncodedCalldata: PrefixedHexString) => Promise<CalldataCachingResult>
}
