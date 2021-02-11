import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sigUtil from 'eth-sig-util'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { HttpProvider } from 'web3-core'
import { constants } from '@openzeppelin/test-helpers'

import AccountManager from '../../src/relayclient/AccountManager'
import RelayRequest from '../../src/common/EIP712/RelayRequest'
import TypedRequestData from '../../src/common/EIP712/TypedRequestData'
import { configureGSN } from '../TestUtils'
import { defaultEnvironment } from '../../src/common/Environments'
import { isSameAddress } from '../../src/common/Utils'

const { expect, assert } = chai.use(chaiAsPromised)

chai.use(sinonChai)

contract('AccountManager', function (accounts) {
  const address = '0x982a8CbE734cb8c29A6a7E02a3B0e4512148F6F9'
  const privateKey = '0xd353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c'
  const config = configureGSN({
    methodSuffix: '',
    jsonStringifyRequest: false
  })
  const accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config)
  // @ts-ignore
  sinon.spy(accountManager)
  describe('#addAccount()', function () {
    it('should save the provided keypair internally', function () {
      accountManager.addAccount(privateKey)
      // @ts-ignore
      assert.equal(accountManager.accounts[0].privateKey.toString(), privateKey.toString())
      // @ts-ignore
      assert.equal(accountManager.accounts[0].address.toLowerCase(), address.toLowerCase())
    })

    it('should throw if the provided keypair is not valid', async function () {
      const invalidPrivateKey = privateKey.replace('a', '')
      await expect(() => {
        accountManager.addAccount(invalidPrivateKey)
      }).to.throw('Private key does not satisfy the curve requirements')
    })
  })

  describe('#newAccount()', function () {
    const accountManager = new AccountManager(web3.currentProvider as HttpProvider, defaultEnvironment.chainId, config)

    it('should create a new keypair, return it and save it internally', function () {
      const keypair = accountManager.newAccount()
      // @ts-ignore
      assert.equal(accountManager.accounts[0].privateKey.toString(), keypair.privateKey.toString())
      assert.equal(accountManager.getAccounts()[0], keypair.address)
    })
  })

  describe('#sign()', function () {
    accountManager.addAccount(privateKey)
    const relayRequest: RelayRequest = {
      request: {
        to: constants.ZERO_ADDRESS,
        data: '0x123',
        from: '',
        nonce: '1',
        value: '0',
        gas: '1',
        validUntil: '0'
      },
      relayData: {
        pctRelayFee: '1',
        baseRelayFee: '1',
        gasPrice: '1',
        relayWorker: constants.ZERO_ADDRESS,
        forwarder: constants.ZERO_ADDRESS,
        paymaster: constants.ZERO_ADDRESS,
        paymasterData: '0x',
        clientId: '1'
      }
    }

    beforeEach(function () {
      sinon.resetHistory()
    })

    function relayRequestWithoutExtraData (relayRequest: RelayRequest): RelayRequest {
      return { ...relayRequest }
    }

    it('should use internally controlled keypair for signing if available', async function () {
      relayRequest.request.from = address
      const signedData = new TypedRequestData(
        defaultEnvironment.chainId,
        constants.ZERO_ADDRESS,
        relayRequestWithoutExtraData(relayRequest)
      )
      const signature = await accountManager.sign(relayRequest)
      // @ts-ignore
      const rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
      assert.ok(isSameAddress(relayRequest.request.from.toLowerCase(), rec))
      expect(accountManager._signWithControlledKey).to.have.been.calledWith(privateKey, signedData)
      expect(accountManager._signWithProvider).to.have.not.been.called
    })
    it('should ask provider to sign if key is not controlled', async function () {
      relayRequest.request.from = accounts[0]
      const signedData = new TypedRequestData(
        defaultEnvironment.chainId,
        constants.ZERO_ADDRESS,
        relayRequestWithoutExtraData(relayRequest)
      )
      const signature = await accountManager.sign(relayRequest)
      // @ts-ignore
      const rec = sigUtil.recoverTypedSignature_v4({
        data: signedData,
        sig: signature
      })
      assert.ok(isSameAddress(relayRequest.request.from.toLowerCase(), rec))
      expect(accountManager._signWithProvider).to.have.been.calledWith(signedData)
      expect(accountManager._signWithControlledKey).to.have.not.been.called
    })
    it('should throw if web3 fails to sign with requested address', async function () {
      relayRequest.request.from = '0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee'
      const promise = accountManager.sign(relayRequest)
      await expect(promise).to.be.eventually.rejectedWith('Failed to sign relayed transaction for 0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee')
    })
  })
})
