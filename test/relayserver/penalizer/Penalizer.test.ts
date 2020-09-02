/* global artifacts describe */
import Web3 from 'web3'
import { RelayClient } from '../../../src/relayclient/RelayClient'
import { KeyManager } from '../../../src/relayserver/KeyManager'
import RelayHubABI from '../../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../../src/common/interfaces/IStakeManager.json'
import PayMasterABI from '../../../src/common/interfaces/IPaymaster.json'
import { PrefixedHexString } from 'ethereumjs-tx'
// @ts-ignore
import abiDecoder from 'abi-decoder'
import { deployHub } from '../../TestUtils'
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
import { ether } from '@openzeppelin/test-helpers'
import { PenalizerService } from '../../../src/relayserver/penalizer/PenalizerService'

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

contract('PenalizerService service', function ([relayManager, relayWorker, penalizableRelayManager, penalizableRelayWorker, relayOwner]) {
  let penalizerService: PenalizerService
  const pctRelayFee = 11
  const baseRelayFee = 12
  let relayHub: RelayHubInstance
  let forwarder: ForwarderInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let recipient: TestRecipientInstance
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let ethereumNodeUrl: string
  let _web3: Web3
  let id: string, globalId: string
  let encodedFunction: PrefixedHexString
  let relayClient: RelayClient
  let options: any, options2: any

  async function bringUpNewRelay (relayManager: Address, relayWorker: Address, relayHub: RelayHubInstance, stakeManager: StakeManagerInstance, paymaster: TestPaymasterEverythingAcceptedInstance): Promise<void> {
    await stakeManager.stakeForAddress(relayManager, 1000, {
      from: relayOwner,
      value: ether('1')
    })
    await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
    await paymaster.setTrustedForwarder(forwarder.address)
    await paymaster.setRelayHub(relayHub.address)
    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
  }

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
      await bringUpNewRelay(relayManager, relayWorker, relayHub, stakeManager, paymaster)
      await bringUpNewRelay(penalizableRelayManager, penalizableRelayWorker, relayHub, stakeManager, paymaster)
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
    })

    beforeEach(async function () {

      penalizerService = new PenalizerService(params)
    })
    afterEach(async function () {

    })
    it('should penalize relay for signing two different txs with same nonce when current nonce >= tx nonce', async function () {

    })
    it('should penalize relay for signing two different txs with same nonce when current nonce < tx nonce')
    it('should not try to penalize unregistered relay')
    it('should not try to penalize if given wrong signature with registered relay')
    it('should not try to penalize if tx already mined')
    it('should not try to penalize if tx already mined with different gas price')
  })
})
