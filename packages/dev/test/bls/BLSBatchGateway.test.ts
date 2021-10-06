import { toBN } from 'web3-utils'
import { HttpProvider } from 'web3-core'

import {
  BLSAddressAuthorizationsRegistrarInstance,
  BLSBatchGatewayInstance,
  BLSTestHubInstance,
  DomainSpecificInputDecompressorInstance
} from '@opengsn/contracts'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import {
  DecompressorInteractor,
  SignedKeyAuthorization,
  RLPBatchCompressedInput,
  encodeBatch,
  none
} from '@opengsn/common/dist/bls/DecompressorInteractor'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { configureGSN } from '../TestUtils'
import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { constants } from '@opengsn/common'

const BLSAddressAuthorizationsRegistrar = artifacts.require('BLSAddressAuthorizationsRegistrar')
const DomainSpecificInputDecompressor = artifacts.require('DomainSpecificInputDecompressor')
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
  return accountManager.createAccountAuthorization(from, registrar.address.toLowerCase())
}

contract.only('BLSBatchGateway', function ([from, to]: string[]) {
  let decompressorInteractor: DecompressorInteractor
  let blsTypedDataSigner: BLSTypedDataSigner

  let blsTestHub: BLSTestHubInstance
  let gateway: BLSBatchGatewayInstance
  let decompressor: DomainSpecificInputDecompressorInstance
  let registrar: BLSAddressAuthorizationsRegistrarInstance

  const batchInput: RLPBatchCompressedInput = {
    gasPrice: toBN(15),
    validUntil: toBN(15),
    relayWorker: toBN(15),
    pctRelayFee: toBN(15),
    baseRelayFee: toBN(15),
    maxAcceptanceBudget: toBN(15),
    blsSignature: [],
    relayRequestElements: [],
    authorizations: [],
    addToCache: none
  }

  before(async function () {
    blsTestHub = await BLSTestHub.new()
    decompressor = await DomainSpecificInputDecompressor.new(constants.ZERO_ADDRESS)
    registrar = await BLSAddressAuthorizationsRegistrar.new()
    gateway = await BLSBatchGateway.new(decompressor.address, registrar.address, blsTestHub.address)

    blsTypedDataSigner = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })
    decompressorInteractor = await new DecompressorInteractor({ provider: web3.currentProvider as HttpProvider })
      .init({ decompressorAddress: decompressor.address })
  })

  context('fallback function', function () {
    it('should accept empty batch and emit empty BatchRelayed event', async function () {
      const data = encodeBatch(batchInput)
      const receipt = await web3.eth.sendTransaction({
        from,
        to: gateway.address,
        data
      }) as TransactionReceipt
      await expectEvent.inTransaction(receipt.transactionHash, BLSBatchGateway, 'BatchRelayed', {
        relayWorker: from,
        accepted: '0',
        rejected: '0'
      })
    })

    it.only('should accept batch with a single element plus key approval and emit BatchRelayed event', async function () {
      // @ts-ignore
      const relayRequest: RelayRequest = {
        // @ts-ignore
        request: {
          from,
          to
        },
        // @ts-ignore
        relayData: {
          transactionCalldataGasUsed: '777'
        }
      }
      const batchItem = await decompressorInteractor.compressRelayRequest(toBN(777), relayRequest)
      const authorizationSignature = await createAuthorizationSignature(from, blsTypedDataSigner.blsKeypair, registrar)
      const blsPublicKey = blsTypedDataSigner.getPublicKeySerialized()
      const authorizationItem: SignedKeyAuthorization = {
        authorizer: from,
        blsPublicKey,
        signature: authorizationSignature
      }
      const blsSignature = await blsTypedDataSigner.signTypedDataBLS('0xffffffff')
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

    // note: this test relies on a previous test to cache the elements
    it('should accept batch with a single element with compresses fields and emit BatchRelayed event', async function () {
    })

    it('should accept batch with multiple elements with different fields and an aggregated BLS signature', async function () {
    })

    it('should reject batch with a single element with an incorrect BLS signature', async function () {
      // @ts-ignore
      const relayRequest: RelayRequest = {
        // @ts-ignore
        request: {
          from,
          to
        }
      }

      // it seems that if the signature is not some BLS signature hardhat will revert the entire transaction
      const batchItem = await decompressorInteractor.compressRelayRequest(toBN(777), relayRequest)
      const blsSignature = await blsTypedDataSigner.signTypedDataBLS('hello world')
      const data = encodeBatch(
        Object.assign({}, batchInput, {
          blsSignature,
          relayRequestElements: [batchItem]
        })
      )
      await expectRevert(web3.eth.call({
        from,
        to: gateway.address,
        data
      }), 'Error: VM Exception while processing transaction: reverted with reason string \'BLS signature verification failed\'')
    })

    it('should reject batch with multiple elements with an incorrect BLS aggregated signature', async function () {
    })
  })

  context('#decodeBatchItem()', function () {

  })
})
