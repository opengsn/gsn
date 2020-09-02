/* global artifacts describe */
import { KeyManager } from '../../../src/relayserver/KeyManager'
import RelayHubABI from '../../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../../src/common/interfaces/IStakeManager.json'
import PayMasterABI from '../../../src/common/interfaces/IPaymaster.json'
import { Transaction } from 'ethereumjs-tx'
// @ts-ignore
import abiDecoder from 'abi-decoder'
import { deployHub, revert, snapshot } from '../../TestUtils'
import {
  ForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance
} from '../../../types/truffle-contracts'
import { Address } from '../../../src/relayclient/types/Aliases'
import { GsnRequestType } from '../../../src/common/EIP712/TypedRequestData'
import { ether, send } from '@openzeppelin/test-helpers'
import { PenalizerService } from '../../../src/relayserver/penalizer/PenalizerService'
import { MockTxByNonceService } from '../../../src/relayserver/penalizer/TxByNonceService'
import { ServerDependencies } from '../../../src/relayserver/ServerConfigParams'
import ContractInteractor from '../../../src/relayclient/ContractInteractor'
import { configureGSN } from '../../../src/relayclient/GSNConfigurator'
import { TransactionManager } from '../../../src/relayserver/TransactionManager'
import { TxStoreManager } from '../../../src/relayserver/TxStoreManager'
import crypto from 'crypto'
import { web3TransactionToEthUtilTransaction } from '../../../src/common/Utils'
import { HttpProvider } from 'web3-core'
import Web3 from 'web3'

const RelayHub = artifacts.require('RelayHub')
const TestRecipient = artifacts.require('TestRecipient')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestPaymasterConfigurableMisbehavior = artifacts.require('TestPaymasterConfigurableMisbehavior')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterConfigurableMisbehavior.abi)

contract.only('PenalizerService service',
  function ([penalizableRelayManager, penalizableRelayWorker, relayOwner, other]) {
    let penalizerService: PenalizerService
    const workdir = '/tmp/gsn/test/relayserver/penalizer'
    let relayHub: RelayHubInstance
    let forwarder: ForwarderInstance
    let stakeManager: StakeManagerInstance
    let penalizer: PenalizerInstance
    let recipient: TestRecipientInstance
    let paymaster: TestPaymasterEverythingAcceptedInstance
    let globalId: string
    let _web3: Web3

    async function registerNewRelay (relayManager: Address, relayWorker: Address, relayHub: RelayHubInstance, stakeManager: StakeManagerInstance, paymaster: TestPaymasterEverythingAcceptedInstance): Promise<void> {
      await stakeManager.stakeForAddress(relayManager, 1000, {
        from: relayOwner,
        value: ether('1')
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      await paymaster.setTrustedForwarder(forwarder.address)
      await paymaster.setRelayHub(relayHub.address)
      await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    }

    before(async function () {
      const ethereumNodeUrl = (web3.currentProvider as HttpProvider).host
      _web3 = new Web3(new Web3.providers.HttpProvider(ethereumNodeUrl))
    })

    describe('tryToPenalize', function () {
      before(async function () {
        stakeManager = await StakeManager.new()
        penalizer = await Penalizer.new()
        relayHub = await deployHub(stakeManager.address, penalizer.address)
        forwarder = await Forwarder.new()
        recipient = await TestRecipient.new(forwarder.address)
        // register hub's RelayRequest with forwarder, if not already done.
        await forwarder.registerRequestType(
          GsnRequestType.typeName,
          GsnRequestType.typeSuffix
        )

        paymaster = await TestPaymasterEverythingAccepted.new()
        await registerNewRelay(penalizableRelayManager, penalizableRelayWorker, relayHub, stakeManager, paymaster)
        // @ts-ignore
        Object.keys(StakeManager.events).forEach(function (topic) {
          // @ts-ignore
          RelayHub.network.events[topic] = StakeManager.events[topic]
        })
        // @ts-ignore
        Object.keys(StakeManager.events).forEach(function (topic) {
          // @ts-ignore
          Penalizer.network.events[topic] = StakeManager.events[topic]
        })

        const managerKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
        const workersKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
        const txStoreManager = new TxStoreManager({ workdir })
        const contractInteractor = new ContractInteractor(_web3.currentProvider, configureGSN({ relayHubAddress: relayHub.address }))
        await contractInteractor.init()
        const dependencies: ServerDependencies = {
          txStoreManager,
          managerKeyManager,
          workersKeyManager,
          contractInteractor
        }
        const transactionManager = new TransactionManager(contractInteractor, dependencies)
        const txByNonceService = new MockTxByNonceService(_web3.currentProvider)
        penalizerService = new PenalizerService({
          transactionManager,
          txByNonceService,
          contractInteractor,
          devMode: true
        })
        await penalizerService.init()
      })
      describe('penalizable requests', function () {
        let minedTx: Transaction
        let requestTx: Transaction

        async function getTransactionsWithSameNonce (account: string, to: string): Promise<{ requestTx: Transaction, minedTx: Transaction }> {
          const id = (await snapshot()).result
          let transactionHash = (await send.ether(account, to, ether('0.1'))).transactionHash
          let web3Tx = await _web3.eth.getTransaction(transactionHash)
          const minedTx = web3TransactionToEthUtilTransaction(web3Tx)
          await revert(id)
          transactionHash = (await send.ether(account, to, ether('0.01'))).transactionHash
          web3Tx = await _web3.eth.getTransaction(transactionHash)
          const requestTx = web3TransactionToEthUtilTransaction(web3Tx)
          assert.equal(minedTx.nonce.toString(), requestTx.nonce.toString(), 'nonces not equal')
          return { minedTx, requestTx }
        }

        beforeEach(async function () {
          ({ minedTx, requestTx } = await getTransactionsWithSameNonce(penalizableRelayWorker, other))
          ;(penalizerService.txByNonceService as MockTxByNonceService).setTransactionByNonce(minedTx)
        })
        afterEach(async function () {

        })
        it('should penalize relay for signing two different txs with same nonce when current nonce >= tx nonce', async function () {
          await penalizerService.tryToPenalize({ signedTx: '0x' + requestTx.serialize().toString('hex') })
        })
        it('should penalize relay for signing two different txs with same nonce when current nonce < tx nonce', async function () {
          await penalizerService.tryToPenalize({ signedTx: '0x' + requestTx.serialize().toString('hex') })
        })
      })
      describe('non-penalizable requests', function () {
        it('should not try to penalize unregistered relay')
        it('should not try to penalize if given wrong signature with registered relay')
        it('should not try to penalize if tx already mined')
        it('should not try to penalize if tx already mined with different gas price')
      })
    })
  }
)
