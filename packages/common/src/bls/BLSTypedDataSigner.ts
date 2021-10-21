import Web3 from 'web3'
import { BigNumber } from 'ethers'
import { PrefixedHexString } from 'ethereumjs-util'
import { toBN } from 'web3-utils'

import { RelayRequest } from '../EIP712/RelayRequest'

import {
  MAPPING_MODE_TI,
  aggreagate,
  g1ToBN,
  g1ToHex,
  g2ToBN,
  init,
  mclToHex,
  newFp,
  newG1,
  newKeyPair,
  setDomain,
  setMappingMode,
  sign,
  newG2,
  newFp2,
  SecretKey,
  PublicKey,
  deserializeHexStrToFr, secretToPubkey
} from './evmbls/mcl'

export interface InternalBLSKeypairType {
  secret: SecretKey
  pubkey: PublicKey
}

export const BigNumberToBN = (it: BigNumber): BN => toBN(it.toString())

/**
 * The ERC-712 describes the specification of structured data signature, but relies on the ECDSA
 * signing algorithm traditional for Ethereum.
 *
 * Here we implement a similar signature scheme that uses a BLS signatures that rely on precompiles
 * added to the Ethereum protocol since EIP-197.
 *
 */
export class BLSTypedDataSigner {
  readonly blsKeypair: InternalBLSKeypairType

  static async newKeypair (): Promise<InternalBLSKeypairType> {
    await this.init()
    return newKeyPair()
  }

  aggregateSignatures (signatures: PrefixedHexString[][]): BN[] {
    let aggSignature = newG1()
    for (const signature of signatures) {
      const signatureG1 = BLSTypedDataSigner._hex_to_mcl_G1_type(signature)
      aggSignature = aggreagate(aggSignature, signatureG1)
      console.log('A')
      BLSTypedDataSigner.g1SignatureToBN(signatureG1) // REMOVE: logging only
      BLSTypedDataSigner.g1SignatureToBN(aggSignature) // REMOVE: logging only
      console.log('B')
    }
    return BLSTypedDataSigner.g1SignatureToBN(aggSignature)
  }

  static _hex_to_mcl_G2_type (hex: PrefixedHexString[]): any {
    // reverse this:
    //
    // export function g2ToBN (p: mclG2) {
    //   const x = mclToHex(p.getX(), false)
    //   const y = mclToHex(p.getY(), false)
    //   return [
    //     toBig('0x' + x.slice(64)),
    //     toBig('0x' + x.slice(0, 64)),
    //     toBig('0x' + y.slice(64)),
    //     toBig('0x' + y.slice(0, 64)),
    //   ]
    // }

    const xStr = `0x${hex[0].replace('0x', '').padStart(64, '0')}${hex[1].replace('0x', '').padStart(64, '0')}`
    const yStr = `0x${hex[2].replace('0x', '').padStart(64, '0')}${hex[3].replace('0x', '').padStart(64, '0')}`

    const x = newFp2()
    const y = newFp2()
    const z = newFp2()
    const p = newG2()

    // Do not commit - does not work
    x.deserialize(Buffer.from(xStr))
    y.deserialize(Buffer.from(yStr))
    z.deserialize(Buffer.from([1]))
    p.setX(x)
    p.setY(y)
    p.setZ(z)

    console.log(`_hex_to_mcl_G2_type input: ${JSON.stringify(hex)} output: ${JSON.stringify(g1ToHex(p))}`)

    return p
  }

  static _hex_to_mcl_G1_type (hex: PrefixedHexString[]): any {
    if (hex[0].length !== 64 || hex[1].length !== 64) {
      console.error('_hex_to_mcl_G1_type: Incorrect hex signature string length!')
    }
    // TODO: verify this is the right thing to do
    const hexX = hex[0].padStart(64, '0')
    const hexY = hex[1].padStart(64, '0')
    const hexZ = hex[2].padStart(64, '0')
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

    console.log(`_hex_to_mcl_G1_type input: ${JSON.stringify(hex)} output: ${JSON.stringify(g1ToHex(p))}`)

    return p
  }

  private static async init (): Promise<void> {
    await init()
    setMappingMode(MAPPING_MODE_TI)
    setDomain('testing-evmbls')
  }

  constructor (_: { keypair: InternalBLSKeypairType }) {
    this.blsKeypair = _.keypair
  }

  getPublicKeySerialized (): BN[] {
    return g2ToBN(this.blsKeypair.pubkey).map(BigNumberToBN)
  }

  getPrivateKeySerialized (): PrefixedHexString {
    return this.blsKeypair.secret.serializeToHexStr()
  }

  deserializeHexStringKeypair (serializedSecretKey: PrefixedHexString): InternalBLSKeypairType {
    const secret = deserializeHexStrToFr(serializedSecretKey)
    const pubkey = secretToPubkey(secret)
    return {
      secret,
      pubkey
    }
  }

  async signRelayRequestBLS (relayRequest: RelayRequest): Promise<BN[]> {
    const web3 = new Web3()
    const types = ['tuple(tuple(address,address,uint256,uint256,uint256,bytes,uint256),tuple(uint256,uint256,uint256,uint256,address,address,address,bytes,uint256))']
    const parameters = [
      [
        [
          relayRequest.request.from,
          relayRequest.request.to,
          relayRequest.request.value,
          relayRequest.request.gas,
          relayRequest.request.nonce,
          relayRequest.request.data,
          relayRequest.request.validUntil
        ],
        [
          relayRequest.relayData.gasPrice,
          relayRequest.relayData.pctRelayFee,
          relayRequest.relayData.baseRelayFee,
          relayRequest.relayData.transactionCalldataGasUsed,
          relayRequest.relayData.relayWorker,
          relayRequest.relayData.paymaster,
          relayRequest.relayData.forwarder,
          relayRequest.relayData.paymasterData,
          relayRequest.relayData.clientId
        ]
      ]
    ]
    const relayRequestEncoded = web3.eth.abi.encodeParameters(types, parameters)
    console.log('signRelayRequestBLS: ', relayRequestEncoded)
    return await this.signTypedDataBLS(relayRequestEncoded)
  }

  // TODO: rename
  async signTypedDataBLS (message: PrefixedHexString): Promise<BN[]> {
    const {
      signature,
      M
    } = sign(message, this.blsKeypair.secret)
    const messageHashStr = JSON.stringify(g1ToBN(M))
    console.log('signTypedDataBLS: message hashToPoint: ', messageHashStr)
    return BLSTypedDataSigner.g1SignatureToBN(signature)
  }

  private static g1SignatureToBN (signature: any): BN[] {
    const signatureBN = g1ToBN(signature).map(BigNumberToBN)
    const signatureZasBN = toBN(mclToHex(signature.getZ()))
    signatureBN.push(signatureZasBN)
    const hexX = signatureBN[0].toString('hex')
    const hexY = signatureBN[1].toString('hex')
    const hexZ = signatureBN[2].toString('hex')
    console.log('g1SignatureToBN: signature: ', hexX, hexX.length, hexY, hexY.length, hexZ, hexZ.length)
    return signatureBN
  }
}
