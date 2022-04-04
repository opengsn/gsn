/* global */

import fs from 'fs'
import { KeyManager, KEYSTORE_FILENAME } from '@opengsn/relay/dist/KeyManager'

// NOTICE: this dir is removed in 'after', do not use this in any other test
const workdir = '/tmp/gsn/test/key_manager'
const keyStoreFilePath = workdir + '/' + KEYSTORE_FILENAME

function cleanFolder (): void {
  if (fs.existsSync(keyStoreFilePath)) {
    fs.unlinkSync(keyStoreFilePath)
  }
  if (fs.existsSync(workdir)) {
    // @ts-ignore
    fs.rmSync(workdir, {
      recursive: true,
      force: true
    })
  }
}

contract('KeyManager', function (accounts) {
  describe('in-memory', () => {
    let mkm: KeyManager

    before(() => {
      mkm = new KeyManager(10, undefined, 'seed1234')
    })
    it('should return key', () => {
      // for a given seed, the addresses and privkeys are known..
      const k0 = mkm.getAddress(0)
      // @ts-ignore
      assert.deepEqual(mkm._privateKeys[k0].toString('hex'),
        '98bd175008b68dfd5a6aca0584d5a040032f2469656569d5d428161b776d27ff')
      assert.equal(k0, '0x56558253d657baa29cfe9f0a808b7d19d5d80b9c')
    })
    it('should return another key for different index', () => {
      const k1 = mkm.getAddress(1)
      // @ts-ignore
      assert.equal(mkm._privateKeys[k1].toString('hex'),
        'e52f32d373b0b38be3800ec9070af883a63c4fd2857c5b0f249180a2c303eb7e')
      assert.equal(k1, '0xe2ceef58b3e5a8816c52b00067830b8e1afd82da')
    })
  })
  describe('file-based KeyManager', () => {
    let fkmA: KeyManager

    before('create key manager', function () {
      cleanFolder()
      fkmA = new KeyManager(20, workdir)
      assert.isTrue(fs.existsSync(workdir), 'test keystore dir should exist already')
    })

    it('should get key pair', function () {
      const key = fkmA.getAddress(1)
      assert.isTrue(web3.utils.isAddress(key))
      // @ts-ignore
      assert.equal(fkmA._privateKeys[key].length, 32)
    })

    it('should get the same key when reloading', () => {
      const addrA = fkmA.getAddress(0)
      const addrA10 = fkmA.getAddress(10)
      const fkmB = new KeyManager(20, workdir)
      const addrB = fkmB.getAddress(0)
      assert.equal(addrA, addrB)
      // @ts-ignore
      assert.equal(fkmA._privateKeys[addrA].toString('hex'), fkmB._privateKeys[addrB].toString('hex'))

      const addrB10 = fkmB.getAddress(10)
      assert.equal(addrA10, addrB10)
      // @ts-ignore
      assert.equal(fkmA._privateKeys[addrA10].toString('hex'), fkmB._privateKeys[addrB10].toString('hex'))
    })

    after('remove keystore', cleanFolder)
  })
})
