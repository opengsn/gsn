import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import { RelayHubInstance } from '../../types/truffle-contracts'
import { HttpProvider } from 'web3-core'
import { ProfilingProvider } from '../../src/common/dev/ProfilingProvider'
import ContractInteractor from '../../src/common/ContractInteractor'
import { PrefixedHexString } from 'ethereumjs-tx'
import Transaction from 'ethereumjs-tx/dist/transaction'
import { constants } from '../../src/common/Constants'
import { createClientLogger } from '../../src/relayclient/ClientWinstonLogger'
import RelayRequest from '../../src/common/EIP712/RelayRequest'
import { deployHub } from '../TestUtils'
import VersionsManager from '../../src/common/VersionsManager'
import { gsnRuntimeVersion } from '../../src/common/Version'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { expect } = chai.use(chaiAsPromised)

const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')

contract('ContractInteractor', function (accounts) {
  /*
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
  })
  */

  function addr (n: number): string {
    return '0x'.padEnd(42, `${n}`)
  }

  context('#validateRelayCall', () => {
    let rh: RelayHubInstance
    const workerAddress = accounts[2]
    const nullLogger = createClientLogger({ logLevel: 'error' })
    const versionManager = new VersionsManager(gsnRuntimeVersion)

    before(async () => {
      const sm = await StakeManager.new()
      const pen = await Penalizer.new()
      rh = await deployHub(sm.address, pen.address)
      const mgrAddress = accounts[1]
      await sm.stakeForAddress(mgrAddress, 1000, { value: 1e18.toString() })
      await sm.authorizeHubByOwner(mgrAddress, rh.address)
      await rh.addRelayWorkers([workerAddress], { from: mgrAddress })
    })

    it('should return relayCall revert reason', async () => {
      const pm = await TestPaymasterConfigurableMisbehavior.new()
      await pm.setRelayHub(rh.address)
      const contractInteractor = new ContractInteractor(
        {
          provider: web3.currentProvider as HttpProvider,
          versionManager,
          logger: nullLogger,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()

      const relayRequest: RelayRequest = {
        request: {
          to: constants.ZERO_ADDRESS,
          data: '0x12345678',
          from: constants.ZERO_ADDRESS,
          nonce: '1',
          value: '0',
          gas: '50000'
        },
        relayData: {
          gasPrice: '1',
          pctRelayFee: '0',
          baseRelayFee: '0',
          relayWorker: workerAddress,
          forwarder: constants.ZERO_ADDRESS,
          paymaster: pm.address,
          paymasterData: '0x',
          clientId: '1'
        }
      }
      const ret = await contractInteractor.validateRelayCall(200000, relayRequest, '0x', '0x')
      assert.deepEqual(ret, {
        paymasterAccepted: false,
        returnValue: 'view call to \'relayCall\' reverted in client: Paymaster balance too low',
        reverted: true
      })
    })

    it('should return paymaster revert reason', async () => {
      const pm = await TestPaymasterConfigurableMisbehavior.new()
      await pm.setRelayHub(rh.address)
      await rh.depositFor(pm.address, { value: 1e18.toString() })
      await pm.setRevertPreRelayCall(true)
      const contractInteractor = new ContractInteractor({
        provider: web3.currentProvider as HttpProvider,
        versionManager,
        logger: nullLogger,
        deployment: { paymasterAddress: pm.address }
      })
      await contractInteractor.init()

      const relayRequest: RelayRequest = {
        request: {
          to: addr(1),
          data: '0x12345678',
          from: addr(2),
          nonce: '1',
          value: '0',
          gas: '50000'
        },
        relayData: {
          gasPrice: '1',
          pctRelayFee: '0',
          baseRelayFee: '0',
          relayWorker: workerAddress,
          forwarder: addr(4),
          paymaster: pm.address,
          paymasterData: '0x',
          clientId: '1'
        }
      }
      const ret = await contractInteractor.validateRelayCall(200000, relayRequest, '0x', '0x')
      assert.deepEqual(ret, {
        paymasterAccepted: false,
        returnValue: 'You asked me to revert, remember?',
        reverted: false
      })
    })
  })

  context('#broadcastTransaction()', function () {
    let provider: ProfilingProvider
    let contractInteractor: ContractInteractor
    let sampleTransactionHash: PrefixedHexString
    let sampleTransactionData: PrefixedHexString

    before(async function () {
      provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
      const logger = createClientLogger({ logLevel: 'error' })
      contractInteractor = new ContractInteractor({ provider, logger })
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
