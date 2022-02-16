import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sinon from 'sinon'
import BN from 'bn.js'
import { PastEventOptions } from 'web3-eth-contract'
import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestTokenInstance,
  TestDecimalsTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { HttpProvider } from 'web3-core'
import { ProfilingProvider } from '@opengsn/common/dist/dev/ProfilingProvider'
import { ContractInteractor, RelayCallABI } from '@opengsn/common/dist/ContractInteractor'
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
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { AddressZero } from 'ethers/constants'
import { toHex } from 'web3-utils'
import { IRelayRegistrarInstance } from '../../../contracts/types/truffle-contracts'
import { RelayRegistrarInstance } from '@opengsn/contracts'
import { TransactionType } from '@opengsn/common/dist/types/TransactionType'
import { ether } from '@openzeppelin/test-helpers'

const { expect } = chai.use(chaiAsPromised)

const TestDecimalsToken = artifacts.require('TestDecimalsToken')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const TestToken = artifacts.require('TestToken')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const RelayRegistrar = artifacts.require('RelayRegistrar')

const environment = defaultEnvironment

contract('ContractInteractor', function (accounts) {
  const provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
  const logger = createClientLogger({ logLevel: 'error' })
  const workerAddress = accounts[2]
  const maxPageSize = Number.MAX_SAFE_INTEGER
  const stake = ether('1')

  let rh: RelayHubInstance
  let sm: StakeManagerInstance
  let pen: PenalizerInstance
  let tt: TestTokenInstance
  let pm: TestPaymasterConfigurableMisbehaviorInstance

  before(async () => {
    tt = await TestToken.new()
    sm = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, constants.BURN_ADDRESS)
    pen = await Penalizer.new(
      defaultEnvironment.penalizerConfiguration.penalizeBlockDelay,
      defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    rh = await deployHub(sm.address, pen.address, constants.ZERO_ADDRESS, tt.address, stake.toString())
    pm = await TestPaymasterConfigurableMisbehavior.new()
    await pm.setRelayHub(rh.address)
    const mgrAddress = accounts[1]

    await tt.mint(stake)
    await tt.approve(sm.address, stake)
    await sm.setRelayManagerOwner(accounts[0], { from: mgrAddress })
    await sm.stakeForRelayManager(tt.address, mgrAddress, 15000, stake)
    await sm.authorizeHubByOwner(mgrAddress, rh.address)
    await rh.addRelayWorkers([workerAddress], { from: mgrAddress })
  })

  function addr (n: number): string {
    return '0x'.padEnd(42, `${n}`)
  }

  context('init()', function () {
    it('should throw on bad node/internet connection', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: web3.currentProvider as HttpProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      const stub = sinon.stub(contractInteractor.web3.eth, 'getBlock').rejects(new Error('No block number for you'))
      try {
        await expect(contractInteractor.init())
          .to.eventually.rejectedWith('No block number for you')
      } finally {
        stub.restore()
      }
    })
    it('should complete initialization', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: web3.currentProvider as HttpProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      assert.equal(contractInteractor.transactionType, TransactionType.LEGACY)
      const spy = sinon.spy(contractInteractor)
      await contractInteractor.init()
      sinon.assert.callOrder(
        spy._resolveDeployment,
        spy._initializeContracts,
        spy._validateCompatibility,
        spy._initializeNetworkParams
      )
      assert.exists(contractInteractor.relayHubInstance)
      assert.exists(contractInteractor.relayHubConfiguration)
      assert.equal(contractInteractor.transactionType, TransactionType.TYPE_TWO)
    })
    it('should not initialize twice', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: web3.currentProvider as HttpProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init().catch((e: Error) => { assert.equal(e.message, 'init was already called') })
    })
  })

  context('#validateRelayCall', () => {
    const versionManager = new VersionsManager(gsnRuntimeVersion, gsnRequiredVersion)
    let relayRequest: RelayRequest
    let encodedData: RelayCallABI
    before(function () {
      relayRequest = {
        request: {
          to: constants.ZERO_ADDRESS,
          data: '0x12345678',
          from: constants.ZERO_ADDRESS,
          nonce: '1',
          value: '0',
          gas: '50000',
          validUntilTime: '0'
        },
        relayData: {
          maxFeePerGas: '11',
          maxPriorityFeePerGas: '1',
          pctRelayFee: '0',
          baseRelayFee: '0',
          transactionCalldataGasUsed: '0',
          relayWorker: workerAddress,
          forwarder: constants.ZERO_ADDRESS,
          paymaster: pm.address,
          paymasterData: '0x',
          clientId: '1'
        }
      }
      encodedData = {
        maxAcceptanceBudget: '200000',
        relayRequest,
        signature: '0xdeadbeef',
        approvalData: '0x'
      }
    })

    it('should return relayCall revert reason', async () => {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: web3.currentProvider as HttpProvider,
          versionManager,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      const blockGasLimit = await contractInteractor._getBlockGasLimit()
      const ret = await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit))
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
        environment,
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
          validUntilTime: '0'
        },
        relayData: {
          maxFeePerGas: '1',
          maxPriorityFeePerGas: '1',
          pctRelayFee: '0',
          baseRelayFee: '0',
          transactionCalldataGasUsed: '0',
          relayWorker: workerAddress,
          forwarder: addr(4),
          paymaster: pm.address,
          paymasterData: '0x',
          clientId: '1'
        }
      }
      const blockGasLimit = await contractInteractor._getBlockGasLimit()
      const encodedData: RelayCallABI = {
        maxAcceptanceBudget: '200000',
        relayRequest,
        signature: '0xdeadbeef',
        approvalData: '0x'
      }
      const ret = await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit))
      assert.deepEqual(ret, {
        paymasterAccepted: false,
        returnValue: 'You asked me to revert, remember?',
        reverted: false
      })
    })

    it('should use gasPrice on networks without eip1559 support', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: web3.currentProvider as HttpProvider,
          versionManager,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      const blockGasLimit = await contractInteractor._getBlockGasLimit()
      const spy = sinon.spy(contractInteractor.web3.currentProvider as HttpProvider, 'send')
      try {
        contractInteractor.transactionType = TransactionType.LEGACY
        await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit))
      } finally {
        sinon.assert.calledOnce(spy)
        const rpcPayload = spy.getCall(0).args[0]
        assert.equal(rpcPayload.method, 'eth_call')
        assert.equal(rpcPayload.params[0].gasPrice, toHex(relayRequest.relayData.maxFeePerGas))
        spy.restore()
      }
    })

    it('should use maxFeePerGas/maxPriorityFeePerGas on networks with eip1559 support', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: web3.currentProvider as HttpProvider,
          versionManager,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      const blockGasLimit = await contractInteractor._getBlockGasLimit()
      const spy = sinon.spy(contractInteractor.web3.currentProvider as HttpProvider, 'send')
      try {
        await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit))
      } finally {
        sinon.assert.calledOnce(spy)
        const rpcPayload = spy.getCall(0).args[0]
        assert.equal(rpcPayload.method, 'eth_call')
        assert.equal(rpcPayload.params[0].maxFeePerGas, toHex(relayRequest.relayData.maxFeePerGas))
        assert.equal(rpcPayload.params[0].maxPriorityFeePerGas, toHex(relayRequest.relayData.maxPriorityFeePerGas))
        spy.restore()
      }
    })

    context('#__fixGasFees()', () => {
      it('should return gas fees depending on network support', async function () {
        const contractInteractor = new ContractInteractor(
          {
            environment,
            provider: web3.currentProvider as HttpProvider,
            logger,
            maxPageSize,
            deployment: { paymasterAddress: pm.address }
          })
        await contractInteractor.init()
        contractInteractor.transactionType = TransactionType.LEGACY
        let gasFees = contractInteractor._fixGasFees(relayRequest)
        assert.equal(gasFees.gasPrice, toHex(relayRequest.relayData.maxFeePerGas))
        contractInteractor.transactionType = TransactionType.TYPE_TWO
        gasFees = contractInteractor._fixGasFees(relayRequest)
        assert.equal(gasFees.maxFeePerGas, toHex(relayRequest.relayData.maxFeePerGas))
        assert.equal(gasFees.maxPriorityFeePerGas, toHex(relayRequest.relayData.maxPriorityFeePerGas))
      })
    })
  })

  context('#broadcastTransaction()', function () {
    let contractInteractor: ContractInteractor
    let sampleTransactionHash: PrefixedHexString
    let sampleTransactionData: PrefixedHexString

    before(async function () {
      contractInteractor = new ContractInteractor({ provider, logger, maxPageSize, environment })
      await contractInteractor.init()
      provider.reset()
      const nonce = await web3.eth.getTransactionCount('0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc')
      let transaction = Transaction.fromTxData({
        to: constants.ZERO_ADDRESS,
        gasLimit: '0x5208',
        gasPrice: toHex(await web3.eth.getGasPrice()),
        nonce
      }, contractInteractor.getRawTxOptions())
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
      const contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize, environment })
      await contractInteractor._resolveDeployment()
      const deploymentOut = contractInteractor.getDeployment()
      assert.equal(deploymentOut.paymasterAddress, pm.address)
      assert.equal(deploymentOut.relayHubAddress, rh.address)
      assert.equal(deploymentOut.stakeManagerAddress, sm.address)
      assert.equal(deploymentOut.penalizerAddress, pen.address)
    })

    it('should throw if no contract at paymaster address', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: constants.ZERO_ADDRESS
      }
      const contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize, environment })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if not a paymaster contract', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: sm.address
      }
      const contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize, environment })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if wrong contract paymaster version', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: pm.address
      }
      const versionManager = new VersionsManager('1.0.0', '1.0.0-old-client')
      const contractInteractor = new ContractInteractor({
        provider,
        logger,
        versionManager,
        deployment,
        maxPageSize,
        environment
      })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith(/Provided.*version.*does not satisfy the requirement/)
    })
  })

  describe('#splitRange', () => {
    const contractInteractor = new ContractInteractor({ provider, logger, maxPageSize, environment })
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

  context('#formatTokenAmount()', function () {
    let contractInteractor: ContractInteractor
    let testDecimalsToken: TestDecimalsTokenInstance
    before(async function () {
      testDecimalsToken = await TestDecimalsToken.new()
      await testDecimalsToken.mint('123456789123456789123', { from: accounts[1] })
      const deployment: GSNContractsDeployment = { managerStakeTokenAddress: testDecimalsToken.address }
      contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize, environment })
      await contractInteractor.init()
    })

    it('should display amount correctly with 24 decimals', async function () {
      await testDecimalsToken.setDecimals(24)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, '0.000123456789123456 DEC')
    })

    it('should display amount correctly with 18 decimals', async function () {
      await testDecimalsToken.setDecimals(18)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, '123.456789123456789123 DEC')
    })

    it('should display amount correctly with 18 decimals but 0 total balance', async function () {
      await testDecimalsToken.setDecimals(18)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[3])
      assert.equal(balanceFormatted, '0 DEC')
    })

    it('should display amount correctly with 6 decimals', async function () {
      await testDecimalsToken.setDecimals(6)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, '123456789123456.789123 DEC')
    })

    it('should display amount correctly with 2 decimals', async function () {
      await testDecimalsToken.setDecimals(2)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, '1234567891234567891.23 DEC')
    })

    it('should display amount correctly with 0 decimals', async function () {
      await testDecimalsToken.setDecimals(0)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, '123456789123456789123 DEC')
    })
  })

  context('#isRelayManagerStakedOnHub()', function () {
    let contractInteractor: ContractInteractor
    before(async function () {
      const deployment: GSNContractsDeployment = { paymasterAddress: pm.address }
      contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize, environment })
      await contractInteractor.init()
    })

    it('should return false and an error message if not staked', async function () {
      const res = await contractInteractor.isRelayManagerStakedOnHub(accounts[0])
      assert.deepEqual(res, { isStaked: false, errorMessage: 'relay manager not staked' })
    })

    it('should return true and no error message if staked', async function () {
      const res = await contractInteractor.isRelayManagerStakedOnHub(accounts[1])
      assert.deepEqual(res, { isStaked: true, errorMessage: null })
    })
  })

  context('#_getPastEventsPaginated', function () {
    const maxPageSize = 5
    let contractInteractor: ContractInteractor
    before(async function () {
      const deployment: GSNContractsDeployment = { paymasterAddress: pm.address }
      contractInteractor = new ContractInteractor({ provider, logger, deployment, maxPageSize, environment })
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
        if (process.env.TEST_LONG == null) {
          console.log('skipped long test. set TEST_LONG to enable')
          this.skip()
          return
        }
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

  context('gas calculations', function () {
    const originalGasEstimation = 100000
    const msgDataLength = 42
    let contractInteractor: ContractInteractor
    let gsnTransactionDetails: GsnTransactionDetails

    before(async function () {
      contractInteractor = new ContractInteractor({ provider, logger, maxPageSize, environment })
      await contractInteractor.init()
      sinon.stub(contractInteractor.web3.eth, 'estimateGas').resolves(originalGasEstimation)
    })

    context('#estimateGasWithoutCalldata()', function () {
      it('should calculate gas used for calculation only', async function () {
        gsnTransactionDetails = {
          from: accounts[0],
          to: accounts[0],
          data: '0x' + 'ff'.repeat(msgDataLength),
          clientId: '1',
          maxFeePerGas: '0x1',
          maxPriorityFeePerGas: '0x1'
        }
        const estimation = await contractInteractor.estimateGasWithoutCalldata(gsnTransactionDetails)
        const expectedEstimation = originalGasEstimation - msgDataLength * defaultEnvironment.gtxdatanonzero
        assert.equal(estimation, expectedEstimation)
      })

      it('should throw if calldataGasCost estimation exceeds originalGasEstimation', async function () {
        gsnTransactionDetails = {
          from: accounts[0],
          to: accounts[0],
          data: '0x' + 'ff'.repeat(msgDataLength * 10000),
          clientId: '1',
          maxFeePerGas: '0x1',
          maxPriorityFeePerGas: '0x1'
        }
        await expect(contractInteractor.estimateGasWithoutCalldata(gsnTransactionDetails))
          .to.eventually.be.rejectedWith('calldataGasCost exceeded originalGasEstimation')
      })
    })
  })

  context('#LightTruffleContract', () => {
    let contractInteractor: ContractInteractor
    let relayReg: RelayRegistrarInstance
    let lightreg: IRelayRegistrarInstance

    before(async () => {
      // Using contractInteractor, since hard to test directly: it has (deliberately) the same names as truffle contracts..
      contractInteractor = new ContractInteractor(
        {
          environment,
          provider: web3.currentProvider as HttpProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      relayReg = await RelayRegistrar.new(AddressZero, true)
      lightreg = await contractInteractor._createRelayRegistrar(relayReg.address)

      await relayReg.registerRelayServer(10, 11, 'url1', { from: accounts[1] })
      await relayReg.registerRelayServer(20, 21, 'url2', { from: accounts[2] })
    })

    // it('should get matching numeric return value', async () => {
    //   expect(await lightreg.countRelays())
    //     .to.deep.equal(await relayReg.countRelays())
    // })
    it('should get matching returned struct', async () => {
      expect(await lightreg.getRelayInfo(accounts[1]))
        .to.eql(await relayReg.getRelayInfo(accounts[1]))
    })
    // note: this is no longer true - we retype tuples to BN in LightTruffleContracts while actual Truffle doesn't do so
    it.skip('should get matching mixed return values', async () => {
      expect(await lightreg.readRelayInfos(0, 100))
        .to.eql(await relayReg.readRelayInfos(0, 100))
    })
  })
})
