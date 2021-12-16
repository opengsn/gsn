import { BigNumber } from 'ethers'
import { PrefixedHexString } from 'ethereumjs-util'
import { toBN, toHex } from 'web3-utils'

import { RelayRequest } from '../EIP712/RelayRequest'

import {
  MAPPING_MODE_TI,
  aggreagate,
  g1ToBN,
  g2ToBN,
  init,
  mclToHex,
  newFp,
  newG1,
  newKeyPair,
  setDomain,
  setMappingMode,
  sign,
  SecretKey,
  PublicKey,
  deserializeHexStrToFr, secretToPubkey, hashToPoint
} from './evmbls/mcl'
import { abiEncodeAuthorizationElement, abiEncodeRelayRequest } from '../Utils'
import { AuthorizationElement } from './CacheDecoderInteractor'

export interface InternalBLSKeypairType {
  secret: SecretKey // FR
  pubkey: PublicKey // G2
}

// TODO: an interface for this class should not leak any internal structures and use strings exclusively
export interface ExternalBLSKeypairType {
  secret: string
  pubkey: string[]
}

export const BigNumberToBN = (it: BigNumber): BN => toBN(it.toString())
export const BigNumberToHex = (it: BigNumber): PrefixedHexString => toHex(it.toString())

export function getPublicKeySerialized (pubkey: PublicKey): PrefixedHexString[] {
  return g2ToBN(pubkey).map(BigNumberToHex)
}

/**
 * The ERC-712 describes the specification of structured data signature, but relies on the ECDSA
 * signing algorithm traditional for Ethereum.
 *
 * Here we implement a similar signature scheme that uses a BLS signatures that rely on precompiles
 * added to the Ethereum protocol since EIP-197.
 *
 */
export class BLSTypedDataSigner {
  blsKeypair?: InternalBLSKeypairType

  async newKeypair (): Promise<InternalBLSKeypairType> {
    await this.init()
    return newKeyPair()
  }

  aggregateSignatures (signatures: PrefixedHexString[][]): BN[] {
    let aggSignature = newG1()
    for (const signature of signatures) {
      const signatureG1 = BLSTypedDataSigner._hex_to_mcl_G1_type(signature)
      aggSignature = aggreagate(aggSignature, signatureG1)
    }
    return BLSTypedDataSigner.g1SignatureToBN(aggSignature)
  }

  static _hex_to_mcl_G1_type (hex: PrefixedHexString[]): any {
    // if (hex[0].length !== 64 || hex[1].length !== 64) {
    //   console.error('_hex_to_mcl_G1_type: Incorrect hex signature string length!')
    // }
    // TODO: verify this is the right thing to do
    const hexX = hex[0].replace('0x', '').padStart(64, '0')
    const hexY = hex[1].replace('0x', '').padStart(64, '0')
    const hexZ = hex[2].replace('0x', '').padStart(64, '0')
    const bufferX = Buffer.from(hexX, 'hex').reverse()
    const bufferY = Buffer.from(hexY, 'hex').reverse()
    const bufferZ = Buffer.from(hexZ, 'hex').reverse()
    const x = newFp()
    const y = newFp()
    const z = newFp()
    const p = newG1()
    x.deserialize(bufferX)
    y.deserialize(bufferY)
    z.deserialize(bufferZ)
    p.setX(x)
    p.setY(y)
    p.setZ(z)

    // console.log(`_hex_to_mcl_G1_type input: ${JSON.stringify(hex)} output: ${JSON.stringify(g1ToHex(p))}`)

    return p
  }

  async init (): Promise<void> {
    await init()
    setMappingMode(MAPPING_MODE_TI)
    setDomain('testing-evmbls')
  }

  setKeypair (blsKeypair: InternalBLSKeypairType): void {
    this.blsKeypair = blsKeypair
  }

  getPublicKeySerialized (): PrefixedHexString[] {
    if (this.blsKeypair == null) {
      throw new Error('No BLS key')
    }
    return getPublicKeySerialized(this.blsKeypair.pubkey)
  }

  getPrivateKeySerialized (): PrefixedHexString {
    if (this.blsKeypair == null) {
      throw new Error('No BLS key')
    }
    return this.blsKeypair.secret.serializeToHexStr()
  }

  static deserializeHexStringKeypair (serializedSecretKey: PrefixedHexString): InternalBLSKeypairType {
    const secret = deserializeHexStrToFr(serializedSecretKey)
    const pubkey = secretToPubkey(secret)
    return {
      secret,
      pubkey
    }
  }

  // TODO: duplicated code for R.R. and A.E., refactor!
  async signAuthorizationElementBLS (authorizationElement: AuthorizationElement): Promise<BN[]> {
    const message = await abiEncodeAuthorizationElement(authorizationElement)
    return await this.signMessageWithBLS(message)
  }

  async signRelayRequestBLS (relayRequest: RelayRequest): Promise<BN[]> {
    const relayRequestEncoded = abiEncodeRelayRequest(relayRequest)
    return await this.signMessageWithBLS(relayRequestEncoded)
  }

  async relayRequestToG1Point (relayRequest: RelayRequest): Promise<BN[]> {
    const message = abiEncodeRelayRequest(relayRequest)
    const m = hashToPoint(message)
    return BLSTypedDataSigner.g1SignatureToBN(m)
  }

  async authorizationElementToG1Point (authorizationElement: AuthorizationElement): Promise<BN[]> {
    const message = abiEncodeAuthorizationElement(authorizationElement)
    const m = hashToPoint(message)
    return BLSTypedDataSigner.g1SignatureToBN(m)
  }

  async signMessageWithBLS (message: PrefixedHexString): Promise<BN[]> {
    if (this.blsKeypair == null) {
      throw new Error('No BLS key')
    }
    const {
      signature
    } = sign(message, this.blsKeypair.secret)
    return BLSTypedDataSigner.g1SignatureToBN(signature)
  }

  private static g1SignatureToBN (signature: any): BN[] {
    const signatureBN = g1ToBN(signature).map(BigNumberToBN)
    const signatureZasBN = toBN(mclToHex(signature.getZ()))
    signatureBN.push(signatureZasBN)
    // const hexX = signatureBN[0].toString('hex')
    // const hexY = signatureBN[1].toString('hex')
    // const hexZ = signatureBN[2].toString('hex')
    // console.log('g1SignatureToBN: signature: ', hexX, hexX.length, hexY, hexY.length, hexZ, hexZ.length)
    return signatureBN
  }

  // TODO
  static bnArrayToHex (signature: BN[]): PrefixedHexString {
    const strings = signature.map((it: BN) => { return it.toString('hex') })
    return JSON.stringify(strings)
  }

  // TODO
  static hexStringToArrayBN (signature: PrefixedHexString): BN[] {
    const array: string[] = JSON.parse(signature)
    return array.map(toBN)
  }
}
