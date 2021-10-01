import { BLSAddressAuthorisationsRegistrarInstance } from '@opengsn/contracts'
import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { HttpProvider } from 'web3-core'
import { defaultEnvironment } from '@opengsn/common'
import { configureGSN } from '../TestUtils'
import { PrefixedHexString } from 'ethereumjs-util'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'

const TestUtil = artifacts.require('TestUtil')
const BLSAddressAuthorisationsRegistrar = artifacts.require('BLSAddressAuthorisationsRegistrar')

const blsPublicKey: string[] = [
  '0x2591180d099ddbc1b4cfcfaf2450dc0f054339950d461a88bdfe27d513268f3a',
  '0x0b5f4bda51133493803cd01f82b77ec9e20485f233136f0189f4873615b03c36',
  '0x103cb7ac4b0d13f4bab829a88f1303741673663077568953b30721054d822e27',
  '0x08cf151d45f98f4003bcad178e7188bdb62cca4858e8dd3dab63542b83240229'
]

contract('BLSAddressAuthorisationsRegistrar', function ([from]: string[]) {
  let registrar: BLSAddressAuthorisationsRegistrarInstance
  let accountManager: AccountManager
  let authorisationSignature: PrefixedHexString

  before(async function () {
    const testUtil = await TestUtil.new()
    const chainId = (await testUtil.libGetChainID()).toNumber()
    registrar = await BLSAddressAuthorisationsRegistrar.new()
    const config = configureGSN({
      methodSuffix: '_v4',
      jsonStringifyRequest: false
    })
    accountManager = new AccountManager(web3.currentProvider as HttpProvider, chainId, config)
    accountManager.setBLSKeypair({
      pubkey: blsPublicKey,
      secret: ''
    })
    authorisationSignature = await accountManager.createAccountAuthorisation(from, registrar.address.toLowerCase())
  })

  context('#registerAddressAuthorisation()', function () {
    it('should register a correctly signed BLS public key to the given address', async function () {
      const receipt = await registrar.registerAddressAuthorisation(from, blsPublicKey, authorisationSignature)
      const expectedPublicKeyHash = web3.utils.keccak256(web3.eth.abi.encodeParameter('uint256[4]', blsPublicKey))
      await expectEvent.inLogs(receipt.logs, 'AuthorisationIssued', {
        authoriser: from,
        blsPublicKeyHash: expectedPublicKeyHash
      })
    })

    it('should revert and attempt to add incorrectly signed BLS public key to the given address', async function () {
      const differentSignature = await accountManager.createAccountAuthorisation(from, from)
      await expectRevert(
        registrar.registerAddressAuthorisation(from, blsPublicKey, differentSignature),
        'registrar: signature mismatch')
    })
  })
})
