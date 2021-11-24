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
  encodeBatch, CacheDecoderInteractor, AuthorizationElement, CachingGasConstants, RelayRequestElement
} from '@opengsn/common/dist/bls/CacheDecoderInteractor'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { constants, ContractInteractor, GSNBatchingContractsDeployment } from '@opengsn/common'

import { configureGSN, revert, snapshot } from '../TestUtils'
import { Address, ObjectMap } from '@opengsn/common/dist/types/Aliases'
import { ICalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ICalldataCacheDecoderInteractor'
import { ERC20CalldataCacheDecoderInteractor } from '@opengsn/common/dist/bls/ERC20CalldataCacheDecoderInteractor'
import { txStorageOpcodes } from '../utils/debugTransaction'

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

async function createRelayRequestAndAuthorization (
  relayRequest: RelayRequest,
  from: Address,
  decompressorInteractor: CacheDecoderInteractor,
  registrar: BLSAddressAuthorizationsRegistrarInstance):
  Promise<{
    authorizationItem: AuthorizationElement
    relayRequestElement: RelayRequestElement
    blsSignature: PrefixedHexString[]
  }> {
  const keypair = await BLSTypedDataSigner.newKeypair()
  const blsTypedDataSigner = new BLSTypedDataSigner({ keypair })
  const authorizationSignature = await createAuthorizationSignature(from, blsTypedDataSigner.blsKeypair, registrar)
  const blsPublicKey = blsTypedDataSigner.getPublicKeySerialized()
  const authorizationItem: AuthorizationElement = {
    authorizer: from,
    blsPublicKey,
    signature: authorizationSignature
  }
  const relayRequestClone = cloneRelayRequest(relayRequest, { request: { from } })
  const { relayRequestElement } = await decompressorInteractor.compressRelayRequestAndCalldata(relayRequestClone)
  const blsSignature: PrefixedHexString[] = (await blsTypedDataSigner.signRelayRequestBLS(relayRequestClone)).map((it: BN) => { return it.toString('hex') })

  return { authorizationItem, relayRequestElement, blsSignature }
}

contract.only('BLSBatchGateway', function (accounts: string[]) {
  const [from, from2] = accounts
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
    const batchingContractsDeployment: GSNBatchingContractsDeployment = { batchGatewayCacheDecoder: batchGatewayCacheDecoder.address }
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
      const compressedRequest1 = await createRelayRequestAndAuthorization(relayRequest, from, decompressorInteractor, registrar)
      const data = encodeBatch(Object.assign({}, batchInput, {
        blsSignature: compressedRequest1.blsSignature.map(toBN),
        relayRequestElements: [compressedRequest1.relayRequestElement],
        authorizations: [compressedRequest1.authorizationItem]
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
    });

    [
      1,
      // 2, 10, 15, 20
    ].forEach(batchSize =>
      it(`should accept batch of ${batchSize}`, async function () {
        const requests: RelayRequestElement[] = []
        const authorizations = new Map<string, AuthorizationElement>()
        const sigs: PrefixedHexString[][] = []
        for (let counter = 0; counter < batchSize; counter++) {
          const from = accounts[counter]

          const { relayRequestElement, authorizationItem, blsSignature } = await createRelayRequestAndAuthorization(
            relayRequest,
            // {
            //   relayData: relayRequest.relayData,
            //   request: {
            //     ...relayRequest.request,
            //     from,
            //     data: testToken.contract.methods.transfer(from, 0).encodeABI()
            //   }
            // },
            from, decompressorInteractor, registrar)
          requests.push(relayRequestElement)
          authorizations.set(from, authorizationItem)
          sigs.push(blsSignature)
        }
        // const aggregatedBlsSignature = blsTypedDataSigner.aggregateSignatures(sigs)
        const aggregatedBlsSignature = sigs[0]

        const data = encodeBatch(Object.assign({}, batchInput, {
          aggregatedBlsSignature,
          relayRequestElements: requests,
          authorizations: Array.from(authorizations.values())
        }))
        console.log('sending tx count=', requests.length, 'size=', data.length / 2, 'bytes')
        let receipt = await web3.eth.sendTransaction({
          from,
          to: gateway.address,
          data
        }) as TransactionReceipt

        console.log('count=', requests.length, 'gasUsed=', receipt.gasUsed, 'total logs=', receipt.logs.length)
        if (requests.length === 1) {
          // debugTransaction is VERY slow on hardhat - and crashes on OOM on big batch
          console.log(await txStorageOpcodes(web3.currentProvider, receipt.transactionHash))
        }
        const data2 = encodeBatch(Object.assign({}, batchInput, {
          aggregatedBlsSignature,
          relayRequestElements: requests,
          authorizations: []
        }))
        receipt = await web3.eth.sendTransaction({
          from,
          to: gateway.address,
          data: data2
        }) as TransactionReceipt
        console.log('count=', requests.length, 'gasUsed=', receipt.gasUsed, 'total logs=', receipt.logs.length)
        if (requests.length === 1) {
          // debugTransaction is VERY slow on hardhat - and crashes on OOM on big batch
          console.log(await txStorageOpcodes(web3.currentProvider, receipt.transactionHash))
        }
        for (let i = 0; i < requests.length; i++) {
          await expectEvent.inTransaction(receipt.transactionHash, BLSTestHub, 'ReceivedRelayCall', {
            requestFrom: accounts[i],
            requestData: testToken.contract.methods.transfer(from, 0).encodeABI()
          })
        }

        // await expectEvent.inTransaction(receipt.transactionHash, BLSAddressAuthorizationsRegistrar, 'AuthorizationIssued', {
        //   authorizer: from
        // })
        //
        // await expectEvent.inTransaction(receipt.transactionHash, BLSBatchGateway, 'BatchRelayed', {
        //   relayWorker: from,
        //   batchSize: '1'
        // })
        //
        // await expectEvent.inTransaction(receipt.transactionHash, BLSTestHub, 'ReceivedRelayCall', {
        //   requestFrom: from,
        //   requestTo: to
        // })
      })
    )
    it('should accept batch with a single element with compresses fields and emit BatchRelayed event', async function () {
    })

    it('should accept batch with multiple elements with different fields and an aggregated BLS signature', async function () {
      const compressedRequest1 = await createRelayRequestAndAuthorization(relayRequest, from, decompressorInteractor, registrar)
      const compressedRequest2 = await createRelayRequestAndAuthorization(relayRequest, from2, decompressorInteractor, registrar)

      const aggregatedBlsSignature = blsTypedDataSigner.aggregateSignatures([compressedRequest1.blsSignature, compressedRequest2.blsSignature])

      const data = encodeBatch(Object.assign({}, batchInput, {
        blsSignature: aggregatedBlsSignature,
        relayRequestElements: [compressedRequest1.relayRequestElement, compressedRequest2.relayRequestElement],
        authorizations: [compressedRequest1.authorizationItem, compressedRequest2.authorizationItem]
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
