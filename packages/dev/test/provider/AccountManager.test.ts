import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { JsonRpcProvider, StaticJsonRpcProvider } from '@ethersproject/providers'
import { SignTypedDataVersion, recoverTypedSignature } from '@metamask/eth-sig-util'
import sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { constants } from '@openzeppelin/test-helpers'

import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { RelayRequest, TypedRequestData, isSameAddress } from '@opengsn/common'

import { configureGSN, hardhatNodeChainId } from '../TestUtils'
import { defaultGsnConfig } from '@opengsn/provider'

const { expect, assert } = chai.use(chaiAsPromised)

chai.use(sinonChai)

contract('AccountManager', function (accounts) {
  const address = '0x982a8CbE734cb8c29A6a7E02a3B0e4512148F6F9'
  const privateKey = '0xd353907ab062133759f149a3afcb951f0f746a65a60f351ba05a3ebf26b67f5c'
  const privateKeyAllZero = '0x0000000000000000000000000000000000000000000000000000000000000000'
  let accountManager: AccountManager
  let ethersProvider: JsonRpcProvider

  before(function () {
    // @ts-ignore
    const currentProviderHost = web3.currentProvider.host
    ethersProvider = new StaticJsonRpcProvider(currentProviderHost)
    accountManager = new AccountManager(ethersProvider.getSigner(), hardhatNodeChainId, config)
    sinon.spy(accountManager)
  })
  const config = configureGSN({
    methodSuffix: '_v4'
  })

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
      }).to.throw('Expected private key to be an Uint8Array with length 32')

      await expect(() => {
        accountManager.addAccount(privateKeyAllZero)
      }).to.throw('Private key does not satisfy the curve requirements')
    })
  })

  describe('#newAccount()', function () {
    it('should create a new keypair, return it and save it internally', function () {
      const accountManager = new AccountManager(ethersProvider.getSigner(), hardhatNodeChainId, config)
      const keypair = accountManager.newAccount()
      // @ts-ignore
      assert.equal(accountManager.accounts[0].privateKey.toString(), keypair.privateKey.toString())
      assert.equal(accountManager.getAccounts()[0], keypair.address)
    })
  })

  describe('#sign()', function () {
    before(function () {
      accountManager.addAccount(privateKey)
    })
    const relayRequest: RelayRequest = {
      request: {
        to: constants.ZERO_ADDRESS,
        data: '0x0123',
        from: '',
        nonce: '1',
        value: '0',
        gas: '1',
        validUntilTime: '0'
      },
      relayData: {
        transactionCalldataGasUsed: '0',
        maxFeePerGas: '1',
        maxPriorityFeePerGas: '1',
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
        defaultGsnConfig.domainSeparatorName,
        hardhatNodeChainId,
        constants.ZERO_ADDRESS,
        relayRequestWithoutExtraData(relayRequest)
      )
      const signature = await accountManager.sign(defaultGsnConfig.domainSeparatorName, relayRequest)
      const rec = recoverTypedSignature({
        data: signedData,
        signature,
        version: SignTypedDataVersion.V4
      })
      assert.ok(isSameAddress(relayRequest.request.from.toLowerCase(), rec))
      expect(accountManager._signWithControlledKey).to.have.been.calledWith(privateKey, signedData)
      expect(accountManager._signWithProvider).to.have.not.been.called
    })

    it('should ask provider to sign if key is not controlled', async function () {
      relayRequest.request.from = accounts[0]
      const signedData = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        hardhatNodeChainId,
        constants.ZERO_ADDRESS,
        relayRequestWithoutExtraData(relayRequest)
      )
      const signature = await accountManager.sign(defaultGsnConfig.domainSeparatorName, relayRequest)
      const rec = recoverTypedSignature({
        data: signedData,
        signature,
        version: SignTypedDataVersion.V4
      })
      assert.ok(isSameAddress(relayRequest.request.from.toLowerCase(), rec))
      expect(accountManager._signWithProvider).to.have.been.calledWith(signedData)
      expect(accountManager._signWithControlledKey).to.have.not.been.called
    })

    it('should throw if web3 fails to sign with requested address', async function () {
      relayRequest.request.from = '0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee'
      const promise = accountManager.sign(defaultGsnConfig.domainSeparatorName, relayRequest)
      await expect(promise).to.be.eventually.rejectedWith('Internal RelayClient exception: signature is not correct: sender=0x4cfb3f70bf6a80397c2e634e5bdd85bc0bb189ee')
    })
  })
})
