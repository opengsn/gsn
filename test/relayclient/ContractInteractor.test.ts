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
import { createLogger } from '../../src/relayclient/ClientWinstonLogger'

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
      await expect(relayClient._init()).to.be.eventually.rejectedWith('Provided Hub version(3.0.0) is not supported by the current interactor')
    })

    it('should not throw if the hub address is not configured', async function () {
      const relayClient = new RelayClient(web3.currentProvider as HttpProvider, {
        logLevel: 'error'
      })
      await relayClient._init()
    })
  })

  context('#broadcastTransaction()', function () {
    let provider: ProfilingProvider
    let contractInteractor: ContractInteractor
    let sampleTransactionHash: PrefixedHexString
    let sampleTransactionData: PrefixedHexString

    before(async function () {
      provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
      const logger = createLogger('error', '', '')
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
})
