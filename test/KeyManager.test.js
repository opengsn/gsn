/* global */

const fs = require('fs')
const { KeyManager } = require('../src/relayserver/KeyManager')
const KEYSTORE_FILENAME = 'keystore'

// NOTICE: this dir is removed in 'after', do not use this in any other test
const workdir = '/tmp/gsn/test/key_manager'
const keyStoreFilePath = workdir + '/' + KEYSTORE_FILENAME

function cleanFolder () {
  if (fs.existsSync(keyStoreFilePath)) {
    fs.unlinkSync(keyStoreFilePath)
  }
  if (fs.existsSync(workdir)) {
    fs.rmdirSync(workdir)
  }
}

if (!contract.only) { contract.only = contract } // buidler "support"

contract('KeyManager', function (accounts) {
  describe('in-memory', () => {
    let mkm
    before(() => {
      mkm = new KeyManager(10,'seed1234')
    })
    it('should return key', () => {
      // for a given seed, the addresses and privkeys are known..
      const k0 = mkm.getAddress(0)
      assert.deepEqual(mkm._privateKeys[k0].toString('hex'), '57741c5b35559587a8322a60ebbf011bd991be1f96837e18f487be008ffa7bfc')
      assert.equal(k0, '0x9c5bcd9fa54ea1353edbdb879ed923de834f5d19')
    })
    it('should return another key for different index', () => {
      const k1 = mkm.getAddress(1)
      assert.equal(mkm._privateKeys[k1].toString('hex'), 'ebf5960c8d941e2323290a4acd4891684a37b2b05eefde44219530b41d19a260')
      assert.equal(k1, '0x8bce814c8b753b49982d5b2c78867ac2c0907ac8')
    })
  })
  describe('file-based KeyManager', () => {
    let fkmA

    before('create key manager', async function () {
      cleanFolder()
      fkmA = new KeyManager(20, workdir)
      assert.isTrue(fs.existsSync(workdir), 'test keystore dir should exist already')
    })

    it('should get key pair', async function () {
      const key = fkmA.getAddress(1)
      assert.isTrue(web3.utils.isAddress(key))
      assert.equal(fkmA._privateKeys[key].length, 32)
    })

    it('should get the same key when reloading', () => {
      const addrA = fkmA.getAddress(0)
      const addrA10 = fkmA.getAddress(10)
      const fkmB = new KeyManager(20,workdir)
      const addrB = fkmB.getAddress(0)
      assert.equal(addrA, addrB)
      assert.equal(fkmA._privateKeys[addrA].toString('hex'), fkmB._privateKeys[addrB].toString('hex'))

      const addrB10 = fkmB.getAddress(10)
      assert.equal(addrA10, addrB10)
      assert.equal(fkmA._privateKeys[addrA10].toString('hex'), fkmB._privateKeys[addrB10].toString('hex'))
    })

    after('remove keystore', cleanFolder)
  })
})
