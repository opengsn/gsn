import { BLSAddressAuthorizationsRegistrarInstance } from '@opengsn/contracts'
import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { HttpProvider } from 'web3-core'
import { configureGSN } from '../TestUtils'
import { PrefixedHexString } from 'ethereumjs-util'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { BigNumberToBN } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { g2ToBN } from '@opengsn/common/dist/bls/evmbls/mcl'

const TestUtil = artifacts.require('TestUtil')
const BLSAddressAuthorizationsRegistrar = artifacts.require('BLSAddressAuthorizationsRegistrar')

contract.only('BLSAddressAuthorizationsRegistrar', function ([from]: string[]) {
  let registrar: BLSAddressAuthorizationsRegistrarInstance
  let accountManager: AccountManager
  let authorizationEcdsaSignature: PrefixedHexString
  let authorizationBLSSignature: PrefixedHexString[]

  let blsPublicKey: string[]

  before(async function () {
    const testUtil = await TestUtil.new()
    const chainId = (await testUtil.libGetChainID()).toNumber()
    registrar = await BLSAddressAuthorizationsRegistrar.new()
    const config = configureGSN({
      methodSuffix: '_v4',
      jsonStringifyRequest: false
    })
    accountManager = new AccountManager(web3.currentProvider as HttpProvider, chainId, config)

    const keypair = await accountManager.newBLSKeypair()
    blsPublicKey = g2ToBN(keypair.pubkey)
      .map(BigNumberToBN)
      .map((it: BN) => { return `0x${it.toString('hex')}` })
    authorizationEcdsaSignature = await accountManager.createAccountAuthorizationSignatureECDSA(from, registrar.address.toLowerCase())
    authorizationBLSSignature = await accountManager.createAccountAuthorizationSignatureBLS({
      authorizer: from, blsSignature: [], ecdsaSignature: '', blsPublicKey: []
    })
  })

  context('#registerAddressAuthorization()', function () {
    it('should register a correctly signed BLS public key to the given address', async function () {
      const authorizationBLSSignatureNoZ = [authorizationBLSSignature[0], authorizationBLSSignature[1]]
      const receipt = await registrar.registerAddressAuthorization(from, authorizationEcdsaSignature, blsPublicKey, authorizationBLSSignatureNoZ)
      const expectedPublicKeyHash = web3.utils.keccak256(web3.eth.abi.encodeParameter('uint256[4]', blsPublicKey))
      await expectEvent.inLogs(receipt.logs, 'AuthorizationIssued', {
        authorizer: from,
        blsPublicKeyHash: expectedPublicKeyHash
      })
    })

    it('should revert and attempt to add incorrectly signed BLS public key to the given address', async function () {
      const differentSignature = await accountManager.createAccountAuthorizationSignatureECDSA(from, from)
      await expectRevert(
        registrar.registerAddressAuthorization(from, differentSignature, blsPublicKey, ['0xff', '0xff']),
        'registrar: signature mismatch')
    })
  })
})
