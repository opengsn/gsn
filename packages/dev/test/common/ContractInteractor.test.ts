import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sinon from 'sinon'
import { PastEventOptions } from 'web3-eth-contract'

import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { HttpProvider } from 'web3-core'
import { ProfilingProvider } from '@opengsn/common/dist/dev/ProfilingProvider'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { PrefixedHexString } from 'ethereumjs-util'
import { Transaction } from '@ethereumjs/tx'
import { constants } from '@opengsn/common/dist/Constants'
import { createClientLogger } from '@opengsn/provider/dist/ClientWinstonLogger'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { deployHub } from '../TestUtils'
import { VersionsManager } from '@opengsn/common/dist/VersionsManager'
import { gsnRequiredVersion, gsnRuntimeVersion } from '@opengsn/common/dist/Version'
import { GSNContractsDeployment } from '@opengsn/common/dist/GSNContractsDeployment'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { EventName } from '@opengsn/common/dist/types/Aliases'

const { expect } = chai.use(chaiAsPromised)

const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')

contract('ContractInteractor', function (accounts) {
  const provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
  const logger = createClientLogger({ logLevel: 'error' })
  const workerAddress = accounts[2]
  const maxPageSize = Number.MAX_SAFE_INTEGER

  let rh: RelayHubInstance
  let sm: StakeManagerInstance
  let pen: PenalizerInstance
  let pm: TestPaymasterConfigurableMisbehaviorInstance

  before(async () => {
    sm = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    pen = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
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
          maxPageSize,
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
        returnValue: 'view call to \'relayCall\' reverted in client: with reason string \'Paymaster balance too low\'',
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
        maxPageSize: Number.MAX_SAFE_INTEGER,
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
      contractInteractor = new ContractInteractor({ provider, logger, maxPageSize })
      await contractInteractor.init()
      provider.reset()
      const nonce = await web3.eth.getTransactionCount('0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc')
      let transaction = Transaction.fromTxData({ to: constants.ZERO_ADDRESS, gasLimit: '0x5208', gasPrice: 105157849, nonce }, contractInteractor.getRawTxOptions())
      transaction = transaction.sign(Buffer.from('8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', 'hex'))
      sampleTransactionData = '0x' + transaction.serialize().toString('hex')
      sampleTransactionHash = '0x' + transaction.hash().toString('hex')
    })

    it('should send the transaction to the blockchain directly', async function () {
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
      const contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize })
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
      const contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if not a paymaster contract', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: sm.address
      }
      const contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if wrong contract paymaster version', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: pm.address
      }
      const versionManager = new VersionsManager('1.0.0', '1.0.0-old-client')
      const contractInteractor = new ContractInteractor({ provider, logger, versionManager, deployment, maxPageSize })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith(/Provided.*version.*does not satisfy the requirement/)
    })
  })

  describe('#splitRange', () => {
    const contractInteractor = new ContractInteractor({ provider, logger, maxPageSize })
    it('split 1', () => {
      assert.deepEqual(contractInteractor.splitRange(1, 6, 1),
        [{ fromBlock: 1, toBlock: 6 }])
    })
    it('split 2', () => {
      assert.deepEqual(contractInteractor.splitRange(1, 6, 2),
        [{ fromBlock: 1, toBlock: 3 }, { fromBlock: 4, toBlock: 6 }])
    })
    it('split 2 odd', () => {
      assert.deepEqual(contractInteractor.splitRange(1, 7, 2),
        [{ fromBlock: 1, toBlock: 4 }, { fromBlock: 5, toBlock: 7 }])
    })
    it('split 3', () => {
      assert.deepEqual(contractInteractor.splitRange(1, 9, 3),
        [{ fromBlock: 1, toBlock: 3 }, { fromBlock: 4, toBlock: 6 }, { fromBlock: 7, toBlock: 9 }])
    })

    it('split 3 odd', () => {
      assert.deepEqual(contractInteractor.splitRange(1, 10, 3),
        [{ fromBlock: 1, toBlock: 4 }, { fromBlock: 5, toBlock: 8 }, { fromBlock: 9, toBlock: 10 }])
    })

    it('split with exactly 1 block for last range', () => {
      const splitRange = contractInteractor.splitRange(100, 200, 21)
      assert.equal(splitRange.length, 21)
      assert.deepEqual(splitRange[20], { fromBlock: 200, toBlock: 200 })
    })
  })

  context('#_getPastEventsPaginated', function () {
    const maxPageSize = 5
    let contractInteractor: ContractInteractor
    before(async function () {
      const deployment: GSNContractsDeployment = { paymasterAddress: pm.address }
      contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize })
      await contractInteractor.init()
      provider.reset()
    })

    it('should split requested events window into necessary number of parts', async function () {
      // from 100 to 200 is actually 101 blocks, with max page size of 5 it is 21 queries
      const expectedGetLogsCalls = 21
      await contractInteractor.getPastEventsForHub([], { fromBlock: 100, toBlock: 200 })
      const getLogsAfter = provider.methodsCount.get('eth_getLogs')
      assert.equal(getLogsAfter, expectedGetLogsCalls)
    })

    context('with stub 100 blocks getLogs limit', function () {
      before(function () {
        // @ts-ignore
        contractInteractor.maxPageSize = Number.MAX_SAFE_INTEGER
        sinon.stub(contractInteractor, '_getPastEvents').callsFake(async function (contract: any, names: EventName[], extraTopics: string[], options: PastEventOptions): Promise<any> {
          const fromBlock = options.fromBlock as number
          const toBlock = options.toBlock as number
          if (toBlock - fromBlock > 100) {
            throw new Error('query returned more than 100 events')
          }
          const ret: any[] = []
          for (let b = fromBlock; b <= toBlock; b++) {
            ret.push({ event: `event${b}-${fromBlock}-${toBlock}` })
          }
          return ret
        })
      })
      it('should break large request into multiple chunks', async () => {
        const ret = await contractInteractor.getPastEventsForHub([], { fromBlock: 1, toBlock: 300 })

        assert.equal(ret.length, 300)
        assert.equal(ret[0].event, 'event1-1-75')
        assert.equal(ret[299].event, 'event300-226-300')
      })
    })
  })
})
