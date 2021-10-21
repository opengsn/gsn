import { toBN } from 'web3-utils'
import { HttpProvider } from 'web3-core'
import { PrefixedHexString } from 'ethereumjs-util'

import {
  BLSAddressAuthorizationsRegistrarInstance,
  BLSBatchGatewayInstance,
  BLSTestHubInstance,
  BatchGatewayCacheDecoderInstance
} from '@opengsn/contracts'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import {
  CacheDecodersInteractor,
  SignedKeyAuthorization,
  RLPBatchCompressedInput,
  encodeBatch
} from '@opengsn/common/dist/bls/DecompressorInteractor'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { constants } from '@opengsn/common'

import { configureGSN, revert, snapshot } from '../TestUtils'

const BLSAddressAuthorizationsRegistrar = artifacts.require('BLSAddressAuthorizationsRegistrar')
const BatchGatewayCacheDecoder = artifacts.require('BatchGatewayCacheDecoder')
const BLSBatchGateway = artifacts.require('BLSBatchGateway')
const BLSTestHub = artifacts.require('BLSTestHub')

async function createAuthorizationSignature (
  from: string,
  blsKeypair: any,
  registrar: BLSAddressAuthorizationsRegistrarInstance): Promise<string> {
  const config = configureGSN({
    methodSuffix: '_v4',
    jsonStringifyRequest: false
  })
  const accountManager = new AccountManager(web3.currentProvider as HttpProvider, 1337, config)
  accountManager.setBLSKeypair(blsKeypair)
  return await accountManager.createAccountAuthorization(from, registrar.address.toLowerCase())
}

contract.only('BLSBatchGateway', function ([from, to, from2]: string[]) {
  const relayRequest: RelayRequest = {
    request: {
      from,
      to,
      data: '0xff00ff00deadbeef',
      value: '0',
      nonce: '666',
      gas: '124120000',
      validUntil: '15'
    },
    relayData: {
      gasPrice: '15',
      pctRelayFee: '15',
      baseRelayFee: '15',
      transactionCalldataGasUsed: '777',
      relayWorker: from,
      paymaster: from,
      paymasterData: '0x',
      clientId: '0',
      forwarder: constants.ZERO_ADDRESS
    }
  }

  let decompressorInteractor: CacheDecodersInteractor
  let blsTypedDataSigner: BLSTypedDataSigner

  let blsTestHub: BLSTestHubInstance
  let gateway: BLSBatchGatewayInstance
  let decompressor: BatchGatewayCacheDecoderInstance
  let registrar: BLSAddressAuthorizationsRegistrarInstance

  const batchInput: RLPBatchCompressedInput = {
    gasPrice: toBN(15),
    validUntil: toBN(15),
    relayWorker: toBN(from),
    pctRelayFee: toBN(15),
    baseRelayFee: toBN(15),
    maxAcceptanceBudget: toBN(15),
    defaultCacheDecoder: toBN(0),
    blsSignature: [],
    relayRequestElements: [],
    authorizations: []
  }

  before(async function () {
    blsTestHub = await BLSTestHub.new()
    decompressor = await BatchGatewayCacheDecoder.new(constants.ZERO_ADDRESS)
    registrar = await BLSAddressAuthorizationsRegistrar.new()
    gateway = await BLSBatchGateway.new(decompressor.address, registrar.address, blsTestHub.address)

    blsTypedDataSigner = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })
    decompressorInteractor = await new CacheDecodersInteractor({ provider: web3.currentProvider as HttpProvider })
      .init({
        decompressorAddress: decompressor.address,
        erc20cacheDecoder: constants.ZERO_ADDRESS
      })
  })

  context('fallback function', function () {
    let id: string

    beforeEach(async function () {
      id = (await snapshot()).result
    })

    afterEach(async function () {
      await revert(id)
    })

    it('should accept empty batch and emit empty BatchRelayed event', async function () {
      const data = encodeBatch(batchInput)
      const receipt = await web3.eth.sendTransaction({
        from,
        to: gateway.address,
        data
      }) as TransactionReceipt
      await expectEvent.inTransaction(receipt.transactionHash, BLSBatchGateway, 'BatchRelayed', {
        relayWorker: from,
        batchSize: '0'
      })
    })

    it('should accept batch with a single element plus key approval and emit BatchRelayed event', async function () {
      const batchItem = await decompressorInteractor.compressRelayRequest(toBN(777), relayRequest)
      const authorizationSignature = await createAuthorizationSignature(from, blsTypedDataSigner.blsKeypair, registrar)
      const blsPublicKey = blsTypedDataSigner.getPublicKeySerialized()
      const authorizationItem: SignedKeyAuthorization = {
        authorizer: from,
        blsPublicKey,
        signature: authorizationSignature
      }
      const blsSignature = await blsTypedDataSigner.signRelayRequestBLS(relayRequest)
      const data = encodeBatch(Object.assign({}, batchInput, {
        blsSignature,
        relayRequestElements: [batchItem],
        authorizations: [authorizationItem]
      }))
      const receipt = await web3.eth.sendTransaction({
        from,
        to: gateway.address,
        data
      }) as TransactionReceipt

      await expectEvent.inTransaction(receipt.transactionHash, BLSAddressAuthorizationsRegistrar, 'AuthorizationIssued', {
        authorizer: from
      })

      await expectEvent.inTransaction(receipt.transactionHash, BLSBatchGateway, 'BatchRelayed', {
        relayWorker: from,
        batchSize: '1'
      })

      await expectEvent.inTransaction(receipt.transactionHash, BLSTestHub, 'ReceivedRelayCall', {
        batchItemId: '777',
        requestFrom: from,
        requestTo: to
      })
    })

    it('should accept batch with a single element with compresses fields and emit BatchRelayed event', async function () {
    })

    // TODO: this test is twice a duplicate of test 1; extract parts?
    it('should accept batch with multiple elements with different fields and an aggregated BLS signature', async function () {
      // create another signer with another keypair
      const blsTypedDataSigner1 = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })
      const blsTypedDataSigner2 = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })

      const relayRequest2: RelayRequest = JSON.parse(JSON.stringify(relayRequest))
      relayRequest2.request.from = from2
      const batchItem1 = await decompressorInteractor.compressRelayRequest(toBN(777), relayRequest)
      const batchItem2 = await decompressorInteractor.compressRelayRequest(toBN(777), relayRequest2)
      const authorizationSignature1 = await createAuthorizationSignature(from, blsTypedDataSigner1.blsKeypair, registrar)
      const authorizationSignature2 = await createAuthorizationSignature(from2, blsTypedDataSigner2.blsKeypair, registrar)
      const blsPublicKey1 = blsTypedDataSigner1.getPublicKeySerialized()
      const blsPublicKey2 = blsTypedDataSigner2.getPublicKeySerialized()
      const authorizationItem1: SignedKeyAuthorization = {
        authorizer: from,
        blsPublicKey: blsPublicKey1,
        signature: authorizationSignature1
      }
      const authorizationItem2: SignedKeyAuthorization = {
        authorizer: from2,
        blsPublicKey: blsPublicKey2,
        signature: authorizationSignature2
      }
      const blsSignature1: PrefixedHexString[] = (await blsTypedDataSigner1.signRelayRequestBLS(relayRequest)).map((it: BN) => { return it.toString('hex') })
      const blsSignature2: PrefixedHexString[] = (await blsTypedDataSigner2.signRelayRequestBLS(relayRequest2)).map((it: BN) => { return it.toString('hex') })

      const aggregatedBlsSignature = blsTypedDataSigner.aggregateSignatures([blsSignature1, blsSignature2])

      const data = encodeBatch(Object.assign({}, batchInput, {
        blsSignature: aggregatedBlsSignature,
        relayRequestElements: [batchItem1, batchItem2],
        authorizations: [authorizationItem1, authorizationItem2]
      }))
      const receipt = await web3.eth.sendTransaction({
        from,
        to: gateway.address,
        data
      }) as TransactionReceipt

      await expectEvent.inTransaction(receipt.transactionHash, BLSAddressAuthorizationsRegistrar, 'AuthorizationIssued', {
        authorizer: from
      })

      await expectEvent.inTransaction(receipt.transactionHash, BLSAddressAuthorizationsRegistrar, 'AuthorizationIssued', {
        authorizer: from2
      })

      await expectEvent.inTransaction(receipt.transactionHash, BLSBatchGateway, 'BatchRelayed', {
        relayWorker: from,
        batchSize: '2'
      })
    })

    it('should reject batch with a single element with an incorrect BLS signature', async function () {
      const authorizationSignature = await createAuthorizationSignature(from, blsTypedDataSigner.blsKeypair, registrar)
      const blsPublicKey = blsTypedDataSigner.getPublicKeySerialized()
      const authorizationItem: SignedKeyAuthorization = {
        authorizer: from,
        blsPublicKey,
        signature: authorizationSignature
      }

      // it seems that if the signature is not some BLS signature hardhat will revert the entire transaction
      const batchItem = await decompressorInteractor.compressRelayRequest(toBN(777), relayRequest)
      const blsSignature = (await blsTypedDataSigner.signTypedDataBLS('0xffffffff')).map((it: BN) => { return it.toString('hex') })
      const data = encodeBatch(
        Object.assign({}, batchInput, {
          blsSignature,
          relayRequestElements: [batchItem],
          authorizations: [authorizationItem]
        })
      )
      await expectRevert(web3.eth.call({
        from,
        to: gateway.address,
        data
      }), 'Error: VM Exception while processing transaction: reverted with reason string \'BLS signature check failed\'')
    })

    it('should reject batch with multiple elements with an incorrect BLS aggregated signature', async function () {
    })
  })

  context('#decodeBatchItem()', function () {

  })
})
