import { PrefixedHexString } from 'ethereumjs-util'
import BN from 'bn.js'

import { Address } from '../types/Aliases'

export interface AddressesCachingResult {
  ids: BN[][]
  writeSlotsCount: number
}

export interface CalldataCachingResult {
  cachedEncodedData: PrefixedHexString
  writeSlotsCount: number
}

export interface ICalldataCacheDecoderInteractor {
  getCalldataCacheDecoderAddress: () => Address
  compressCalldata: (abiEncodedCalldata: PrefixedHexString) => Promise<CalldataCachingResult>
}
