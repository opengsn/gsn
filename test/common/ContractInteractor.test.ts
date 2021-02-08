import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance
} from '../../types/truffle-contracts'
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
import { gsnRequiredVersion, gsnRuntimeVersion } from '../../src/common/Version'
import { GSNContractsDeployment } from '../../src/common/GSNContractsDeployment'

const { expect } = chai.use(chaiAsPromised)

const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')

contract('ContractInteractor', function (accounts) {
  const provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
  const logger = createClientLogger({ logLevel: 'error' })
  const workerAddress = accounts[2]

  let rh: RelayHubInstance
  let sm: StakeManagerInstance
  let pen: PenalizerInstance
  let pm: TestPaymasterConfigurableMisbehaviorInstance

  before(async () => {
    sm = await StakeManager.new()
    pen = await Penalizer.new()
    rh = await deployHub(sm.address, pen.address)
    pm = await TestPaymasterConfigurableMisbehavior.new()
    await pm.setRelayHub(rh.address)
    const mgrAddress = accounts[1]
    await sm.setRelayManagerOwner(accounts[0], { from: mgrAddress })
    await sm.stakeForRelayManager(mgrAddress, 1000, { value: 1e18.toString() })
    await sm.authorizeHubByOwner(mgrAddress, rh.address)
    await rh.addRelayWorkers([workerAddress], { from: mgrAddress })
  })

  function addr (n: number): string {
    return '0x'.padEnd(42, `${n}`)
  }

  context('#validateRelayCall', () => {
    const versionManager = new VersionsManager(gsnRuntimeVersion, gsnRequiredVersion)
    it('should return relayCall revert reason', async () => {
      const contractInteractor = new ContractInteractor(
        {
          provider: web3.currentProvider as HttpProvider,
          versionManager,
          logger,
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
          gas: '50000',
          validUntil: '0'
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
        logger,
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
          gas: '50000',
          validUntil: '0'
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
    let contractInteractor: ContractInteractor
    let sampleTransactionHash: PrefixedHexString
    let sampleTransactionData: PrefixedHexString

    before(async function () {
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

  context('#_resolveDeployment()', function () {
    it('should resolve the deployment from paymaster', async function () {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: pm.address
      }
      const contractInteractor = new ContractInteractor({ provider, logger, deployment })
      await contractInteractor._resolveDeployment()
      const deploymentOut = contractInteractor.getDeployment()
      assert.equal(deploymentOut.paymasterAddress, pm.address)
      assert.equal(deploymentOut.relayHubAddress, rh.address)
      assert.equal(deploymentOut.stakeManagerAddress, sm.address)
      assert.equal(deploymentOut.penalizerAddress, pen.address)
      assert.equal(deploymentOut.versionRegistryAddress, undefined)
    })

    it('should throw if no contract at paymaster address', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: constants.ZERO_ADDRESS
      }
      const contractInteractor = new ContractInteractor({ provider, logger, deployment })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if not a paymaster contract', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: sm.address
      }
      const contractInteractor = new ContractInteractor({ provider, logger, deployment })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if wrong contract paymaster version', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: pm.address
      }
      const versionManager = new VersionsManager('1.0.0', '1.0.0-old-client')
      const contractInteractor = new ContractInteractor({ provider, logger, versionManager, deployment })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith(/Provided.*version.*does not satisfy the requirement/)
    })
  })
})
