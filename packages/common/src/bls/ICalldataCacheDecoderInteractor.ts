import { PrefixedHexString } from 'ethereumjs-util'

import { Address } from '../types/Aliases'

export interface CalldataCachingResult {
  cachedEncodedData: PrefixedHexString
  writeSlotsCount: number
}

export interface ICalldataCacheDecoderInteractor {
  getCalldataCacheDecoderAddress: () => Address
  compressCalldata: (abiEncodedCalldata: PrefixedHexString) => Promise<CalldataCachingResult>
}
