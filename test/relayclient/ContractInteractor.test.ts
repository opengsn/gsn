import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { TestVersionsInstance } from '../../types/truffle-contracts'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { HttpProvider } from 'web3-core'
import { ProfilingProvider } from '../../src/common/dev/ProfilingProvider'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { configureGSN } from '../../src/relayclient/GSNConfigurator'
import { PrefixedHexString } from 'ethereumjs-tx'
import Transaction from 'ethereumjs-tx/dist/transaction'
import { constants } from '../../src/common/Constants'
import { createClientLogger } from '../../src/relayclient/ClientWinstonLogger'
import { LoggerInterface } from '../../src/common/LoggerInterface'
import express from 'express'
import { Server } from 'net'

const { expect } = chai.use(chaiAsPromised)

const TestVersions = artifacts.require('TestVersions')

contract('ContractInteractor', function () {
  let testVersions: TestVersionsInstance
  before(async function () {
    testVersions = await TestVersions.new()
  })

  // TODO: these tests create an entire instance of the client to test one method.
  context('#_validateCompatibility()', function () {
    it.skip('should throw if the hub version is incompatible', async function () {
      const relayClient = new RelayClient(web3.currentProvider as HttpProvider, {
        relayHubAddress: testVersions.address
      })
      await expect(relayClient.init()).to.be.eventually.rejectedWith('Provided Hub version(3.0.0) is not supported by the current interactor')
    })

    it('should not throw if the hub address is not configured', async function () {
      const relayClient = new RelayClient(web3.currentProvider as HttpProvider, {
        logLevel: 'error'
      })
      await relayClient.init()
    })
  })

  context('#broadcastTransaction()', function () {
    let provider: ProfilingProvider
    let contractInteractor: ContractInteractor
    let sampleTransactionHash: PrefixedHexString
    let sampleTransactionData: PrefixedHexString

    before(async function () {
      provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
      const logger = createClientLogger('error', '', '', '')
      contractInteractor = new ContractInteractor(provider, logger, configureGSN({}))
      const nonce = await web3.eth.getTransactionCount('0xb473D6BE09D0d6a23e1832046dBE258cF6E8635B')
      const transaction = new Transaction({ to: constants.ZERO_ADDRESS, gasLimit: '0x5208', nonce })
      transaction.sign(Buffer.from('46e6ef4a356fa3fa3929bf4b59e6b3eb9d0521ea660fd2879c67bd501002ac2b', 'hex'))
      sampleTransactionData = '0x' + transaction.serialize().toString('hex')
      sampleTransactionHash = '0x' + transaction.hash(true).toString('hex')
    })

    it('should sent the transaction to the blockchain directly', async function () {
      const txHash = await contractInteractor.broadcastTransaction(sampleTransactionData)
      assert.equal(txHash, sampleTransactionHash)
      assert.equal(provider.methodsCount.size, 1)
      assert.equal(provider.methodsCount.get('eth_sendRawTransaction'), 1)
    })
  })

  context('gas price oracle', () => {
    let contractInteractor: ContractInteractor
    let errorlog = ''
    const logger: LoggerInterface = {
      error: (e: string) => { errorlog = errorlog + '\n' + e }
    } as any
    let oracleUrl: string
    let mockOracleResponse: string
    let server: Server

    const etherscanOracleResponse = '{"status":"1","message":"OK-Missing/Invalid API Key, rate limit of 1/5sec applied","result":{"LastBlock":"11236652","SafeGasPrice":"18","ProposeGasPrice":"39","FastGasPrice":"54"}}'

    before(async () => {
      const mockServer = express()
      mockServer.get('/geturl', async (req, res) => {
        res.send(mockOracleResponse)
      })
      await new Promise((resolve) => {
        server = mockServer.listen(0, resolve)
      })
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      oracleUrl = `http://localhost:${(server as any).address().port}/geturl`
    })
    after(() => {
      server?.close()
    })

    describe('#getJsonElement', () => {
      let contractInteractor: ContractInteractor
      const blob = {
        abc: [
          { def: { ghi: 'hello' } }
        ]
      }

      before(() => {
        contractInteractor = new ContractInteractor({} as any, {} as any, {} as any)
      })

      it('should return value for good path', () => {
        assert.equal(contractInteractor.getJsonElement(blob, '.abc[0]["def"].ghi'), 'hello')
      })

      it('should return null for wrong path', () => {
        assert.isNull(contractInteractor.getJsonElement(blob, '.abc[0]["invalid"].ghi'))
        assert.isNull(contractInteractor.getJsonElement(blob, '.missing'))
      })

      it('should throw on malformed path', () => {
        expect(() => contractInteractor.getJsonElement(blob, 'abc.def')).to.throw('invalid path: abc.def')
        expect(() => contractInteractor.getJsonElement(blob, '.abc[noquote]')).to.throw('invalid path: .abc[noquote]')
      })
    })

    it('should use gasPriceOracle if provided', async () => {
      contractInteractor = new ContractInteractor(web3.currentProvider as any, logger, configureGSN({
        gasPriceOraclePath: '.result.ProposeGasPrice',
        gasPriceOracleUrl: oracleUrl
      }))
      mockOracleResponse = etherscanOracleResponse
      assert.equal(
        await contractInteractor.getGasPrice(),
        (JSON.parse(etherscanOracleResponse).result.ProposeGasPrice * 1e9).toString())
    })
    it('should use getGasPrice() if path not found', async () => {
      contractInteractor = new ContractInteractor(web3.currentProvider as any, logger, configureGSN({
        gasPriceOraclePath: '.result.wrongpath',
        gasPriceOracleUrl: oracleUrl
      }))
      errorlog = ''
      assert.equal(
        await contractInteractor.getGasPrice(),
        await web3.eth.getGasPrice())
      assert.match(errorlog, /not a number/)
    })
    it('should use getGasPrice() if return is not json', async () => {
      contractInteractor = new ContractInteractor(web3.currentProvider as any, logger, configureGSN({
        gasPriceOraclePath: '.result.ProposeGasPrice',
        gasPriceOracleUrl: oracleUrl
      }))
      mockOracleResponse = 'something that is not json response'
      errorlog = ''
      assert.equal(
        await contractInteractor.getGasPrice(),
        await web3.eth.getGasPrice())

      assert.match(errorlog, /not a number/)
    })
    it('should use getGasPrice() if failed  to connect oracle', async () => {
      contractInteractor = new ContractInteractor(web3.currentProvider as any, logger, configureGSN({
        gasPriceOraclePath: '.result.ProposeGasPrice',
        gasPriceOracleUrl: 'http://localhost:23456'
      }))
      errorlog = ''
      assert.equal(
        await contractInteractor.getGasPrice(),
        await web3.eth.getGasPrice())
      assert.match(errorlog, /ECONNREFUSED/)
    })
  })
})
