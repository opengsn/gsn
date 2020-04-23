const Wallet = require('ethereumjs-wallet')
const HDKey = require('ethereumjs-wallet/hdkey')
const fs = require('fs')
const ow = require('ow')

class KeyManager {
  /**
   * @param count - # of addresses managed by this manager
   * @param workdir - read seed from keystore file (or generate one and write it)
   * @param seed - if working in memory (no workdir), you can specify a seed - or use randomly generated one.
   */
  constructor ({ count, workdir = null, seed = null }) {
    ow(count, ow.number)
    if (seed && workdir) { throw new Error('Can\'t specify both seed and workdir') }

    if (workdir) {
      try {
        if (!fs.existsSync(workdir)) {
          fs.mkdirSync(workdir, { recursive: true })
        }
        let genseed
        const keyStorePath = workdir + '/keystore'
        if (fs.existsSync(keyStorePath)) {
          genseed = JSON.parse(fs.readFileSync(keyStorePath).toString()).seed
        } else {
          genseed = Wallet.generate().getPrivateKey().toString('hex')
          fs.writeFileSync(keyStorePath, JSON.stringify({ seed: genseed.toString('hex') }), { flag: 'w' })
        }
        this.hdkey = HDKey.fromMasterSeed(genseed)
      } catch (e) {
        if (!e.message.includes('file already exists')) {
          throw e
        }
      }
    } else {
      // no workdir: working in-memory
      if (!seed) {
        seed = Wallet.generate().getPrivateKey().toString('hex')
      }
      this.hdkey = HDKey.fromMasterSeed(seed)
    }
    this.generateKeys(count)
  }

  generateKeys (count) {
    this._privateKeys = {}
    for (let index = 0; index < count; index++) {
      const w = this.hdkey.deriveChild(index).getWallet()
      const address = '0x' + w.getAddress().toString('hex')
      this._privateKeys[address] = w.privKey
    }
  }

  getAddress (index) {
    return this.getAddresses()[index]
  }

  getAddresses () {
    return Object.keys(this._privateKeys)
  }

  signTransaction (signer, tx) {
    ow(signer, ow.string)
    const privateKey = this._privateKeys[signer]
    if (privateKey === undefined) { throw new Error(`Can't sign: signer=${signer} is not managed`) }

    tx.sign(privateKey)
    const rawTx = tx.serialize().toString('hex')
    return rawTx
  }
}

module.exports = KeyManager
