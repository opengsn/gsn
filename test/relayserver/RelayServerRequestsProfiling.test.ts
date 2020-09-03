import { RelayServer } from '../../src/relayserver/RelayServer'
import {
  bringUpNewRelay,
  LocalhostOne, NewRelayParams,
  PrepareRelayRequestOption,
  relayTransaction,
  RelayTransactionParams
} from './ServerTestUtils'
import { deployHub, evmMine } from '../TestUtils'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { ServerDependencies } from '../../src/relayserver/ServerConfigParams'
import ContractInteractor from '../../src/relayclient/ContractInteractor'
import { HttpProvider } from 'web3-core'
import { ProfilingProvider } from '../../src/common/dev/ProfilingProvider'
import { Address } from '../../src/relayclient/types/Aliases'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { GsnRequestType } from '../../src/common/EIP712/TypedRequestData'

const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestRecipient = artifacts.require('TestRecipient')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const Forwarder = artifacts.require('Forwarder')

contract('RelayServerRequestsProfiling', function ([relayOwner]) {
  const refreshStateTimeoutBlocks = 2
  const callsPerStateRefresh = 11
  const callsPerBlock = 0
  const callsPerTransaction = 26

  let provider: ProfilingProvider
  let relayServer: RelayServer
  let relayHubAddress: Address

  before(async function () {
    const stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    const rhub = await deployHub(stakeManager.address, penalizer.address)
    relayHubAddress = rhub.address
    provider = new ProfilingProvider(web3.currentProvider as HttpProvider)
    const newRelayParams: NewRelayParams = {
      relayHubAddress,
      relayOwner,
      url: LocalhostOne,
      web3,
      stakeManager
    }
    const partialConfig: Partial<GSNConfig> = {
      relayHubAddress: rhub.address
    }
    const contractInteractor = new ContractInteractor(provider, configureGSN(partialConfig))
    await contractInteractor.init()
    const partialDependencies: Partial<ServerDependencies> = {
      contractInteractor
    }
    relayServer = await bringUpNewRelay(newRelayParams, partialConfig, partialDependencies, { refreshStateTimeoutBlocks })
    const latestBlock = await web3.eth.getBlock('latest')
    await relayServer._worker(latestBlock.number)
  })

  beforeEach(async function () {
    await evmMine()
    provider.reset()
  })

  it('should make X requests per block callback when state must be refreshed', async function () {
    const latestBlock = await web3.eth.getBlock('latest')
    const blockNumber = relayServer._shouldRefreshState(latestBlock.number) ? latestBlock.number : latestBlock.number + 1
    assert.isTrue(relayServer._shouldRefreshState(blockNumber))
    const receipts = await relayServer._worker(latestBlock.number)
    assert.equal(receipts.length, 0)
    provider.log()
    assert.equal(provider.requestsCount, callsPerStateRefresh)
  })

  it('should make X requests per block callback when nothing needs to be done', async function () {
    const latestBlock = await web3.eth.getBlock('latest')
    const blockNumber = relayServer._shouldRefreshState(latestBlock.number) ? latestBlock.number + 1 : latestBlock.number
    assert.isFalse(relayServer._shouldRefreshState(blockNumber))
    const receipts = await relayServer._worker(latestBlock.number)
    assert.equal(receipts.length, 0)
    provider.log()
    assert.equal(provider.requestsCount, callsPerBlock)
  })

  describe('relay transaction', function () {
    let gasLess: Address
    let relayTransactionParams: RelayTransactionParams
    let options: PrepareRelayRequestOption

    // TODO: this is a pure copy-paste from Transaction manager test. Create helper code for this!
    before(async function () {
      gasLess = await web3.eth.personal.newAccount('password')
      const forwarder = await Forwarder.new()
      // register hub's RelayRequest with forwarder, if not already done.
      await forwarder.registerRequestType(
        GsnRequestType.typeName,
        GsnRequestType.typeSuffix
      )

      const forwarderAddress = forwarder.address

      const paymaster = await TestPaymasterEverythingAccepted.new({ gas: 1e7 })

      const paymasterAddress = paymaster.address

      await paymaster.setRelayHub(relayHubAddress)
      await paymaster.setTrustedForwarder(forwarderAddress)
      await paymaster.deposit({ value: web3.utils.toWei('1', 'ether') })

      const sr = await TestRecipient.new(forwarderAddress)
      const encodedFunction = sr.contract.methods.emitMessage('hello world').encodeABI()
      const recipientAddress = sr.address
      const relayClient = new RelayClient((web3.currentProvider as HttpProvider), configureGSN({}))
      relayTransactionParams = {
        gasLess,
        recipientAddress,
        relayHubAddress,
        encodedFunction,
        paymasterData: '',
        clientId: '',
        forwarderAddress,
        paymasterAddress,
        relayServer,
        web3,
        relayClient
      }
      options = {
        from: gasLess,
        to: sr.address,
        pctRelayFee: 0,
        baseRelayFee: '0',
        paymaster: paymaster.address
      }
      provider.reset()
    })

    it('should make X requests per relay transaction request', async function () {
      await relayTransaction(relayTransactionParams, options)
      provider.log()
      assert.equal(provider.requestsCount, callsPerTransaction)
    })
  })
})
