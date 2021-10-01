/**
 * The ERC-712 describes the specification of structured data signature, but relies on the ECDSA
 * signing algorithm traditional for Ethereum.
 *
 * Here we implement a similar signature scheme that uses a BLS signatures that rely on precompiles
 * added to the Ethereum protocol since EIP-197.
 *
 */
import * as mcl from './evmbls/mcl'
import { randHex } from './evmbls/utils'
import { BigNumber } from 'ethers'
import { Address } from '../types/Aliases'
import { PrefixedHexString } from 'ethereumjs-util'

export interface BLSKeypair {
  secret: any
  pubkey: string[]
}

export class BLSTypedDataSigner {
  readonly blsKeypair: BLSKeypair

  static async newKeypair (): Promise<BLSKeypair> {
    await mcl.init()
    mcl.setDomain('testing-evmbls')
    return mcl.newKeyPair()
  }

  constructor (_: { keypair: BLSKeypair }) {
    this.blsKeypair = _.keypair
  }

  signTypedDataBLS (): BigNumber[] {
    mcl.setMappingMode(mcl.MAPPING_MODE_TI)
    mcl.setDomain('testing evmbls')
    const message = '0xdeadbeef'
    // randHex(12) // <<-- signing random 12 byte hex string though
    // const {
    //   secret
    // } = mcl.newKeyPair()
    const {
      signature
    } = mcl.sign(message, this.blsKeypair.secret)
    // let message_ser = mcl.g1ToBN(M)
    // let pubkey_ser = mcl.g2ToBN(pubkey)
    return mcl.g1ToBN(signature)
  }

  /**
   * Sign the BLS public key with an ECDSA private key of the user, and also sign the derived Ethereum address
   * with the corresponding BLS private key.
   * @param ethereumAddress
   * @param blsKeypair
   * @returns authorisation - a serialized data used by the Gateway to authorise the public key in the first run
   */
  crossSignAccountAuthorisation(ethereumAddress: Address, blsKeypair: BLSKeypair): PrefixedHexString {
    return ''
  }
}
