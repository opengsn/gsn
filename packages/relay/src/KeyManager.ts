// @ts-ignore
import Wallet from 'ethereumjs-wallet'
// @ts-ignore
import HDKey, { EthereumHDKey } from 'ethereumjs-wallet/hdkey'

import fs from 'fs'
import ow from 'ow'
import { toHex } from 'web3-utils'
import { PrefixedHexString } from 'ethereumjs-util'
import { TypedTransaction } from '@ethereumjs/tx'

export const KEYSTORE_FILENAME = 'keystore'

export interface SignedTransaction {
  rawTx: PrefixedHexString
  signedEthJsTx: TypedTransaction
}
export class KeyManager {
  private readonly hdkey: EthereumHDKey
  private _privateKeys: Record<PrefixedHexString, Buffer> = {}
  private nonces: Record<string, number> = {}

  /**
   * @param count - # of addresses managed by this manager
   * @param workdir - read seed from keystore file (or generate one and write it)
   * @param seed - if working in memory (no workdir), you can specify a seed - or use randomly generated one.
   */
  constructor (count: number, workdir?: string, seed?: string) {
    ow(count, ow.number)
    if (seed != null && workdir != null) {
      throw new Error('Can\'t specify both seed and workdir')
    }

    if (workdir != null) {
      // @ts-ignore
      try {
        if (!fs.existsSync(workdir)) {
          fs.mkdirSync(workdir, { recursive: true })
        }
        let genseed
        const keyStorePath = workdir + '/' + KEYSTORE_FILENAME
        if (fs.existsSync(keyStorePath)) {
          genseed = JSON.parse(fs.readFileSync(keyStorePath).toString()).seed
        } else {
          genseed = Wallet.generate().getPrivateKey().toString('hex')
          fs.writeFileSync(keyStorePath, JSON.stringify({ seed: genseed }), { flag: 'w' })
        }
        this.hdkey = HDKey.fromMasterSeed(genseed)
      } catch (e: any) {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!e.message.includes('file already exists')) {
          throw e
        }
      }
    } else {
      // no workdir: working in-memory
      if (seed == null) {
        seed = Wallet.generate().getPrivateKey().toString('hex')
      }
      this.hdkey = HDKey.fromMasterSeed(seed)
    }

    this.generateKeys(count)
  }

  generateKeys (count: number): void {
    this._privateKeys = {}
    this.nonces = {}
    for (let index = 0; index < count; index++) {
      const w = this.hdkey.deriveChild(index).getWallet()
      const address = toHex(w.getAddress())
      this._privateKeys[address] = w.privKey
      this.nonces[index] = 0
    }
  }

  getAddress (index: number): PrefixedHexString {
    return this.getAddresses()[index]
  }

  getAddresses (): PrefixedHexString[] {
    return Object.keys(this._privateKeys)
  }

  isSigner (signer: string): boolean {
    return this._privateKeys[signer] != null
  }

  signTransaction (signer: string, tx: TypedTransaction): SignedTransaction {
    ow(signer, ow.string)
    const privateKey = this._privateKeys[signer]
    if (privateKey === undefined) {
      throw new Error(`Can't sign: signer=${signer} is not managed`)
    }
    const signedEthJsTx = tx.sign(privateKey)
    signedEthJsTx.raw()
    const rawTx = '0x' + signedEthJsTx.serialize().toString('hex')
    return { rawTx, signedEthJsTx }
  }
}
