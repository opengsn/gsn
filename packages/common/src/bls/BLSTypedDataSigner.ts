import { BigNumber } from 'ethers'

import * as mcl from './evmbls/mcl'
import { PrefixedHexString } from 'ethereumjs-util'
import { toBN } from 'web3-utils'

export interface BLSKeypair {
  secret: any
  pubkey: any
}

const BigNumberToBN = (it: BigNumber) => toBN(it.toString())

/**
 * The ERC-712 describes the specification of structured data signature, but relies on the ECDSA
 * signing algorithm traditional for Ethereum.
 *
 * Here we implement a similar signature scheme that uses a BLS signatures that rely on precompiles
 * added to the Ethereum protocol since EIP-197.
 *
 */
export class BLSTypedDataSigner {
  readonly blsKeypair: BLSKeypair

  static async newKeypair (): Promise<BLSKeypair> {
    await this.init()
    return mcl.newKeyPair()
  }

  private static async init (): Promise<void> {
    await mcl.init()
    mcl.setMappingMode(mcl.MAPPING_MODE_TI)
    mcl.setDomain('testing-evmbls')
  }

  constructor (_: { keypair: BLSKeypair }) {
    this.blsKeypair = _.keypair
  }

  getPublicKeySerialized (): BN[] {
    return mcl.g2ToBN(this.blsKeypair.pubkey).map(BigNumberToBN)
  }

  async signTypedDataBLS (message: PrefixedHexString): Promise<BN[]> {
    const {
      signature,
      M
    } = mcl.sign(message, this.blsKeypair.secret)
    const messageHashStr = JSON.stringify(mcl.g1ToBN(M))
    console.log('signTypedDataBLS: message hashToPoint: ', messageHashStr)
    return mcl.g1ToBN(signature).map(BigNumberToBN)
  }
}
