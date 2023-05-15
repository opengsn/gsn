// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import crypto from 'crypto'
import sinon from 'sinon'
import { HttpProvider } from 'web3-core'
import { JsonRpcProvider, StaticJsonRpcProvider } from '@ethersproject/providers'
import { toBN, toHex } from 'web3-utils'
import * as ethUtils from 'ethereumjs-util'
import {
  Address,
  ContractInteractor,
  GSNContractsDeployment,
  GsnTransactionDetails,
  PingResponse,
  RegistrarRelayInfo,
  RelayCallGasLimitCalculationHelper,
  RelayHubConfiguration,
  RelayInfo,
  RelayTransactionRequest,
  constants,
  defaultEnvironment,
  ether,
  removeHexPrefix
} from '@opengsn/common'
import {
  IERC2771RecipientInstance,
  IForwarderInstance,
  IPenalizerInstance,
  IRelayHubInstance,
  StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { assertRelayAdded, getTemporaryWorkdirs, ServerWorkdirs } from './ServerTestUtils'

import { KeyManager } from '@opengsn/relay/dist/KeyManager'
import { PrefixedHexString } from 'ethereumjs-util'
import { RelayClient } from '@opengsn/provider/dist/RelayClient'
import { registerForwarderForGsn } from '@opengsn/cli/dist/ForwarderUtil'

import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import {
  configureServer,
  ServerConfigParams,
  serverDefaultConfiguration,
  ServerDependencies
} from '@opengsn/relay/dist/ServerConfigParams'
import { TxStoreManager } from '@opengsn/relay/dist/TxStoreManager'
import { defaultGsnConfig, GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'

import { deployHub } from './TestUtils'

import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'
import StakeManagerABI from '@opengsn/common/dist/interfaces/IStakeManager.json'
import PayMasterABI from '@opengsn/common/dist/interfaces/IPaymaster.json'

import { createServerLogger } from '@opengsn/logger/dist/ServerWinstonLogger'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'
import { GasPriceFetcher } from '@opengsn/relay/dist/GasPriceFetcher'

import { ReputationManager } from '@opengsn/relay/dist/ReputationManager'
import { ReputationStoreManager } from '@opengsn/relay/dist/ReputationStoreManager'
import { Web3MethodsBuilder } from '@opengsn/relay/dist/Web3MethodsBuilder'

const Forwarder = artifacts.require('Forwarder')
const Penalizer = artifacts.require('Penalizer')
const StakeManager = artifacts.require('StakeManager')
const TestToken = artifacts.require('TestToken')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)
export const LocalhostOne = 'http://localhost:8090'

export interface PrepareRelayRequestOption {
  to: string
  from: string
  paymaster: string
}

export class ServerTestEnvironment {
  testToken!: TestTokenInstance
  stakeManager!: StakeManagerInstance
  penalizer!: IPenalizerInstance
  relayHub!: IRelayHubInstance
  forwarder!: IForwarderInstance
  paymaster!: TestPaymasterEverythingAcceptedInstance
  recipient!: IERC2771RecipientInstance

  relayOwner!: Address
  gasLess!: Address

  encodedFunction!: PrefixedHexString

  paymasterData!: PrefixedHexString
  clientId!: string

  options?: PrepareRelayRequestOption

  /**
   * Note: do not call methods of contract interactor inside Test Environment. It may affect Profiling Test.
   */
  contractInteractor!: ContractInteractor
  gasLimitCalculator!: RelayCallGasLimitCalculationHelper
  web3MethodsBuilder!: Web3MethodsBuilder

  relayClient!: RelayClient
  provider: HttpProvider
  ethersProvider: JsonRpcProvider
  web3: Web3
  relayServer!: RelayServer

  constructor (provider: HttpProvider, accounts: Address[]) {
    this.provider = provider
    this.ethersProvider = new StaticJsonRpcProvider(this.provider.host)
    this.web3 = new Web3(this.provider)
    this.relayOwner = accounts[4]
  }

  /**
   * @param clientConfig
   * @param relayHubConfig
   * @param contractFactory - added for Profiling test, as it requires Test Environment to be using
   * different provider from the contract interactor itself.
   * @param HubContract
   * @param relayRegistrationMaxAge
   */
  async init (clientConfig: Partial<GSNConfig> = {}, relayHubConfig: Partial<RelayHubConfiguration> = {}, contractFactory?: (deployment: GSNContractsDeployment) => Promise<ContractInteractor>, HubContract?: any, relayRegistrationMaxAge = constants.yearInSec): Promise<void> {
    this.testToken = await TestToken.new()
    this.stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    this.penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    // @ts-ignore - IRelayHub and RelayHub types are similar enough for tests to work
    this.relayHub = await deployHub(this.stakeManager.address, this.penalizer.address, constants.ZERO_ADDRESS, this.testToken.address, 1e18.toString(), relayHubConfig, defaultEnvironment, HubContract, relayRegistrationMaxAge)
    this.forwarder = await Forwarder.new()
    this.recipient = await TestRecipient.new(this.forwarder.address)
    this.paymaster = await TestPaymasterEverythingAccepted.new()
    await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, this.forwarder)

    await this.paymaster.setTrustedForwarder(this.forwarder.address)
    await this.paymaster.setRelayHub(this.relayHub.address)
    await this.paymaster.deposit({ value: this.web3.utils.toWei('1', 'ether') })

    this.encodedFunction = this.recipient.contract.methods.emitMessage('hello world').encodeABI()
    const shared: Partial<GSNConfig> = {
      loggerConfiguration: { logLevel: 'error' },
      paymasterAddress: this.paymaster.address
    }
    const logger = createServerLogger('error', '', '')
    if (contractFactory == null) {
      const maxPageSize = Number.MAX_SAFE_INTEGER
      this.contractInteractor = new ContractInteractor({
        environment: defaultEnvironment,
        provider: this.ethersProvider,
        logger,
        maxPageSize,
        deployment: {
          managerStakeTokenAddress: this.testToken.address,
          paymasterAddress: this.paymaster.address
        }
      })
      await this.contractInteractor.init()
    } else {
      this.contractInteractor = await contractFactory({
        paymasterAddress: this.paymaster.address,
        managerStakeTokenAddress: this.testToken.address
      })
    }
    this.gasLimitCalculator = new RelayCallGasLimitCalculationHelper(logger, this.contractInteractor, serverDefaultConfiguration.calldataEstimationSlackFactor, serverDefaultConfiguration.maxAcceptanceBudget)
    const resolvedDeployment = this.contractInteractor.getDeployment()
    this.web3MethodsBuilder = new Web3MethodsBuilder(web3, resolvedDeployment)

    const mergedConfig = Object.assign({}, shared, clientConfig)
    this.relayClient = new RelayClient({
      provider: this.ethersProvider,
      config: mergedConfig
    })
    await this.relayClient.init()
    this.gasLess = this.relayClient.newAccount().address
  }

  async newServerInstance (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs, unstakeDelay = constants.weekInSec): Promise<void> {
    this.newServerInstanceNoFunding(config, serverWorkdirs)
    await this.fundServer()
    await this.relayServer.init()
    // initialize server - gas price, stake, owner, etc, whatever
    let latestBlock = await this.ethersProvider.getBlock('latest')

    await this.relayServer._worker(latestBlock)
    latestBlock = await this.ethersProvider.getBlock('latest')
    await this.stakeAndAuthorizeHub(ether('1'), unstakeDelay)
    // This run should call 'registerRelayServer' and 'addWorkers'
    const receipts = await this.relayServer._worker(latestBlock)
    await assertRelayAdded(receipts, this.relayServer) // sanity check
    latestBlock = await this.ethersProvider.getBlock('latest')
    await this.relayServer._worker(latestBlock)
  }

  _createKeyManager (workdir?: string): KeyManager {
    if (workdir != null) {
      return new KeyManager(1, workdir)
    } else {
      return new KeyManager(1, undefined, crypto.randomBytes(32).toString())
    }
  }

  async fundServer (): Promise<void> {
    await web3.eth.sendTransaction({
      to: this.relayServer.managerAddress,
      from: this.relayOwner,
      value: web3.utils.toWei('2', 'ether')
    })
  }

  async stakeAndAuthorizeHub (stake: BN, unstakeDelay: number): Promise<void> {
    await this.testToken.mint(stake, { from: this.relayOwner })
    await this.testToken.approve(this.stakeManager.address, stake, { from: this.relayOwner })
    // Now owner can do its operations
    await this.stakeManager.stakeForRelayManager(this.testToken.address, this.relayServer.managerAddress, unstakeDelay, stake, {
      from: this.relayOwner
    })
    await this.stakeManager.authorizeHubByOwner(this.relayServer.managerAddress, this.relayHub.address, {
      from: this.relayOwner
    })
  }

  newServerInstanceNoFunding (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs): void {
    const shared: Partial<ServerConfigParams> = {
      runPaymasterReputations: false,
      ownerAddress: this.relayOwner,
      relayHubAddress: this.relayHub.address,
      checkInterval: 100,
      workdir: serverWorkdirs?.workdir
    }
    const logger = createServerLogger('error', '', '')
    const managerKeyManager = this._createKeyManager(serverWorkdirs?.managerWorkdir)
    const workersKeyManager = this._createKeyManager(serverWorkdirs?.workersWorkdir)
    const txStoreManager = new TxStoreManager({
      workdir: serverWorkdirs?.workdir ?? getTemporaryWorkdirs().workdir,
      autoCompactionInterval: serverDefaultConfiguration.dbAutoCompactionInterval
    }, logger)
    const gasPriceFetcher = new GasPriceFetcher('', '', this.contractInteractor, logger)
    let reputationManager
    if (config.runPaymasterReputations != null && config.runPaymasterReputations) {
      const reputationStoreManager = new ReputationStoreManager({ inMemory: true }, logger)
      reputationManager = new ReputationManager(reputationStoreManager, logger, {})
    }

    const serverDependencies: ServerDependencies = {
      contractInteractor: this.contractInteractor,
      gasLimitCalculator: this.gasLimitCalculator,
      web3MethodsBuilder: this.web3MethodsBuilder,
      gasPriceFetcher,
      logger,
      txStoreManager,
      managerKeyManager,
      workersKeyManager,
      reputationManager
    }
    const mergedConfig: Partial<ServerConfigParams> = Object.assign({}, shared, config)
    const transactionManager = new TransactionManager(serverDependencies, configureServer(mergedConfig))
    this.relayServer = new RelayServer(mergedConfig, transactionManager, serverDependencies)
    this.relayServer.on('error', (e) => {
      console.log('newServer event', e.message)
    })
  }

  async createRelayHttpRequest (
    overrideDetails: Partial<GsnTransactionDetails> = {},
    overrideDeployment: GSNContractsDeployment = {}
  ): Promise<RelayTransactionRequest> {
    const pingResponse: PingResponse = {
      maxAcceptanceBudget: '10000000',
      maxMaxFeePerGas: '',
      minMaxFeePerGas: '',
      minMaxPriorityFeePerGas: '',
      ownerAddress: '',
      ready: false,
      relayManagerAddress: '',
      version: '',
      relayHubAddress: this.relayHub.address,
      relayWorkerAddress: this.relayServer.workerAddress
    }
    const eventInfo: RegistrarRelayInfo = {
      firstSeenBlockNumber: toBN(0),
      lastSeenBlockNumber: toBN(0),
      firstSeenTimestamp: toBN(0),
      lastSeenTimestamp: toBN(0),
      relayManager: '',
      relayUrl: ''
    }
    const relayInfo: RelayInfo = {
      pingResponse,
      relayInfo: eventInfo
    }
    const gsnTransactionDetails: GsnTransactionDetails = {
      from: this.gasLess,
      to: this.recipient.address,
      data: this.encodedFunction,
      gas: toHex(1000000),
      maxFeePerGas: toHex(20000000000),
      maxPriorityFeePerGas: toHex(20000000000)
    }

    const mergedDeployment = Object.assign({}, this.relayClient.dependencies.contractInteractor.getDeployment(), overrideDeployment)
    const sandbox = sinon.createSandbox()
    try {
      sandbox.stub(this.relayClient.dependencies.contractInteractor, 'getDeployment').returns(mergedDeployment)
      const mergedTransactionDetail = Object.assign({}, gsnTransactionDetails, overrideDetails)
      // do not 'return await' here as it will defer executing the 'finally' block and enable re-stubbing
      // (will crash on 'let x = [createRelayHttpRequest(), createRelayHttpRequest()]')
      // eslint-disable-next-line @typescript-eslint/return-await,@typescript-eslint/promise-function-async
      return this.relayClient._prepareRelayRequest(mergedTransactionDetail).then(relayRequest => {
        return this.relayClient.fillRelayInfo(relayRequest, relayInfo).then(async () => {
          // eslint-disable-next-line @typescript-eslint/return-await,@typescript-eslint/promise-function-async
          return this.relayClient._prepareRelayHttpRequest(relayRequest, relayInfo)
        })
      })
    } finally {
      sandbox.restore()
    }
  }

  async relayTransaction (assertRelayed = true, overrideDetails: Partial<GsnTransactionDetails> = {}): Promise<{
    signedTx: PrefixedHexString
    txHash: PrefixedHexString
  }> {
    const req = await this.createRelayHttpRequest(overrideDetails)
    const { signedTx } = await this.relayServer.createRelayTransaction(req)
    const txHash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(removeHexPrefix(signedTx), 'hex')))

    if (assertRelayed) {
      await this.assertTransactionRelayed(txHash)
    }
    return {
      txHash,
      signedTx
    }
  }

  async clearServerStorage (): Promise<void> {
    await this.relayServer.transactionManager.txStoreManager.clearAll()
    assert.deepEqual([], await this.relayServer.transactionManager.txStoreManager.getAll())
  }

  async assertTransactionRelayed (txHash: string, overrideDetails?: Partial<GsnTransactionDetails>): Promise<void> {
    const receipt = await web3.eth.getTransactionReceipt(txHash)
    if (receipt == null) {
      throw new Error('Transaction Receipt not found')
    }
    const sender = overrideDetails?.from ?? this.gasLess
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(this.relayServer.registrationManager._parseEvent)
    const event1 = decodedLogs.find((e: { name: string }) => e.name === 'SampleRecipientEmitted')
    assert.exists(event1, 'SampleRecipientEmitted not found, maybe transaction was not relayed successfully')
    assert.equal(event1.args.message, 'hello world')
    const event2 = decodedLogs.find((e: { name: string }) => e.name === 'TransactionRelayed')
    assert.exists(event2, 'TransactionRelayed not found, maybe transaction was not relayed successfully')
    assert.equal(event2.name, 'TransactionRelayed')
    assert.equal(event2.args.relayWorker.toLowerCase(), this.relayServer.workerAddress.toLowerCase())
    assert.equal(event2.args.from.toLowerCase(), sender.toLowerCase())
    assert.equal(event2.args.to.toLowerCase(), this.recipient.address.toLowerCase())
    assert.equal(event2.args.paymaster.toLowerCase(), this.paymaster.address.toLowerCase())
  }
}
