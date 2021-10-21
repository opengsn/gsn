/* eslint-disable */
// @ts-ignore
import mcl from 'mcl-wasm'

import { ethers } from 'ethers'
import { toBig, FIELD_ORDER, bigToHex, randHex } from './utils'
import { hashToField } from './hash_to_field'

export type mclG2 = any;
export type mclG1 = any;
export type mclFP = any;
export type mclFR = any;
export type PublicKey = mclG2;
export type SecretKey = mclFR;

export const MAPPING_MODE_TI = 'TI'
export const MAPPING_MODE_FT = 'FT'

let DOMAIN: Uint8Array

export async function init () {
  await mcl.init(mcl.BN_SNARK1)
  setMappingMode(MAPPING_MODE_FT)
}

export function setDomain (domain: string) {
  DOMAIN = Uint8Array.from(Buffer.from(domain, 'utf8'))
}

export function setDomainHex (domain: string) {
  DOMAIN = Uint8Array.from(Buffer.from(domain, 'hex'))
}

export function setMappingMode (mode: string) {
  if (mode === MAPPING_MODE_FT) {
    mcl.setMapToMode(0)
  } else if (mode === MAPPING_MODE_TI) {
    mcl.setMapToMode(1)
  } else {
    throw new Error('unknown mapping mode')
  }
}

export function hashToPoint (msg: string) {
  if (!ethers.utils.isHexString(msg)) {
    throw new Error('message is expected to be hex string')
  }

  const _msg = Uint8Array.from(Buffer.from(msg.slice(2), 'hex'))
  const hashRes = hashToField(DOMAIN, _msg, 2)
  const e0 = hashRes[0]
  const e1 = hashRes[1]
  const p0 = mapToPoint(e0.toHexString())
  const p1 = mapToPoint(e1.toHexString())
  const p = mcl.add(p0, p1)
  p.normalize()
  return p
}

export function mapToPoint (eHex: string) {
  const e0 = toBig(eHex)
  let e1 = new mcl.Fp()
  e1.setStr(e0.mod(FIELD_ORDER).toString())
  return e1.mapToG1()
}

export function mclToHex (p: mclFP, prefix: boolean = true) {
  const arr = p.serialize()
  let s = ''
  for (let i = arr.length - 1; i >= 0; i--) {
    s += ('0' + arr[i].toString(16)).slice(-2)
  }
  return prefix ? '0x' + s : s
}

export function g1 () {
  const g1 = new mcl.G1()
  g1.setStr('1 0x01 0x02', 16)
  return g1
}

export function g2 () {
  const g2 = new mcl.G2()
  g2.setStr(
    '1 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa 0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b'
  )
  return g2
}

export function signOfG1 (p: mclG1): boolean {
  const y = toBig(mclToHex(p.getY()))
  const ONE = toBig(1)
  return y.and(ONE).eq(ONE)
}

export function signOfG2 (p: mclG2): boolean {
  p.normalize()
  const y = mclToHex(p.getY(), false)
  const ONE = toBig(1)
  return toBig('0x' + y.slice(64))
    .and(ONE)
    .eq(ONE)
}

export function g1ToCompressed (p: mclG1) {
  const MASK = toBig('0x8000000000000000000000000000000000000000000000000000000000000000')
  p.normalize()
  if (signOfG1(p)) {
    const x = toBig(mclToHex(p.getX()))
    const masked = x.or(MASK)
    return bigToHex(masked)
  } else {
    return mclToHex(p.getX())
  }
}

export function g1ToBN (p: mclG1) {
  p.normalize()
  const x = toBig(mclToHex(p.getX()))
  const y = toBig(mclToHex(p.getY()))
  return [x, y]
}

export function g1ToHex (p: mclG1) {
  p.normalize()
  const x = mclToHex(p.getX())
  const y = mclToHex(p.getY())
  return [x, y]
}

export function g2ToCompressed (p: mclG2) {
  const MASK = toBig('0x8000000000000000000000000000000000000000000000000000000000000000')
  p.normalize()
  const x = mclToHex(p.getX(), false)
  if (signOfG2(p)) {
    const masked = toBig('0x' + x.slice(64)).or(MASK)
    return [bigToHex(masked), '0x' + x.slice(0, 64)]
  } else {
    return ['0x' + x.slice(64), '0x' + x.slice(0, 64)]
  }
}

export function g2ToBN (p: mclG2) {
  const x = mclToHex(p.getX(), false)
  const y = mclToHex(p.getY(), false)
  return [
    toBig('0x' + x.slice(64)),
    toBig('0x' + x.slice(0, 64)),
    toBig('0x' + y.slice(64)),
    toBig('0x' + y.slice(0, 64)),
  ]
}

export function g2ToHex (p: mclG2) {
  p.normalize()
  const x = mclToHex(p.getX(), false)
  const y = mclToHex(p.getY(), false)
  return ['0x' + x.slice(64), '0x' + x.slice(0, 64), '0x' + y.slice(64), '0x' + y.slice(0, 64)]
}

export function newKeyPair () {
  const secret = randFr()
  const pubkey = secretToPubkey(secret)
  return {
    pubkey,
    secret
  }
}

export function secretToPubkey(secret: SecretKey): PublicKey {
  const pubkey = mcl.mul(g2(), secret)
  pubkey.normalize()
  return pubkey
}

export function sign (message: string, secret: 2) {
  const M = hashToPoint(message)

  Object.setPrototypeOf(secret, mcl.Fr.prototype); // TODO: this seems to be a bug in 'instanceof'/'mcl-wasm' or some other JS magic, but '.mul' sometimes fails with "mul:mismatch type" otherwise
  const signature = mcl.mul(M, secret)
  signature.normalize()
  return {
    signature,
    M
  }
}

export function aggreagate (acc: mclG1 | mclG2, other: mclG1 | mclG2) {
  const _acc = mcl.add(acc, other)
  _acc.normalize()
  return _acc
}

export function compressPubkey (p: mclG2) {
  return g2ToCompressed(p)
}

export function compressSignature (p: mclG1) {
  return g1ToCompressed(p)
}

export function newFp () {
  return new mcl.Fp()
}

export function newFr () {
  return new mcl.Fr()
}

export function deserializeHexStrToFr(str: string) {
  return mcl.deserializeHexStrToFr(str)
}

export function newFp2 () {
  return new mcl.Fp2()
}

export function newG1 () {
  return new mcl.G1()
}

export function newG2 () {
  return new mcl.G2()
}

export function randFr () {
  const r = randHex(12)
  let fr = new mcl.Fr()
  fr.setHashOf(r)
  return fr
}

export function randG1 () {
  const p = mcl.mul(g1(), randFr())
  p.normalize()
  return p
}

export function randG2 () {
  const p = mcl.mul(g2(), randFr())
  p.normalize()
  return p
}
