import { BigNumber } from 'ethers'
import { sha256, arrayify, hexlify, zeroPad } from 'ethers/lib/utils'

export const FIELD_ORDER = BigNumber.from('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47')

export function hashToField (domain: Uint8Array, msg: Uint8Array, count: number): BigNumber[] {
  const u = 48
  const _msg = expandMsg(domain, msg, count * u)
  const els = []
  for (let i = 0; i < count; i++) {
    const el = BigNumber.from(_msg.slice(i * u, (i + 1) * u)).mod(FIELD_ORDER)
    els.push(el)
  }
  return els
}

export function expandMsg (domain: Uint8Array, msg: Uint8Array, outLen: number): Uint8Array {
  if (domain.length > 255) {
    throw new Error('bad domain size')
  }

  const out: Uint8Array = new Uint8Array(outLen)

  const len0 = 64 + msg.length + 2 + 1 + domain.length + 1
  const in0: Uint8Array = new Uint8Array(len0)
  // zero pad
  let off = 64
  // msg
  in0.set(msg, off)
  off += msg.length
  // l_i_b_str
  in0.set([(outLen >> 8) & 0xff, outLen & 0xff], off)
  off += 2
  // I2OSP(0, 1)
  in0.set([0], off)
  off += 1
  // DST_prime
  in0.set(domain, off)
  off += domain.length
  in0.set([domain.length], off)

  const b0 = sha256(in0)

  const len1 = 32 + 1 + domain.length + 1
  const in1: Uint8Array = new Uint8Array(len1)
  // b0
  in1.set(arrayify(b0), 0)
  off = 32
  // I2OSP(1, 1)
  in1.set([1], off)
  off += 1
  // DST_prime
  in1.set(domain, off)
  off += domain.length
  in1.set([domain.length], off)

  const b1 = sha256(in1)

  // b_i = H(strxor(b_0, b_(i - 1)) || I2OSP(i, 1) || DST_prime);
  const ell = Math.floor((outLen + 32 - 1) / 32)
  let bi = b1

  for (let i = 1; i < ell; i++) {
    const ini: Uint8Array = new Uint8Array(32 + 1 + domain.length + 1)
    const nb0 = zeroPad(arrayify(b0), 32)
    const nbi = zeroPad(arrayify(bi), 32)
    const tmp = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      tmp[i] = nb0[i] ^ nbi[i]
    }

    ini.set(tmp, 0)
    let off = 32
    ini.set([1 + i], off)
    off += 1
    ini.set(domain, off)
    off += domain.length
    ini.set([domain.length], off)

    out.set(arrayify(bi), 32 * (i - 1))
    bi = sha256(ini)
  }

  out.set(arrayify(bi), 32 * (ell - 1))
  return out
}

const DOMAIN_STR = 'QUUX-V01-CS02-with-expander'
const DST = Uint8Array.from(Buffer.from(DOMAIN_STR, 'utf8'))

interface vector {
  msg: string;
  outLen: number;
  expected: string;
}

const vectors: vector[] = [
  // https://tools.ietf.org/html/draft-irtf-cfrg-hash-to-curve-09#appendix-I
  {
    msg: '',
    outLen: 32,
    expected: '0xf659819a6473c1835b25ea59e3d38914c98b374f0970b7e4c92181df928fca88',
  },
  {
    msg: 'abc',
    outLen: 32,
    expected: '0x1c38f7c211ef233367b2420d04798fa4698080a8901021a795a1151775fe4da7',
  },
  {
    msg: 'abcdef0123456789',
    outLen: 32,
    expected: '0x8f7e7b66791f0da0dbb5ec7c22ec637f79758c0a48170bfb7c4611bd304ece89',
  },
  {
    msg:
      'q128_qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    outLen: 32,
    expected: '0x72d5aa5ec810370d1f0013c0df2f1d65699494ee2a39f72e1716b1b964e1c642',
  },
  {
    msg:
      'a512_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    outLen: 32,
    expected: '0x3b8e704fc48336aca4c2a12195b720882f2162a4b7b13a9c350db46f429b771b',
  },
  {
    msg: '',
    outLen: 128,
    expected:
      '0x8bcffd1a3cae24cf9cd7ab85628fd111bb17e3739d3b53f89580d217aa79526f1708354a76a402d3569d6a9d19ef3de4d0b991e4f54b9f20dcde9b95a66824cbdf6c1a963a1913d43fd7ac443a02fc5d9d8d77e2071b86ab114a9f34150954a7531da568a1ea8c760861c0cde2005afc2c114042ee7b5848f5303f0611cf297f',
  },
  {
    msg: 'abc',
    outLen: 128,
    expected:
      '0xfe994ec51bdaa821598047b3121c149b364b178606d5e72bfbb713933acc29c186f316baecf7ea22212f2496ef3f785a27e84a40d8b299cec56032763eceeff4c61bd1fe65ed81decafff4a31d0198619c0aa0c6c51fca15520789925e813dcfd318b542f8799441271f4db9ee3b8092a7a2e8d5b75b73e28fb1ab6b4573c192',
  },
  {
    msg: 'abcdef0123456789',
    outLen: 128,
    expected:
      '0xc9ec7941811b1e19ce98e21db28d22259354d4d0643e301175e2f474e030d32694e9dd5520dde93f3600d8edad94e5c364903088a7228cc9eff685d7eaac50d5a5a8229d083b51de4ccc3733917f4b9535a819b445814890b7029b5de805bf62b33a4dc7e24acdf2c924e9fe50d55a6b832c8c84c7f82474b34e48c6d43867be',
  },
  {
    msg:
      'q128_qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    outLen: 128,
    expected:
      '0x48e256ddba722053ba462b2b93351fc966026e6d6db493189798181c5f3feea377b5a6f1d8368d7453faef715f9aecb078cd402cbd548c0e179c4ed1e4c7e5b048e0a39d31817b5b24f50db58bb3720fe96ba53db947842120a068816ac05c159bb5266c63658b4f000cbf87b1209a225def8ef1dca917bcda79a1e42acd8069',
  },
  {
    msg:
      'a512_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    outLen: 128,
    expected:
      '0x396962db47f749ec3b5042ce2452b619607f27fd3939ece2746a7614fb83a1d097f554df3927b084e55de92c7871430d6b95c2a13896d8a33bc48587b1f66d21b128a1a8240d5b0c26dfe795a1a842a0807bb148b77c2ef82ed4b6c9f7fcb732e7f94466c8b51e52bf378fba044a31f5cb44583a892f5969dcd73b3fa128816e',
  },
]
import { assert } from 'chai'

function test_expand_msg () {
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]
    const msg = Uint8Array.from(Buffer.from(v.msg, 'utf8'))
    const outLen = v.outLen
    const out = expandMsg(DST, msg, outLen)
    assert.equal(hexlify(out), v.expected)
  }
}

function test_hash_to_point () {
  const expected0 = '0x09b6a2dec1f1b0747c73332e5147ecacde20767f28a9b68261713bed9a1d2432'
  const expected1 = '0x0cb70ff0b1bdb5d30006bd0cc03dc2c071dcff0daea886c9793f304c695c1bc6'
  const dst = 'xxx'
  const msg = '0x616263'
  mcl.setDomain(dst)
  const p = mcl.hashToPoint(msg)
  const result = mcl.g1ToHex(p)
  assert.equal(result[0], expected0)
  assert.equal(result[1], expected1)
}

import * as mcl from './mcl'

async function test () {
  await mcl.init()
  test_expand_msg()
  console.log('expand msg test pass')
  test_hash_to_point()
  console.log('hash to point test pass')
}

// test();
