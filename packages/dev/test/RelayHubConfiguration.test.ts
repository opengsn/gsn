import BN from 'bn.js'
import chai from 'chai'
import { ether, expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

import { deployHub, evmMine, hardhatNodeChainId, setNextBlockTimestamp } from './TestUtils'

import chaiAsPromised from 'chai-as-promised'
import {
  RelayRequest,
  TypedRequestData,
  constants,
  defaultEnvironment,
  getEip712Signature,
  splitRelayUrlForRegistrar,
  toNumber
} from '@opengsn/common/dist'
import {
  ForwarderInstance,
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance, TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance, TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'

import { RelayRegistrarInstance } from '@opengsn/contracts'
import { cleanValue } from './utils/chaiHelper'
import { defaultGsnConfig } from '@opengsn/provider'
import { registerForwarderForGsn } from '@opengsn/cli/dist/ForwarderUtil'

const { assert } = chai.use(chaiAsPromised)

const StakeManager = artifacts.require('StakeManager')
const Forwarder = artifacts.require('Forwarder')
const Penalizer = artifacts.require('Penalizer')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const TestRecipient = artifacts.require('TestRecipient')
const TestToken = artifacts.require('TestToken')
const RelayRegistrar = artifacts.require('RelayRegistrar')

contract('RelayHub Configuration',
  function ([relayHubDeployer, relayOwner, relayManager, relayWorker, senderAddress, other, dest, incorrectOwner]) { // eslint-disable-line no-unused-vars
    const message = 'Configuration'
    const unstakeDelay = 15000
    const chainId = hardhatNodeChainId
    const gasPrice = new BN(1e9)
    const maxFeePerGas = new BN(1e9)
    const maxPriorityFeePerGas = new BN(1e9)
    const gasLimit = new BN('1000000')
    const externalGasLimit = 5e6.toString()
    const paymasterData = '0x'
    const apporovalData = '0x'
    const clientId = '1'
    const senderNonce = new BN('0')
    const maxAcceptanceBudget = 10e6
    const deprecationTimeInSeconds = 100
    const stake = ether('2')

    // @ts-ignore
    const currentProviderHost = web3.currentProvider.host
    const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)

    let relayHub: RelayHubInstance
    let relayRegistrar: RelayRegistrarInstance
    let stakeManager: StakeManagerInstance
    let penalizer: PenalizerInstance
    let recipient: TestRecipientInstance
    let paymaster: TestPaymasterEverythingAcceptedInstance
    let forwarderInstance: ForwarderInstance
    let testToken: TestTokenInstance
    let encodedFunction
    let signature: string
    let relayRequest: RelayRequest
    let forwarder: string
    let relayHubOwner: string

    beforeEach(async function prepareForHub () {
      testToken = await TestToken.new()
      forwarderInstance = await Forwarder.new()
      forwarder = forwarderInstance.address
      recipient = await TestRecipient.new(forwarder)
      paymaster = await TestPaymasterEverythingAccepted.new()
      stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
      penalizer = await Penalizer.new(
        defaultEnvironment.penalizerConfiguration.penalizeBlockDelay,
        defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
      relayHub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString())
      relayRegistrar = await RelayRegistrar.at(await relayHub.getRelayRegistrar())
      await paymaster.setTrustedForwarder(forwarder)
      await paymaster.setRelayHub(relayHub.address)
      // Register hub's RelayRequest with forwarder, if not already done.
      await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, forwarderInstance)

      await relayHub.depositFor(paymaster.address, {
        value: ether('1'),
        from: other
      })

      await testToken.mint(stake, { from: relayOwner })
      await testToken.approve(stakeManager.address, stake, { from: relayOwner })
      await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
      await stakeManager.stakeForRelayManager(testToken.address, relayManager, unstakeDelay, stake, {
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
      await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
      await relayRegistrar.registerRelayServer(relayHub.address, splitRelayUrlForRegistrar(''), { from: relayManager })
      encodedFunction = recipient.contract.methods.emitMessage(message).encodeABI()
      relayRequest = {
        request: {
          to: recipient.address,
          data: encodedFunction,
          from: senderAddress,
          nonce: senderNonce.toString(),
          value: '0',
          gas: gasLimit.toString(),
          validUntilTime: '0'
        },
        relayData: {
          transactionCalldataGasUsed: '0',
          maxFeePerGas: maxFeePerGas.toString(),
          maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
          relayWorker,
          forwarder,
          paymaster: paymaster.address,
          paymasterData,
          clientId
        }

      }
      const dataToSign = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        chainId,
        forwarder,
        relayRequest
      )
      signature = await getEip712Signature(
        ethersProvider.getSigner(senderAddress),
        dataToSign
      )

      relayHubOwner = await relayHub.owner()
      assert.equal(relayHubDeployer, relayHubOwner)
    })

    describe('#deprecateHub', function () {
      it('should let owner set hub deprecation block', async function () {
        const deprecationTime = 0xef.toString()
        const res = await relayHub.deprecateHub(deprecationTime, { from: relayHubOwner })
        expectEvent(
          res,
          'HubDeprecated', { deprecationTime })
        const deprecationTimeFromHub = (await relayHub.getDeprecationTime()).toString()
        assert.equal(deprecationTime, deprecationTimeFromHub)
      })

      it('should not let non owners set hub deprecation block', async function () {
        await expectRevert(
          relayHub.deprecateHub(1, { from: incorrectOwner }),
          'caller is not the owner')
      })

      it('should let owner re-set deprecation only before it\'s due block', async function () {
        // Setting deprecation time
        let deprecationTime = toNumber((await web3.eth.getBlock('latest')).timestamp) + deprecationTimeInSeconds
        let res = await relayHub.deprecateHub(deprecationTime, { from: relayHubOwner })
        expectEvent(
          res,
          'HubDeprecated', {
            deprecationTime: deprecationTime.toString()
          })
        await evmMine()

        // Resetting deprecation time before it's due
        deprecationTime = toNumber((await web3.eth.getBlock('latest')).timestamp) + deprecationTimeInSeconds
        res = await relayHub.deprecateHub(deprecationTime, { from: relayHubOwner })
        expectEvent(
          res,
          'HubDeprecated', {
            deprecationTime: deprecationTime.toString()
          })

        await setNextBlockTimestamp(deprecationTime)

        // Resetting deprecation time after it's due
        await expectRevert(
          relayHub.deprecateHub(deprecationTime, { from: relayHubOwner }),
          'Already deprecated')
      })
    })

    describe('#isDeprecated', function () {
      it('should return true only after deprecation time set and passed', async function () {
        // Before deprecation block set
        let isDeprecated = await relayHub.isDeprecated()
        assert.isFalse(isDeprecated)
        let deprecationTime = (await relayHub.getDeprecationTime())
        const maxUint256 = 'f'.repeat(64)
        assert.equal(deprecationTime.toString(16), maxUint256)

        // After deprecation time set but not yet passed
        const newDeprecationTime = toNumber((await web3.eth.getBlock('latest')).timestamp) + deprecationTimeInSeconds
        await relayHub.deprecateHub(newDeprecationTime)
        isDeprecated = await relayHub.isDeprecated()
        assert.isFalse(isDeprecated)
        deprecationTime = (await relayHub.getDeprecationTime())
        assert.equal(deprecationTime.toNumber(), newDeprecationTime)

        // After deprecation time set and passed
        await setNextBlockTimestamp(deprecationTime)
        await evmMine()
        isDeprecated = await relayHub.isDeprecated()
        assert.isTrue(isDeprecated)
      })
    })

    describe('#relayCall', function () {
      it('should revert if deprecationBlock set and passed', async function () {
        const deprecationTime = toNumber((await web3.eth.getBlock('latest')).timestamp) + deprecationTimeInSeconds
        await relayHub.deprecateHub(deprecationTime)
        await setNextBlockTimestamp(deprecationTime)

        await expectRevert(
          relayHub.relayCall(defaultGsnConfig.domainSeparatorName, maxAcceptanceBudget, relayRequest, signature, apporovalData, {
            from: relayWorker,
            gasPrice,
            gas: externalGasLimit
          }),
          'hub deprecated')
      })

      it('should not revert before deprecationBlock set', async function () {
        const res = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, maxAcceptanceBudget, relayRequest, signature, apporovalData, {
          from: relayWorker,
          gasPrice,
          gas: externalGasLimit
        })
        expectEvent(res, 'TransactionRelayed', { status: '0' })
      })

      it('should not revert before deprecationBlock passed', async function () {
        const newDeprecationTime = toNumber((await web3.eth.getBlock('latest')).timestamp) + deprecationTimeInSeconds
        await relayHub.deprecateHub(newDeprecationTime)
        const res = await relayHub.relayCall(defaultGsnConfig.domainSeparatorName, maxAcceptanceBudget, relayRequest, signature, apporovalData, {
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
            minimumUnstakeDelay: 0xef.toString(),
            devAddress: '0xeFEfeFEfeFeFEFEFEfefeFeFefEfEfEfeFEFEFEf',
            devFee: 0x11.toString(),
            baseRelayFee: 0x11.toString(),
            pctRelayFee: 0x11.toString()
          }
          let configFromHub = await relayHub.getConfiguration()
          // relayHub.getConfiguration() returns an array, so we need to construct an object with its fields to compare to config.
          expect({ ...configFromHub }).to.not.include(config)
          const res = await relayHub.setConfiguration(config, { from: relayHubOwner })
          expectEvent(res, 'RelayHubConfigured')
          configFromHub = cleanValue(await relayHub.getConfiguration())
          expect(configFromHub).to.deep.include(config)
        })
        it('should not set dev fee to over 100% of charge', async function () {
          const config = {
            gasOverhead: 0xef.toString(),
            postOverhead: 0xef.toString(),
            gasReserve: 0xef.toString(),
            maxWorkerCount: 0xef.toString(),
            minimumStake: 0xef.toString(),
            minimumUnstakeDelay: 0xef.toString(),
            devAddress: '0xeFEfeFEfeFeFEFEFEfefeFeFefEfEfEfeFEFEFEf',
            devFee: '101',
            baseRelayFee: '101',
            pctRelayFee: '101'
          }
          await expectRevert(
            relayHub.setConfiguration(config, { from: relayHubOwner }),
            'dev fee too high')
        })
      })
    })
  })
