// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import crypto from 'crypto'
import sinon from 'sinon'
import { HttpProvider } from 'web3-core'
import { toHex } from 'web3-utils'
import * as ethUtils from 'ethereumjs-util'
import { Address } from '@opengsn/common/dist/types/Aliases'
import {
  IForwarderInstance,
  IPenalizerInstance,
  IRelayHubInstance,
  IRelayRecipientInstance,
  IStakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { assertRelayAdded, getTemporaryWorkdirs, ServerWorkdirs } from './ServerTestUtils'
import { ContractInteractor } from '@opengsn/common/dist/ContractInteractor'
import { GsnTransactionDetails } from '@opengsn/common/dist/types/GsnTransactionDetails'
import { PingResponse } from '@opengsn/common/dist/PingResponse'
import { KeyManager } from '@opengsn/relay/dist/KeyManager'
import { PrefixedHexString } from 'ethereumjs-util'
import { RelayClient } from '@opengsn/provider/dist/RelayClient'
import { RelayInfo } from '@opengsn/common/dist/types/RelayInfo'
import { RelayRegisteredEventInfo } from '@opengsn/common/dist/types/GSNContractsDataTypes'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { configureServer, ServerConfigParams, serverDefaultConfiguration } from '@opengsn/relay/dist/ServerConfigParams'
import { TxStoreManager } from '@opengsn/relay/dist/TxStoreManager'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { constants } from '@opengsn/common/dist/Constants'
import { deployHub } from './TestUtils'
import { ether, removeHexPrefix } from '@opengsn/common/dist/Utils'
import { RelayTransactionRequest } from '@opengsn/common/dist/types/RelayTransactionRequest'
import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'
import StakeManagerABI from '@opengsn/common/dist/interfaces/IStakeManager.json'
import PayMasterABI from '@opengsn/common/dist/interfaces/IPaymaster.json'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { RelayHubConfiguration } from '@opengsn/common/dist/types/RelayHubConfiguration'
import { createServerLogger } from '@opengsn/relay/dist/ServerWinstonLogger'
import { TransactionManager } from '@opengsn/relay/dist/TransactionManager'
import { GasPriceFetcher } from '@opengsn/relay/dist/GasPriceFetcher'
import { GSNContractsDeployment } from '@opengsn/common/dist/GSNContractsDeployment'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'

const Forwarder = artifacts.require('Forwarder')
const Penalizer = artifacts.require('Penalizer')
const StakeManager = artifacts.require('StakeManager')
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
  pctRelayFee: number
  baseRelayFee: string
}

export class ServerTestEnvironment {
  stakeManager!: IStakeManagerInstance
  penalizer!: IPenalizerInstance
  relayHub!: IRelayHubInstance
  forwarder!: IForwarderInstance
  paymaster!: TestPaymasterEverythingAcceptedInstance
  recipient!: IRelayRecipientInstance

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

  relayClient!: RelayClient
  provider: HttpProvider
  web3: Web3
  relayServer!: RelayServer

  constructor (provider: HttpProvider, accounts: Address[]) {
    this.provider = provider
    this.web3 = new Web3(this.provider)
    this.relayOwner = accounts[4]
  }

  /**
   * @param clientConfig
   * @param relayHubConfig
   * @param contractFactory - added for Profiling test, as it requires Test Environment to be using
   * different provider from the contract interactor itself.
   */
  async init (clientConfig: Partial<GSNConfig> = {}, relayHubConfig: Partial<RelayHubConfiguration> = {}, contractFactory?: (deployment: GSNContractsDeployment) => Promise<ContractInteractor>): Promise<void> {
    this.stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
    this.penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    // @ts-ignore - IRelayHub and RelayHub types are similar enough for tests to work
    this.relayHub = await deployHub(this.stakeManager.address, this.penalizer.address, relayHubConfig)
    this.forwarder = await Forwarder.new()
    this.recipient = await TestRecipient.new(this.forwarder.address)
    this.paymaster = await TestPaymasterEverythingAccepted.new()
    await registerForwarderForGsn(this.forwarder)

    await this.paymaster.setTrustedForwarder(this.forwarder.address)
    await this.paymaster.setRelayHub(this.relayHub.address)
    await this.paymaster.deposit({ value: this.web3.utils.toWei('1', 'ether') })

    this.encodedFunction = this.recipient.contract.methods.emitMessage('hello world').encodeABI()
    const shared: Partial<GSNConfig> = {
      loggerConfiguration: { logLevel: 'error' },
      paymasterAddress: this.paymaster.address
    }
    if (contractFactory == null) {
      const logger = createServerLogger('error', '', '')
      const maxPageSize = Number.MAX_SAFE_INTEGER
      this.contractInteractor = new ContractInteractor({
        provider: this.provider,
        logger,
        maxPageSize,
        deployment: { paymasterAddress: this.paymaster.address }
      })
      await this.contractInteractor.init()
    } else {
      this.contractInteractor = await contractFactory(shared)
    }
    const mergedConfig = Object.assign({}, shared, clientConfig)
    this.relayClient = new RelayClient({
      provider: this.provider,
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
    let latestBlock = await this.web3.eth.getBlock('latest')

    await this.relayServer._worker(latestBlock.number)
    latestBlock = await this.web3.eth.getBlock('latest')
    await this.stakeAndAuthorizeHub(ether('1'), unstakeDelay)

    // This run should call 'registerRelayServer' and 'addWorkers'
    const receipts = await this.relayServer._worker(latestBlock.number)
    await assertRelayAdded(receipts, this.relayServer) // sanity check
    await this.relayServer._worker(latestBlock.number + 1)
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
    // Now owner can do its operations
    await this.stakeManager.stakeForRelayManager(this.relayServer.managerAddress, unstakeDelay, {
      from: this.relayOwner,
      value: stake
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
      checkInterval: 100
    }
    const logger = createServerLogger('error', '', '')
    const managerKeyManager = this._createKeyManager(serverWorkdirs?.managerWorkdir)
    const workersKeyManager = this._createKeyManager(serverWorkdirs?.workersWorkdir)
    const txStoreManager = new TxStoreManager({ workdir: serverWorkdirs?.workdir ?? getTemporaryWorkdirs().workdir, autoCompactionInterval: serverDefaultConfiguration.dbAutoCompactionInterval }, logger)
    const gasPriceFetcher = new GasPriceFetcher('', '', this.contractInteractor, logger)
    const serverDependencies = {
      contractInteractor: this.contractInteractor,
      gasPriceFetcher,
      logger,
      txStoreManager,
      managerKeyManager,
      workersKeyManager
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
    const pingResponse = {
      relayHubAddress: this.relayHub.address,
      relayWorkerAddress: this.relayServer.workerAddress
    }
    const eventInfo: RelayRegisteredEventInfo = {
      baseRelayFee: this.relayServer.config.baseRelayFee,
      pctRelayFee: this.relayServer.config.pctRelayFee.toString(),
      relayManager: '',
      relayUrl: ''
    }
    const relayInfo: RelayInfo = {
      pingResponse: pingResponse as PingResponse,
      relayInfo: eventInfo
    }
    const gsnTransactionDetails: GsnTransactionDetails = {
      from: this.gasLess,
      to: this.recipient.address,
      data: this.encodedFunction,
      gas: toHex(1000000),
      gasPrice: toHex(20000000000)
    }

    const mergedDeployment = Object.assign({}, this.relayClient.dependencies.contractInteractor.getDeployment(), overrideDeployment)
    const sandbox = sinon.createSandbox()
    try {
      sandbox.stub(this.relayClient.dependencies.contractInteractor, 'getDeployment').returns(mergedDeployment)
      const mergedTransactionDetail = Object.assign({}, gsnTransactionDetails, overrideDetails)
      // do not 'return await' here as it will defer executing the 'finally' block and enable re-stubbing
      // (will crash on 'let x = [createRelayHttpRequest(), createRelayHttpRequest()]')
      // eslint-disable-next-line @typescript-eslint/return-await
      return this.relayClient._prepareRelayHttpRequest(relayInfo, mergedTransactionDetail)
    } finally {
      sandbox.restore()
    }
  }

  async relayTransaction (assertRelayed = true, overrideDetails: Partial<GsnTransactionDetails> = {}): Promise<{
    signedTx: PrefixedHexString
    txHash: PrefixedHexString
  }> {
    const req = await this.createRelayHttpRequest(overrideDetails)
    const signedTx = await this.relayServer.createRelayTransaction(req)
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

  async assertTransactionRelayed (txHash: string, overrideDetails: Partial<GsnTransactionDetails> = {}): Promise<void> {
    const receipt = await web3.eth.getTransactionReceipt(txHash)
    if (receipt == null) {
      throw new Error('Transaction Receipt not found')
    }
    const sender = overrideDetails.from ?? this.gasLess
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
