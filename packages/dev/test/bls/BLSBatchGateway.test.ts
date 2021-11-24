import { toBN } from 'web3-utils'
import { HttpProvider } from 'web3-core'
import { PrefixedHexString } from 'ethereumjs-util'

import {
  BLSAddressAuthorizationsRegistrarInstance,
  BLSBatchGatewayInstance,
  BLSTestHubInstance,
  BatchGatewayCacheDecoderInstance,
  ERC20CacheDecoderInstance, TestTokenInstance
} from '@opengsn/contracts'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { cloneRelayRequest, RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import {
  RLPBatchCompressedInput,
  encodeBatch, CacheDecoderInteractor, AuthorizationElement, CachingGasConstants
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { constants, ContractInteractor, GSNBatchingContractsDeployment } from '@opengsn/common'

import { configureGSN, revert, snapshot } from '../TestUtils'
import { ERC20CalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ERC20CalldataCacheDecoderInteractor'
import { ObjectMap } from '@opengsn/common/dist/types/Aliases'
import { ICalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ICalldataCacheDecoderInteractor'

const BLSAddressAuthorizationsRegistrar = artifacts.require('BLSAddressAuthorizationsRegistrar')
const BatchGatewayCacheDecoder = artifacts.require('BatchGatewayCacheDecoder')
const ERC20CacheDecoder = artifacts.require('ERC20CacheDecoder')
const BLSBatchGateway = artifacts.require('BLSBatchGateway')
const BLSTestHub = artifacts.require('BLSTestHub')
const TestToken = artifacts.require('TestToken')

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

contract.only('BLSBatchGateway', function ([from, from2]: string[]) {
  const relayRequest: RelayRequest = {
    request: {
      from,
      to: '',
      data: '',
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

  let decompressorInteractor: CacheDecoderInteractor
  let blsTypedDataSigner: BLSTypedDataSigner

  let blsTestHub: BLSTestHubInstance
  let gateway: BLSBatchGatewayInstance
  let batchGatewayCacheDecoder: BatchGatewayCacheDecoderInstance
  let calldataCacheDecoder: ERC20CacheDecoderInstance
  let registrar: BLSAddressAuthorizationsRegistrarInstance
  let testToken: TestTokenInstance

  const batchInput: RLPBatchCompressedInput = {
    gasPrice: toBN(15),
    validUntil: toBN(15),
    relayWorker: toBN(from),
    pctRelayFee: toBN(15),
    baseRelayFee: toBN(15),
    maxAcceptanceBudget: toBN(15),
    defaultCalldataCacheDecoder: toBN(0),
    blsSignature: [],
    relayRequestElements: [],
    authorizations: []
  }

  before(async function () {
    blsTestHub = await BLSTestHub.new()
    batchGatewayCacheDecoder = await BatchGatewayCacheDecoder.new(constants.ZERO_ADDRESS)
    registrar = await BLSAddressAuthorizationsRegistrar.new()
    gateway = await BLSBatchGateway.new(batchGatewayCacheDecoder.address, registrar.address, blsTestHub.address)
    calldataCacheDecoder = await ERC20CacheDecoder.new()
    testToken = await TestToken.new()

    relayRequest.request.to = testToken.address
    relayRequest.request.data = testToken.contract.methods.transfer(constants.ZERO_ADDRESS, 0).encodeABI()
    batchInput.defaultCalldataCacheDecoder = toBN(calldataCacheDecoder.address)
    blsTypedDataSigner = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })
    const cachingGasConstants: CachingGasConstants = {
      authorizationCalldataBytesLength: 1,
      authorizationStorageSlots: 1,
      gasPerSlotL2: 1
    }
    // @ts-ignore
    const batchingContractsDeployment: GSNBatchingContractsDeployment = {}
    const calldataCacheDecoderInteractors: ObjectMap<ICalldataCacheDecoderInteractor> = {}
    calldataCacheDecoderInteractors[testToken.address.toLowerCase()] = new ERC20CalldataCacheDecoderInteractor({
      provider: web3.currentProvider as HttpProvider,
      erc20CacheDecoderAddress: calldataCacheDecoder.address
    })
    decompressorInteractor = await new CacheDecoderInteractor({
      provider: web3.currentProvider as HttpProvider,
      batchingContractsDeployment,
      contractInteractor: {} as ContractInteractor,
      calldataCacheDecoderInteractors,
      cachingGasConstants
    })
      .init()
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
      const { relayRequestElement } = await decompressorInteractor.compressRelayRequestAndCalldata(relayRequest)
      const authorizationSignature = await createAuthorizationSignature(from, blsTypedDataSigner.blsKeypair, registrar)
      const blsPublicKey = blsTypedDataSigner.getPublicKeySerialized()
      const authorizationItem: AuthorizationElement = {
        authorizer: from,
        blsPublicKey,
        signature: authorizationSignature
      }
      const blsSignature = await blsTypedDataSigner.signRelayRequestBLS(relayRequest)
      const data = encodeBatch(Object.assign({}, batchInput, {
        blsSignature,
        relayRequestElements: [relayRequestElement],
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
        requestFrom: from,
        requestTo: testToken.address
      })
    })

    it('should accept batch with a single element with compresses fields and emit BatchRelayed event', async function () {
    })

    // TODO: this test is twice a duplicate of test 1; extract parts?
    it('should accept batch with multiple elements with different fields and an aggregated BLS signature', async function () {
      // create another signer with another keypair
      const blsTypedDataSigner1 = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })
      const blsTypedDataSigner2 = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })

      const relayRequest2: RelayRequest = cloneRelayRequest(relayRequest, { request: { from: from2 } })
      const compressedRequest1 = await decompressorInteractor.compressRelayRequestAndCalldata(relayRequest)
      const compressedRequest2 = await decompressorInteractor.compressRelayRequestAndCalldata(relayRequest2)
      const authorizationSignature1 = await createAuthorizationSignature(from, blsTypedDataSigner1.blsKeypair, registrar)
      const authorizationSignature2 = await createAuthorizationSignature(from2, blsTypedDataSigner2.blsKeypair, registrar)
      const blsPublicKey1 = blsTypedDataSigner1.getPublicKeySerialized()
      const blsPublicKey2 = blsTypedDataSigner2.getPublicKeySerialized()
      const authorizationItem1: AuthorizationElement = {
        authorizer: from,
        blsPublicKey: blsPublicKey1,
        signature: authorizationSignature1
      }
      const authorizationItem2: AuthorizationElement = {
        authorizer: from2,
        blsPublicKey: blsPublicKey2,
        signature: authorizationSignature2
      }
      const blsSignature1: PrefixedHexString[] = (await blsTypedDataSigner1.signRelayRequestBLS(relayRequest)).map((it: BN) => { return it.toString('hex') })
      const blsSignature2: PrefixedHexString[] = (await blsTypedDataSigner2.signRelayRequestBLS(relayRequest2)).map((it: BN) => { return it.toString('hex') })

      const aggregatedBlsSignature = blsTypedDataSigner.aggregateSignatures([blsSignature1, blsSignature2])

      const data = encodeBatch(Object.assign({}, batchInput, {
        blsSignature: aggregatedBlsSignature,
        relayRequestElements: [compressedRequest1.relayRequestElement, compressedRequest2.relayRequestElement],
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
      const authorizationItem: AuthorizationElement = {
        authorizer: from,
        blsPublicKey,
        signature: authorizationSignature
      }

      // it seems that if the signature is not some BLS signature hardhat will revert the entire transaction
      const compressedRequest = await decompressorInteractor.compressRelayRequestAndCalldata(relayRequest)
      const blsSignature = (await blsTypedDataSigner.signTypedDataBLS('0xffffffff')).map((it: BN) => { return it.toString('hex') })
      const data = encodeBatch(
        Object.assign({}, batchInput, {
          blsSignature,
          relayRequestElements: [compressedRequest.relayRequestElement],
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
