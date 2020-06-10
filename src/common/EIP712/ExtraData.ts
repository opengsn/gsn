import { Address } from '../../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

import { getDomainSeparatorHash } from './TypedRequestData'

// extra request data. this data is not signed as part of the struct passed to sendTypedData
// (they are signed, though, as the forwarder is hashed into the domain-separator
export default interface ExtraData {
  forwarder: Address
  domainSeparator: PrefixedHexString // calculated. should use same value as in signTypedData, and sending on-chain
}

export function extraDataWithDomain (forwarder: Address, chainId: number): ExtraData {
  return {
    forwarder,
    domainSeparator: getDomainSeparatorHash(forwarder, chainId)
  }
}
