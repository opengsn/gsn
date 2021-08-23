import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import BN from 'bn.js'
import chai from 'chai'

import { deployHub, evmMine, evmMineMany } from './TestUtils'

import chaiAsPromised from 'chai-as-promised'
import { defaultEnvironment, getEip712Signature } from '@opengsn/common/dist'
import {
  ForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance, TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { TypedRequestData } from '@opengsn/common/dist/EIP712/TypedRequestData'

const { assert } = chai.use(chaiAsPromised)

const StakeManager = artifacts.require('StakeManager')
const Forwarder = artifacts.require('Forwarder')
const Penalizer = artifacts.require('Penalizer')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestRecipient = artifacts.require('TestRecipient')

contract('RelayHub Configuration',
  function ([relayHubDeployer, relayOwner, relayManager, relayWorker, senderAddress, other, dest, incorrectOwner]) { // eslint-disable-line no-unused-vars
    const message = 'Configuration'
    const unstakeDelay = 1000
    const chainId = defaultEnvironment.chainId
    const baseRelayFee = new BN('300')
    const pctRelayFee = new BN('10')
    const gasPrice = new BN(1e9)
    const gasLimit = new BN('1000000')
    const externalGasLimit = 5e6.toString()
    const paymasterData = '0x'
    const apporovalData = '0x'
    const clientId = '1'
    const senderNonce = new BN('0')
    const maxAcceptanceBudget = 10e6
    const blocksForward = 10

    let relayHub: RelayHubInstance
    let stakeManager: StakeManagerInstance
    let penalizer: PenalizerInstance
    let recipient: TestRecipientInstance
    let paymaster: TestPaymasterEverythingAcceptedInstance
    let forwarderInstance: ForwarderInstance
    let encodedFunction
    let signature: string
    let relayRequest: RelayRequest
    let forwarder: string
    let relayHubOwner: string

    beforeEach(async function prepareForHub () {
      forwarderInstance = await Forwarder.new()
      forwarder = forwarderInstance.address
      recipient = await TestRecipient.new(forwarder)
      paymaster = await TestPaymasterEverythingAccepted.new()
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay)
      penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay,
        defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      relayHub = await deployHub(stakeManager.address, penalizer.address)
      await paymaster.setTrustedForwarder(forwarder)
      await paymaster.setRelayHub(relayHub.address)
      // Register hub's RelayRequest with forwarder, if not already done.
      await registerForwarderForGsn(forwarderInstance)

      await relayHub.depositFor(paymaster.address, {
        value: ether('1'),
        from: other
      })

      await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
      await stakeManager.stakeForRelayManager(relayManager, unstakeDelay, {
        value: ether('2'),
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
      await relayHub.registerRelayServer(0, pctRelayFee, '', { from: relayManager })
      encodedFunction = recipient.contract.methods.emitMessage(message).encodeABI()
      relayRequest = {
        request: {
          to: recipient.address,
          data: encodedFunction,
          from: senderAddress,
          nonce: senderNonce.toString(),
          value: '0',
          gas: gasLimit.toString(),
          validUntil: '0'
        },
        relayData: {
          baseRelayFee: baseRelayFee.toString(),
          pctRelayFee: pctRelayFee.toString(),
          gasPrice: gasPrice.toString(),
          relayWorker,
          forwarder,
          paymaster: paymaster.address,
          paymasterData,
          clientId
        }

      }
      const dataToSign = new TypedRequestData(
        chainId,
        forwarder,
        relayRequest
      )
      signature = await getEip712Signature(
        web3,
        dataToSign
      )

      relayHubOwner = await relayHub.owner()
      assert.equal(relayHubDeployer, relayHubOwner)
    })

    describe('#deprecateHub', function () {
      it('should let owner set hub deprecation block', async function () {
        const fromBlock = 0xef.toString()
        const res = await relayHub.deprecateHub(fromBlock, { from: relayHubOwner })
        expectEvent(
          res,
          'HubDeprecated', { fromBlock: fromBlock })
        const deprecationBlockFromHub = (await relayHub.deprecationBlock()).toString()
        assert.equal(fromBlock, deprecationBlockFromHub)
      })

      it('should not let non owners set hub deprecation block', async function () {
        await expectRevert(
          relayHub.deprecateHub(1, { from: incorrectOwner }),
          'caller is not the owner')
      })

      it('should let owner re-set deprecation only before it\'s due block', async function () {
        // Setting deprecation block
        let fromBlock = (parseInt((await web3.eth.getBlockNumber()).toString()) + blocksForward).toString()
        let res = await relayHub.deprecateHub(fromBlock, { from: relayHubOwner })
        expectEvent(
          res,
          'HubDeprecated', { fromBlock: fromBlock })
        await evmMine()

        // Resetting deprecation block before it's due
        fromBlock = (parseInt((await web3.eth.getBlockNumber()).toString()) + blocksForward).toString()
        res = await relayHub.deprecateHub(fromBlock, { from: relayHubOwner })
        expectEvent(
          res,
          'HubDeprecated', { fromBlock: fromBlock })

        // Mining till deprecation
        await evmMineMany(blocksForward)

        // Resetting deprecation block after it's due
        await expectRevert(
          relayHub.deprecateHub(fromBlock, { from: relayHubOwner }),
          'Already deprecated')
      })
    })

    describe('#isDeprecated', function () {
      it('should return true only after deprecation block set and passed', async function () {
        // Before deprecation block set
        let isDeprecated = await relayHub.isDeprecated()
        assert.isFalse(isDeprecated)
        let deprecationBlock = (await relayHub.deprecationBlock())
        const maxUint256 = 'f'.repeat(64)
        assert.equal(deprecationBlock.toString(16), maxUint256)

        // After deprecation block set but not yet passed
        const fromBlock = parseInt((await web3.eth.getBlockNumber()).toString()) + blocksForward
        await relayHub.deprecateHub(fromBlock)
        isDeprecated = await relayHub.isDeprecated()
        assert.isFalse(isDeprecated)
        deprecationBlock = (await relayHub.deprecationBlock())
        assert.equal(deprecationBlock.toNumber(), fromBlock)

        // After deprecation block set and passed
        await evmMineMany(blocksForward)
        isDeprecated = await relayHub.isDeprecated()
        assert.isTrue(isDeprecated)
      })
    })

    describe('#relayCall', function () {
      it('should revert if deprecationBlock set and passed', async function () {
        const block = parseInt((await web3.eth.getBlockNumber()).toString()) + blocksForward
        await relayHub.deprecateHub(block)
        await evmMineMany(blocksForward)

        await expectRevert(
          relayHub.relayCall(maxAcceptanceBudget, relayRequest, signature, apporovalData, externalGasLimit, {
            from: relayWorker,
            gasPrice,
            gas: externalGasLimit
          }),
          'hub deprecated')
      })

      it('should not revert before deprecationBlock set', async function () {
        const res = await relayHub.relayCall(maxAcceptanceBudget, relayRequest, signature, apporovalData, externalGasLimit, {
          from: relayWorker,
          gasPrice,
          gas: externalGasLimit
        })
        expectEvent(res, 'TransactionRelayed', { status: '0' })
      })

      it('should not revert before deprecationBlock passed', async function () {
        const block = parseInt((await web3.eth.getBlockNumber()).toString()) + blocksForward
        await relayHub.deprecateHub(block)
        await evmMineMany(blocksForward - 3)
        const res = await relayHub.relayCall(maxAcceptanceBudget, relayRequest, signature, apporovalData, externalGasLimit, {
          from: relayWorker,
          gasPrice,
          gas: externalGasLimit
        })
        expectEvent(res, 'TransactionRelayed', { status: '0' })
      })
    })

    describe('RelayHubConfig', function () {
      describe('#setConfiguration', function () {
        it('should not let non owner change configuration', async function () {
          const config = {
            ...defaultEnvironment.relayHubConfiguration
          }
          await expectRevert(
            relayHub.setConfiguration(config, { from: incorrectOwner }),
            'caller is not the owner')
        })

        it('should let owner change configuration', async function () {
          const config = {
            gasOverhead: 0xef.toString(),
            postOverhead: 0xef.toString(),
            gasReserve: 0xef.toString(),
            maxWorkerCount: 0xef.toString(),
            minimumStake: 0xef.toString(),
            minimumUnstakeDelay: 0xef.toString(),
            maximumRecipientDeposit: 0xef.toString(),
            dataGasCostPerByte: 0xef.toString(),
            externalCallDataCostOverhead: 0xef.toString()
          }
          let configFromHub = await relayHub.getConfiguration()
          // relayHub.getConfiguration() returns an array, so we need to construct an object with its fields to compare to config.
          expect({ ...configFromHub }).to.not.include(config)
          const res = await relayHub.setConfiguration(config, { from: relayHubOwner })
          expectEvent(res, 'RelayHubConfigured')
          configFromHub = await relayHub.getConfiguration()
          expect({ ...configFromHub }).to.include(config)
        })
      })
    })
  })
