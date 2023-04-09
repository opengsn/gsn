import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import sinon from 'sinon'
import BN from 'bn.js'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { BigNumber } from '@ethersproject/bignumber'
import { PastEventOptions } from 'web3-eth-contract'
import {
  ForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestDecimalsTokenInstance,
  TestPaymasterConfigurableMisbehaviorInstance,
  TestRelayHubForRegistrarInstance,
  TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { ProfilingProvider } from '@opengsn/common/dist/dev/ProfilingProvider'
import {
  ContractInteractor,
  EventName,
  GSNContractsDeployment,
  GsnTransactionDetails,
  RelayCallABI,
  RelayRequest,
  TransactionType,
  VersionsManager,
  constants,
  defaultEnvironment,
  gsnRequiredVersion,
  gsnRuntimeVersion,
  splitRelayUrlForRegistrar, environments
} from '@opengsn/common'
import { PrefixedHexString } from 'ethereumjs-util'
import { Transaction } from '@ethereumjs/tx'

import { createClientLogger } from '@opengsn/logger/dist/ClientWinstonLogger'

import { deployHub } from '../TestUtils'

import { toHex } from 'web3-utils'
import { IRelayRegistrarInstance } from '../../../contracts/types/truffle-contracts'
import { RelayRegistrarInstance } from '@opengsn/contracts'

import { ether } from '@openzeppelin/test-helpers'
import { defaultGsnConfig } from '@opengsn/provider'

const { expect } = chai.use(chaiAsPromised)

const TestRelayHubForRegistrar = artifacts.require('TestRelayHubForRegistrar')
const TestDecimalsToken = artifacts.require('TestDecimalsToken')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')
const TestToken = artifacts.require('TestToken')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Forwarder = artifacts.require('Forwarder')
const TestRecipient = artifacts.require('TestRecipient')
const RelayRegistrar = artifacts.require('RelayRegistrar')

const environment = defaultEnvironment

contract('ContractInteractor', function (accounts) {
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

  const provider = new ProfilingProvider(currentProviderHost)
  const logger = createClientLogger({ logLevel: 'error' })
  const workerAddress = accounts[2]
  const maxPageSize = Number.MAX_SAFE_INTEGER
  const stake = ether('1')

  let rh: RelayHubInstance
  let sm: StakeManagerInstance
  let pen: PenalizerInstance
  let tt: TestTokenInstance
  let pm: TestPaymasterConfigurableMisbehaviorInstance
  let fw: ForwarderInstance

  before(async () => {
    tt = await TestToken.new()
    sm = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    pen = await Penalizer.new(
      defaultEnvironment.penalizerConfiguration.penalizeBlockDelay,
      defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    rh = await deployHub(sm.address, pen.address, constants.ZERO_ADDRESS, tt.address, stake.toString())
    fw = await Forwarder.new()
    pm = await TestPaymasterConfigurableMisbehavior.new()
    await pm.setRelayHub(rh.address)
    await pm.setTrustedForwarder(fw.address)
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
          provider: ethersProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      const stub = sinon.stub(contractInteractor.provider, 'getBlock').rejects(new Error('No block number for you'))
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
          provider: ethersProvider,
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
          provider: ethersProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      await expect(contractInteractor.init()).to.be.rejectedWith('init was already called')
    })
    it('should fall back to Legacy Type if network returns block.baseFeePerGas but rpc node doesn\'t support eth_feeHistory', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: ethersProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      const stub = sinon.stub(contractInteractor, 'getFeeHistory').rejects(new Error('No fee history for you'))
      // @ts-ignore
      const spy = sinon.spy(contractInteractor.logger, 'warn')
      try {
        await contractInteractor.init()
        const transactionType = contractInteractor.transactionType
        assert.equal(transactionType, TransactionType.LEGACY)
        sinon.assert.calledWith(spy, 'Call to \'eth_feeHistory\' failed. Falling back to Legacy Transaction Type.')
      } finally {
        stub.restore()
      }
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
          transactionCalldataGasUsed: '0',
          relayWorker: workerAddress,
          forwarder: constants.ZERO_ADDRESS,
          paymaster: pm.address,
          paymasterData: '0x',
          clientId: '1'
        }
      }
      encodedData = {
        domainSeparatorName: defaultGsnConfig.domainSeparatorName,
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
          provider: ethersProvider,
          versionManager,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      const blockGasLimit = await contractInteractor.getBlockGasLimit()
      const ret = await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit), false)
      assert.deepEqual(ret, {
        paymasterAccepted: false,
        returnValue: 'view call to \'relayCall\' reverted in client: Paymaster balance too low',
        relayHubReverted: true,
        recipientReverted: false
      })
    })

    it('should return paymaster revert reason', async () => {
      const forwarder = await Forwarder.new()
      const recipient = await TestRecipient.new(forwarder.address)
      const pm = await TestPaymasterConfigurableMisbehavior.new()
      await pm.setRelayHub(rh.address)
      await rh.depositFor(pm.address, { value: 1e18.toString() })
      await pm.setRevertPreRelayCall(true)
      await pm.setTrustedForwarder(forwarder.address)
      const contractInteractor = new ContractInteractor({
        environment,
        provider: ethersProvider,
        versionManager,
        logger,
        maxPageSize: Number.MAX_SAFE_INTEGER,
        deployment: { paymasterAddress: pm.address }
      })
      await contractInteractor.init()

      const relayRequest: RelayRequest = {
        request: {
          to: recipient.address,
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
          transactionCalldataGasUsed: '0',
          relayWorker: workerAddress,
          forwarder: forwarder.address,
          paymaster: pm.address,
          paymasterData: '0x',
          clientId: '1'
        }
      }
      const blockGasLimit = await contractInteractor.getBlockGasLimit()
      const encodedData: RelayCallABI = {
        domainSeparatorName: defaultGsnConfig.domainSeparatorName,
        maxAcceptanceBudget: '200000',
        relayRequest,
        signature: '0xdeadbeef',
        approvalData: '0x'
      }
      const ret = await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit), false)
      assert.deepEqual(ret, {
        paymasterAccepted: false,
        returnValue: 'You asked me to revert, remember?',
        relayHubReverted: false,
        recipientReverted: false
      })
    })

    it('should use gasPrice on networks without eip1559 support', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: ethersProvider,
          versionManager,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      const blockGasLimit = await contractInteractor.getBlockGasLimit()
      const spy = sinon.spy(contractInteractor.provider, 'send')
      try {
        contractInteractor.transactionType = TransactionType.LEGACY
        await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit), false)
      } finally {
        sinon.assert.calledOnce(spy)
        const method = spy.getCall(0).args[0]
        const params = spy.getCall(0).args[1]
        assert.equal(method, 'eth_call')
        // @ts-ignore
        assert.equal(params[0].gasPrice, toHex(relayRequest.relayData.maxFeePerGas))
        spy.restore()
      }
    })

    it('should use maxFeePerGas/maxPriorityFeePerGas on networks with eip1559 support', async function () {
      const contractInteractor = new ContractInteractor(
        {
          environment,
          provider: ethersProvider,
          versionManager,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      const blockGasLimit = await contractInteractor.getBlockGasLimit()
      const spy = sinon.spy(contractInteractor.provider, 'send')
      try {
        await contractInteractor.validateRelayCall(encodedData, new BN(blockGasLimit), false)
      } finally {
        sinon.assert.calledOnce(spy)
        const method = spy.getCall(0).args[0]
        const params = spy.getCall(0).args[1]
        assert.equal(method, 'eth_call')
        assert.equal(params[0].maxFeePerGas, toHex(relayRequest.relayData.maxFeePerGas))
        assert.equal(params[0].maxPriorityFeePerGas, toHex(relayRequest.relayData.maxPriorityFeePerGas))
        spy.restore()
      }
    })

    context('#__fixGasFees()', () => {
      it('should return gas fees depending on network support', async function () {
        const contractInteractor = new ContractInteractor(
          {
            environment,
            provider: ethersProvider,
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
      const contractInteractor = new ContractInteractor({
        provider: ethersProvider,
        logger,
        deployment,
        maxPageSize,
        environment
      })
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
      const contractInteractor = new ContractInteractor({
        provider: ethersProvider,
        logger,
        deployment,
        maxPageSize,
        environment
      })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if not a paymaster contract', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: sm.address
      }
      const contractInteractor = new ContractInteractor({
        provider: ethersProvider,
        logger,
        deployment,
        maxPageSize,
        environment
      })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith('Not a paymaster contract')
    })

    it('should throw if wrong contract paymaster version', async () => {
      const deployment: GSNContractsDeployment = {
        paymasterAddress: pm.address
      }
      const versionManager = new VersionsManager('1.0.0', '1.0.0-old-client')
      const contractInteractor = new ContractInteractor({
        provider: ethersProvider,
        logger,
        versionManager,
        deployment,
        maxPageSize,
        environment
      })
      await expect(contractInteractor._resolveDeployment())
        .to.eventually.rejectedWith(/Provided.*version.*does not satisfy the requirement/)
    })

    describe('#_validateERC165Interfaces()', function () {
      it('should fail verification of ERC-165 interfaces if no contract instance is initialized', async function () {
        const deployment = {}
        const contractInteractor = new ContractInteractor({
          provider: ethersProvider,
          logger,
          deployment,
          maxPageSize,
          environment
        })
        await contractInteractor.init()
        await expect(contractInteractor._validateERC165InterfacesRelay())
          .to.eventually.be.rejectedWith('ERC-165 interface check failed. Penalizer instance is not initialized')
        await expect(contractInteractor._validateERC165InterfacesClient())
          .to.eventually.be.rejectedWith('ERC-165 interface check failed. Forwarder instance is not initialized')
      })

      it('should verify ERC-165 interfaces of all contracts in the resolved deployment', async function () {
        const fw = await Forwarder.new()

        // no contract at address
        const deployment = {
          forwarderAddress: fw.address,
          relayHubAddress: rh.address,
          paymasterAddress: pm.address,
          penalizerAddress: pen.address,
          relayRegistrarAddress: constants.BURN_ADDRESS,
          stakeManagerAddress: sm.address
        }
        let contractInteractor = new ContractInteractor({
          provider: ethersProvider,
          logger,
          deployment,
          maxPageSize,
          environment
        })
        await contractInteractor.init()
        await expect(contractInteractor._validateERC165InterfacesRelay())
          .to.eventually.be.rejectedWith(new RegExp(`Failed call to RelayRegistrar supportsInterface at address: ${constants.BURN_ADDRESS}`))

        // incorrect contract at address
        deployment.relayRegistrarAddress = sm.address
        contractInteractor = new ContractInteractor({
          provider: ethersProvider,
          logger,
          deployment,
          maxPageSize,
          environment
        })
        await contractInteractor.init()
        await expect(contractInteractor._validateERC165InterfacesRelay())
          .to.eventually.be.rejectedWith('ERC-165 interface check failed. PN: true RR: false RH: true SM: true')

        // all contracts correct
        const rr = await RelayRegistrar.new(constants.yearInSec)
        deployment.relayRegistrarAddress = rr.address
        contractInteractor = new ContractInteractor({
          provider: ethersProvider,
          logger,
          deployment,
          maxPageSize,
          environment
        })
        await contractInteractor.init()
        await contractInteractor._validateERC165InterfacesRelay()
      })
    })
  })

  describe('#splitRange', () => {
    const contractInteractor = new ContractInteractor({ provider: ethersProvider, logger, maxPageSize, environment })
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
    let shortTokenAddress: string
    before(async function () {
      testDecimalsToken = await TestDecimalsToken.new()
      shortTokenAddress = `${testDecimalsToken.address.substring(0, 6)}...${testDecimalsToken.address.substring(39)}`
      await testDecimalsToken.mint('123456789123456789123', { from: accounts[1] })
      const deployment: GSNContractsDeployment = { managerStakeTokenAddress: testDecimalsToken.address }
      contractInteractor = new ContractInteractor({
        provider: ethersProvider,
        logger,
        deployment,
        maxPageSize,
        environment
      })
      await contractInteractor.init()
    })

    it('should display amount correctly with 24 decimals', async function () {
      await testDecimalsToken.setDecimals(24)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, `0.000123456789123456 DEC (${shortTokenAddress})`)
    })

    it('should display amount correctly with 18 decimals', async function () {
      await testDecimalsToken.setDecimals(18)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, `123.456789123456789123 DEC (${shortTokenAddress})`)
    })

    it('should display amount correctly with 18 decimals but 0 total balance', async function () {
      await testDecimalsToken.setDecimals(18)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[3])
      assert.equal(balanceFormatted, `0 DEC (${shortTokenAddress})`)
    })

    it('should display amount correctly with 6 decimals', async function () {
      await testDecimalsToken.setDecimals(6)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, `123456789123456.789123 DEC (${shortTokenAddress})`)
    })

    it('should display amount correctly with 2 decimals', async function () {
      await testDecimalsToken.setDecimals(2)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, `1234567891234567891.23 DEC (${shortTokenAddress})`)
    })

    it('should display amount correctly with 0 decimals', async function () {
      await testDecimalsToken.setDecimals(0)
      const balanceFormatted = await contractInteractor.getTokenBalanceFormatted(accounts[1])
      assert.equal(balanceFormatted, `123456789123456789123 DEC (${shortTokenAddress})`)
    })
  })

  context('#isRelayManagerStakedOnHub()', function () {
    let contractInteractor: ContractInteractor
    before(async function () {
      const deployment: GSNContractsDeployment = { paymasterAddress: pm.address }
      contractInteractor = new ContractInteractor({
        provider: ethersProvider,
        logger,
        deployment,
        maxPageSize,
        environment
      })
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
        sinon.stub(contractInteractor, '_getPastEvents').callsFake(async function (contract: any, names: EventName[], extraTopics: Array<string[] | string | null>, options: PastEventOptions): Promise<any> {
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
        assert.equal(ret[0].name, 'event1-1-75')
        assert.equal(ret[299].name, 'event300-226-300')
      })
    })
  })

  context('gas calculations', function () {
    const originalGasEstimation = 100000
    const msgDataLength = 42
    let contractInteractor: ContractInteractor
    let gsnTransactionDetails: GsnTransactionDetails

    before(async function () {
      contractInteractor = new ContractInteractor({
        provider: ethersProvider, logger, maxPageSize, environment
      })
      await contractInteractor.init()
    })

    context('#estimateGasWithoutCalldata()', function () {
      it('should calculate gas used for calculation only', async function () {
        const stubbedEstimateGasEthersProvider = new StaticJsonRpcProvider(currentProviderHost)
        const contractInteractor = new ContractInteractor({
          provider: stubbedEstimateGasEthersProvider, logger, maxPageSize, environment
        })
        await contractInteractor.init()
        sinon.stub(contractInteractor.provider, 'estimateGas')
          .resolves(BigNumber.from(originalGasEstimation))
        gsnTransactionDetails = {
          from: accounts[0],
          to: accounts[0],
          data: '0x' + 'ff'.repeat(msgDataLength),
          clientId: '1',
          maxFeePerGas: '0x1',
          maxPriorityFeePerGas: '0x1'
        }
        const estimation = await contractInteractor.estimateInnerCallGasLimit(gsnTransactionDetails)
        const expectedEstimation = originalGasEstimation - defaultEnvironment.mintxgascost - msgDataLength * defaultEnvironment.gtxdatanonzero
        assert.equal(estimation, expectedEstimation)
      })

      it('should calculate gas used for calculation only using async estimate gas', async function () {
        const recipient = await TestRecipient.new(constants.ZERO_ADDRESS)
        const asyncContractInteractor = new ContractInteractor(
          {
            environment: environments.arbitrum,
            provider: ethersProvider,
            logger,
            maxPageSize,
            deployment: { paymasterAddress: pm.address }
          })
        gsnTransactionDetails = {
          from: accounts[0],
          to: recipient.address,
          data: '0x' + 'ff'.repeat(msgDataLength),
          clientId: '1',
          maxFeePerGas: '0xffffffff',
          maxPriorityFeePerGas: '0xffffffff'
        }
        const estimation = await asyncContractInteractor.estimateInnerCallGasLimit(gsnTransactionDetails)
        const expectedEstimation = 60000 // TestRecipient fallback function makes 3 SSTOREs
        assert.isOk(estimation > expectedEstimation)
        assert.closeTo(estimation, expectedEstimation, 10000)
      })

      it('should throw if calldataGasCost estimation exceeds originalGasEstimation', async function () {
        const stubbedEstimateGasEthersProvider = new StaticJsonRpcProvider(currentProviderHost)
        const contractInteractor = new ContractInteractor({
          provider: stubbedEstimateGasEthersProvider, logger, maxPageSize, environment
        })
        await contractInteractor.init()
        sinon.stub(contractInteractor.provider, 'estimateGas')
          .resolves(BigNumber.from(originalGasEstimation))

        gsnTransactionDetails = {
          from: accounts[0],
          to: accounts[0],
          data: '0x' + 'ff'.repeat(msgDataLength * 10000),
          clientId: '1',
          maxFeePerGas: '0x1',
          maxPriorityFeePerGas: '0x1'
        }
        await expect(contractInteractor.estimateInnerCallGasLimit(gsnTransactionDetails))
          .to.eventually.be.rejectedWith(/calldataGasCost\(.*\) exceeded originalGasEstimation\(100000\)/)
      })
    })
  })

  context('#LightTruffleContract', () => {
    let contractInteractor: ContractInteractor
    let relayReg: RelayRegistrarInstance
    let testRelayHub: TestRelayHubForRegistrarInstance
    let lightreg: IRelayRegistrarInstance

    before(async () => {
      // Using contractInteractor, since hard to test directly: it has (deliberately) the same names as truffle contracts..
      contractInteractor = new ContractInteractor(
        {
          environment,
          provider: ethersProvider,
          logger,
          maxPageSize,
          deployment: { paymasterAddress: pm.address }
        })
      await contractInteractor.init()
      relayReg = await RelayRegistrar.new(constants.yearInSec)
      lightreg = await contractInteractor._createRelayRegistrar(relayReg.address)
      testRelayHub = await TestRelayHubForRegistrar.new()

      await testRelayHub.setRelayManagerStaked(accounts[1], true)
      await testRelayHub.setRelayManagerStaked(accounts[2], true)
      await relayReg.registerRelayServer(testRelayHub.address, splitRelayUrlForRegistrar('url1'), { from: accounts[1] })
      await relayReg.registerRelayServer(testRelayHub.address, splitRelayUrlForRegistrar('url2'), { from: accounts[2] })
    })

    // it('should get matching numeric return value', async () => {
    //   expect(await lightreg.countRelays())
    //     .to.deep.equal(await relayReg.countRelays())
    // })
    it('should get matching returned struct', async () => {
      expect(await lightreg.getRelayInfo(testRelayHub.address, accounts[1]))
        .to.eql(await relayReg.getRelayInfo(testRelayHub.address, accounts[1]))
    })
    // note: this is no longer true - we retype tuples to BN in LightTruffleContracts while actual Truffle doesn't do so
    it.skip('should get matching mixed return values', async () => {
      expect(await lightreg.readRelayInfosInRange(constants.ZERO_ADDRESS, 0, 0, 100))
        .to.eql(await relayReg.readRelayInfosInRange(constants.ZERO_ADDRESS, 0, 0, 100))
    })
  })
})
