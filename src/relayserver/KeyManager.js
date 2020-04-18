const Wallet = require('ethereumjs-wallet')
const abi = require('ethereumjs-abi')
const fs = require('fs')
const ethUtils = require('ethereumjs-util')

class KeyManager {
  constructor ({ ecdsaKeyPair, workdir }) {
    this.ecdsaKeyPair = ecdsaKeyPair
    if (workdir) {
      this.workdir = workdir
      try {
        if (!fs.existsSync(workdir)) {
          fs.mkdirSync(workdir, { recursive: true })
        }
        fs.writeFileSync(workdir + '/keystore', JSON.stringify({ ecdsaKeyPair }), { flag: 'w' })
      } catch (e) {
        if (!e.message.includes('file already exists')) {
          throw e
        }
      }
    }
  }

  static newKeypair () {
    const a = Wallet.generate()
    return {
      privateKey: a.privKey,
      address: '0x' + a.getAddress().toString('hex')
    }
  }

  ecSignWithPrefix ({ hash }) {
    const prefixedHash = abi.soliditySHA3(['string', 'bytes32'], ['\x19Ethereum Signed Message:\n32', hash])
    return this.ecSignNoPrefix({ hash: prefixedHash })
  }

  ecSignNoPrefix ({ hash }) {
    const sig = ethUtils.ecsign(hash, this.ecdsaKeyPair.privateKey)
    return Buffer.concat([sig.r, sig.s, Buffer.from(sig.v.toString(16), 'hex')])
  }

  address () {
    return this.ecdsaKeyPair.address
  }

  signTransaction (tx) {
    tx.sign(this.ecdsaKeyPair.privateKey)
    const rawTx = tx.serialize().toString('hex')
    return rawTx
  }
}

module.exports = KeyManager
