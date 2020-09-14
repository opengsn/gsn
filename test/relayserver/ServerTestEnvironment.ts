// @ts-ignore
import abiDecoder from 'abi-decoder'
import Web3 from 'web3'
import crypto from 'crypto'
import { HttpProvider } from 'web3-core'
import { toHex } from 'web3-utils'
import * as ethUtils from 'ethereumjs-util'
import { Address } from '../../src/relayclient/types/Aliases'
import {
  IForwarderInstance,
  IRelayHubInstance, IRelayRecipientInstance,
  IStakeManagerInstance, TestPaymasterEverythingAcceptedInstance
} from '../../types/truffle-contracts'
import {
  assertRelayAdded,
  getTemporaryWorkdirs,
  ServerWorkdirs
} from './ServerTestUtils'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'
import PingResponse from '../../src/common/PingResponse'
import { KeyManager } from '../../src/relayserver/KeyManager'
import { PrefixedHexString } from 'ethereumjs-tx'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import { RelayRegisteredEventInfo } from '../../src/relayclient/types/RelayRegisteredEventInfo'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { ServerConfigParams } from '../../src/relayserver/ServerConfigParams'
import { TxStoreManager } from '../../src/relayserver/TxStoreManager'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { constants } from '../../src/common/Constants'
import { deployHub } from '../TestUtils'
import { ether, removeHexPrefix } from '../../src/common/Utils'
import { RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../src/common/interfaces/IStakeManager.json'
import PayMasterABI from '../../src/common/interfaces/IPaymaster.json'
import { registerForwarderForGsn } from '../../src/common/EIP712/ForwarderUtil'
import { RelayHubConfiguration } from '../../src/relayclient/types/RelayHubConfiguration'

const Forwarder = artifacts.require('Forwarder')
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
   * @param contractFactory - added for Profiling test, as it requires Test Environment to be using
   * different provider from the contract interactor itself.
   */
  async init (clientConfig: Partial<GSNConfig> = {}, relayHubConfig: Partial<RelayHubConfiguration> = {}, contractFactory?: (clientConfig: Partial<GSNConfig>) => Promise<ContractInteractor>): Promise<void> {
    this.stakeManager = await StakeManager.new()
    this.relayHub = await deployHub(this.stakeManager.address, undefined, relayHubConfig)
    this.forwarder = await Forwarder.new()
    this.recipient = await TestRecipient.new(this.forwarder.address)
    this.paymaster = await TestPaymasterEverythingAccepted.new()
    await registerForwarderForGsn(this.forwarder)

    await this.paymaster.setTrustedForwarder(this.forwarder.address)
    await this.paymaster.setRelayHub(this.relayHub.address)
    await this.paymaster.deposit({ value: this.web3.utils.toWei('1', 'ether') })

    this.encodedFunction = this.recipient.contract.methods.emitMessage('hello world').encodeABI()
    this.gasLess = await this.web3.eth.personal.newAccount('password')
    const shared: Partial<GSNConfig> = {
      relayHubAddress: this.relayHub.address
    }
    if (contractFactory == null) {
      this.contractInteractor = new ContractInteractor(this.provider, configureGSN(shared))
      await this.contractInteractor.init()
    } else {
      this.contractInteractor = await contractFactory(shared)
    }
    const mergedConfig = Object.assign({}, shared, clientConfig)
    this.relayClient = new RelayClient(this.provider, configureGSN(mergedConfig))
  }

  async newServerInstance (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs): Promise<void> {
    await this.newServerInstanceNoInit(config, serverWorkdirs)
    await this.relayServer.init()
    // initialize server - gas price, stake, owner, etc, whatever
    const latestBlock = await this.web3.eth.getBlock('latest')
    const receipts = await this.relayServer._worker(latestBlock.number)
    assertRelayAdded(receipts, this.relayServer) // sanity check
  }

  _createKeyManager (workdir?: string): KeyManager {
    if (workdir != null) {
      return new KeyManager(1, workdir)
    } else {
      return new KeyManager(1, undefined, crypto.randomBytes(32).toString())
    }
  }

  async newServerInstanceNoInit (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs, unstakeDelay = constants.weekInSec): Promise<void> {
    this.newServerInstanceNoFunding(config, serverWorkdirs)
    await web3.eth.sendTransaction({
      to: this.relayServer.managerAddress,
      from: this.relayOwner,
      value: web3.utils.toWei('2', 'ether')
    })

    await this.stakeManager.stakeForAddress(this.relayServer.managerAddress, unstakeDelay, {
      from: this.relayOwner,
      value: ether('1')
    })
    await this.stakeManager.authorizeHubByOwner(this.relayServer.managerAddress, this.relayHub.address, {
      from: this.relayOwner
    })
  }

  newServerInstanceNoFunding (config: Partial<ServerConfigParams> = {}, serverWorkdirs?: ServerWorkdirs): void {
    const managerKeyManager = this._createKeyManager(serverWorkdirs?.managerWorkdir)
    const workersKeyManager = this._createKeyManager(serverWorkdirs?.workersWorkdir)
    const txStoreManager = new TxStoreManager({ workdir: serverWorkdirs?.workdir ?? getTemporaryWorkdirs().workdir })
    const serverDependencies = {
      contractInteractor: this.contractInteractor,
      txStoreManager,
      managerKeyManager,
      workersKeyManager
    }
    const shared: Partial<ServerConfigParams> = {
      relayHubAddress: this.relayHub.address,
      devMode: true
    }
    const mergedConfig: Partial<ServerConfigParams> = Object.assign({}, shared, config)
    this.relayServer = new RelayServer(mergedConfig, serverDependencies)
    this.relayServer.on('error', (e) => {
      console.log('newServer event', e.message)
    })
  }

  async createRelayHttpRequest (overrideDetails: Partial<GsnTransactionDetails> = {}): Promise<RelayTransactionRequest> {
    const pingResponse = {
      RelayHubAddress: this.relayHub.address,
      RelayServerAddress: this.relayServer.workerAddress
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
      paymaster: this.paymaster.address,
      forwarder: this.forwarder.address,
      gas: toHex(1000000),
      gasPrice: toHex(20000000000)
    }

    return await this.relayClient._prepareRelayHttpRequest(relayInfo, Object.assign({}, gsnTransactionDetails, overrideDetails))
  }

  async relayTransaction (assertRelayed = true, overrideDetails: Partial<GsnTransactionDetails> = {}): Promise<PrefixedHexString> {
    const req = await this.createRelayHttpRequest(overrideDetails)
    const signedTx = await this.relayServer.createRelayTransaction(req)
    const txHash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(removeHexPrefix(signedTx), 'hex')))

    if (assertRelayed) {
      await this.assertTransactionRelayed(txHash)
    }
    return signedTx
  }

  async clearServerStorage (): Promise<void> {
    await this.relayServer.transactionManager.txStoreManager.clearAll()
    assert.deepEqual([], await this.relayServer.transactionManager.txStoreManager.getAll())
  }

  async assertTransactionRelayed (txHash: string): Promise<void> {
    const receipt = await web3.eth.getTransactionReceipt(txHash)
    if (receipt == null) {
      throw new Error('Transaction Receipt not found')
    }
    const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(this.relayServer.registrationManager._parseEvent)
    const event1 = decodedLogs.find((e: { name: string }) => e.name === 'SampleRecipientEmitted')
    assert.exists(event1, 'SampleRecipientEmitted not found, maybe transaction was not relayed successfully')
    assert.equal(event1.args.message, 'hello world')
    const event2 = decodedLogs.find((e: { name: string }) => e.name === 'TransactionRelayed')
    assert.exists(event2, 'TransactionRelayed not found, maybe transaction was not relayed successfully')
    assert.equal(event2.name, 'TransactionRelayed')
    assert.equal(event2.args.relayWorker.toLowerCase(), this.relayServer.workerAddress.toLowerCase())
    assert.equal(event2.args.from.toLowerCase(), this.gasLess.toLowerCase())
    assert.equal(event2.args.to.toLowerCase(), this.recipient.address.toLowerCase())
    assert.equal(event2.args.paymaster.toLowerCase(), this.paymaster.address.toLowerCase())
  }
}
