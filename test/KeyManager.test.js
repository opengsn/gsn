/* global */

const fs = require('fs')
const KeyManager = require('../src/relayserver/KeyManager')
const KEYSTORE_FILENAME = 'keystore'

// NOTICE: this dir is removed in 'after', do not use this in any other test
const workdir = '/tmp/gsn/test/key_manager'

contract('KeyManager', function (accounts) {
  let keyManager, keyPair

  before('create key manager', async function () {
    assert.isFalse(fs.existsSync(workdir), 'test keystore dir should not exist yet')
    keyPair = {
      privateKey: Buffer.from(
        '4ec7b757b3be2f3f5251da530ac66eb3e76f15b64af9caa0da43dafa80568f15', 'hex'),
      address: '0x792d6d01c45b720c942f4552dc7fcc6ca631b349'
    }

    keyManager = new KeyManager({ ecdsaKeyPair: keyPair, workdir })
    assert.ok(keyManager, 'keyManager uninitialized')
    assert.isTrue(fs.existsSync(workdir), 'test keystore dir should exist already')
  })

  it('should create key pair', async function () {
    const ephemeral = KeyManager.newKeypair()
    assert.isTrue(web3.utils.isAddress(ephemeral.address))
    assert.equal(ephemeral.privateKey.length, 32)
  })

  after('remove keystore', async function () {
    fs.unlinkSync(`${workdir}/${KEYSTORE_FILENAME}`)
    fs.rmdirSync(workdir)
  })
})
