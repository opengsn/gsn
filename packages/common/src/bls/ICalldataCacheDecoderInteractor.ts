import { PrefixedHexString } from 'ethereumjs-util'
import BN from 'bn.js'

import { Address } from '../types/Aliases'

export interface AddressesCachingResult {
  senderAsIds: BN[],
  targetAsIds: BN[],
  paymasterAsIds: BN[],
  cacheDecoders: BN[],
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
