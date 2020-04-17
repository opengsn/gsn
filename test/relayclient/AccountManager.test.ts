import AccountManager from '../../src/relayclient/AccountManager'
import { defaultEnvironment } from '../../src/relayclient/types/Environments'
import { HttpProvider } from 'web3-core'
import RelayRequest from '../../src/common/EIP712/RelayRequest'
import { constants } from '@openzeppelin/test-helpers'
import sinon from 'sinon'
import sigUtil from 'eth-sig-util'
import getDataToSign from '../../src/common/EIP712/Eip712Helper'
import { isSameAddress } from '../../src/common/utils'
import chai from 'chai'
import sinonChai from 'sinon-chai'
import { configureGSN } from '../../src/relayclient/GSNConfigurator'

const expect = chai.expect
chai.use(sinonChai)

contract('AccountManager', function (accounts) {
  const address = '0x982a8CbE734cb8c29A6a7E02a3B0e4512148F6F9'
  const keypair = {
    privateKey: Buffer.from('d353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c', 'hex'),
    address
  }
  const config = configureGSN({
    verbose: false,
    methodSuffix: '',
    jsonStringifyRequest: false
  })
  const accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config)
  // @ts-ignore
  sinon.spy(accountManager)
  describe('#addAccount()', function () {
    it('should save the provided keypair internally', function () {
      accountManager.addAccount(keypair)
      // @ts-ignore
      assert.equal(accountManager.accounts[0].privateKey.toString(), keypair.privateKey.toString())
      // @ts-ignore
      assert.equal(accountManager.accounts[0].address, keypair.address)
    })

    it('should throw if the provided keypair is not valid', function () {
      const keypair = {
        privateKey: Buffer.from('AAAAAAAAAAAAA6a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d', 'hex'),
        address
      }
      expect(() => {
        accountManager.addAccount(keypair)
      }).to.throw('invalid keypair')
    })
  })
  describe('#newAccount()', function () {
    const accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config)
    it('should create a new keypair, return it and save it internally', function () {
      const keypair = accountManager.newAccount()
      // @ts-ignore
      assert.equal(accountManager.accounts[0].privateKey.toString(), keypair.privateKey.toString())
    })
  })

  describe('#sign()', function () {
    accountManager.addAccount(keypair)
    const relayRequest = new RelayRequest({
      senderAddress: '',
      encodedFunction: '0x123',
      senderNonce: '1',
      target: constants.ZERO_ADDRESS,
      pctRelayFee: '1',
      baseRelayFee: '1',
      gasPrice: '1',
      gasLimit: '1',
      relayWorker: constants.ZERO_ADDRESS,
      paymaster: constants.ZERO_ADDRESS
    })
    beforeEach(function () {
      sinon.resetHistory()
    })

    it('should use internally controlled keypair for signing if available', async function () {
      relayRequest.relayData.senderAddress = address
      const signedData = getDataToSign({
        chainId: defaultEnvironment.chainId,
        verifier: constants.ZERO_ADDRESS,
        relayRequest
      })
      const signature = await accountManager.sign(relayRequest, constants.ZERO_ADDRESS)
      // @ts-ignore
      const rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
      assert.ok(isSameAddress(relayRequest.relayData.senderAddress.toLowerCase(), rec))
      expect(accountManager._signWithControlledKey).to.have.been.calledWith(keypair, signedData)
      expect(accountManager._signWithProvider).to.have.not.been.called
    })
    it('should ask provider to sign if key is not controlled', async function () {
      relayRequest.relayData.senderAddress = accounts[0]
      const signedData = getDataToSign({
        chainId: defaultEnvironment.chainId,
        verifier: constants.ZERO_ADDRESS,
        relayRequest
      })
      const signature = await accountManager.sign(relayRequest, constants.ZERO_ADDRESS)
      // @ts-ignore
      const rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
      assert.ok(isSameAddress(relayRequest.relayData.senderAddress.toLowerCase(), rec))
      expect(accountManager._signWithProvider).to.have.been.calledWith(signedData)
      expect(accountManager._signWithControlledKey).to.have.not.been.called
    })
    it('should throw if web3 fails to sign with requested address', async function () {
      relayRequest.relayData.senderAddress = '0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee'
      const promise = accountManager.sign(relayRequest, constants.ZERO_ADDRESS)
      await expect(promise).to.be.eventually.rejectedWith('Failed to sign relayed transaction for 0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee')
    })
  })
})
