import { AbiCoder, Interface } from '@ethersproject/abi'
import { HttpProvider } from 'web3-core'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { expectRevert } from '@openzeppelin/test-helpers'

import {
  constants,
  GSNConfig,
  GSNUnresolvedConstructorInput,
  RelayProvider,
  RelayRequest,
  toBN
} from '@opengsn/provider'
import { GsnTestEnvironment } from '@opengsn/cli'
import { RelayHubInstance, TestRecipientInstance } from '@opengsn/contracts'

import { SingletonWhitelistPaymasterInstance } from '../types/truffle-contracts'
import { GAS_PRICE, impersonateAccount } from './ForkTestUtils'
import { defaultEnvironment } from '@opengsn/common'
import { revert, snapshot } from '@opengsn/dev/dist/test/TestUtils'

const SingletonWhitelistPaymaster = artifacts.require('SingletonWhitelistPaymaster')
const TestRecipient = artifacts.require('TestRecipient')
const RelayHub = artifacts.require('RelayHub')

const POST_GAS_USE = 35000

contract('SingletonWhitelistPaymaster',
  function (
    [owner1, owner2, from, from2, another, paymasterDeployer]) {
    // @ts-ignore
    const currentProviderHost = web3.currentProvider.host
    const provider = new StaticJsonRpcProvider(currentProviderHost)

    let hub: RelayHubInstance
    let pm: SingletonWhitelistPaymasterInstance
    let testRecipient1: TestRecipientInstance
    let testRecipient2: TestRecipientInstance

    let gsnProvider: RelayProvider
    let relayRequest: RelayRequest

    let _relayHubAddress: string

    before(async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const {
        contractsDeployment: {
          relayHubAddress,
          forwarderAddress
        }
      } = await GsnTestEnvironment.startGsn(host)
      _relayHubAddress = relayHubAddress!

      hub = await RelayHub.at(_relayHubAddress)
      testRecipient1 = await TestRecipient.new(forwarderAddress!)
      testRecipient2 = await TestRecipient.new(forwarderAddress!)
      pm = await SingletonWhitelistPaymaster.new({ from: paymasterDeployer })
      await pm.setRelayHub(relayHubAddress!, { from: paymasterDeployer })
      await pm.setTrustedForwarder(forwarderAddress!, { from: paymasterDeployer })

      const gsnConfig: Partial<GSNConfig> = {
        loggerConfiguration: {
          logLevel: 'error'
        },
        gasPriceSlackPercent: 10000,
        paymasterAddress: pm.address,
        maxPaymasterDataLength: 32
      }
      const input: GSNUnresolvedConstructorInput = {
        provider,
        config: gsnConfig,
        overrideDependencies: {
          asyncPaymasterData: async () => { return new AbiCoder().encode(['address'], [owner1]) }
        }
      }
      gsnProvider = await RelayProvider.newWeb3Provider(input)
      // @ts-ignore
      TestRecipient.web3.setProvider(gsnProvider)

      relayRequest = {
        relayData: {
          relayWorker: constants.ZERO_ADDRESS,
          paymaster: pm.address,
          forwarder: forwarderAddress!,
          transactionCalldataGasUsed: '0',
          maxFeePerGas: GAS_PRICE,
          maxPriorityFeePerGas: GAS_PRICE,
          paymasterData: '0x',
          clientId: '1'
        },
        request: {
          data: testRecipient2.contract.methods.emitMessageNoParams().encodeABI(),
          nonce: '0',
          value: '0',
          validUntilTime: '0',
          from,
          to: testRecipient2.address,
          gas: 1e6.toString()
        }
      }
    })

    describe('#_postRelayedCall()', function () {
      let id: string
      before(async function () {
        id = (await snapshot()).result
      })
      after(async function () {
        await revert(id)
      })

      it('should report approximate correct gas usage correctly', async function () {
        await web3.eth.sendTransaction({ from: owner1, to: pm.address, value: 1e18 })
        const paymasterData = new AbiCoder().encode(['address'], [owner1])
        const postGasUse = await pm.contract.methods.postRelayedCall(paymasterData, true, 100, relayRequest.relayData).estimateGas({ from: _relayHubAddress })
        assert.closeTo(parseInt(postGasUse.toString()), POST_GAS_USE + defaultEnvironment.mintxgascost, 5000)
      })
    })

    describe('balance accounting', function () {
      let id: string
      before(async function () {
        id = (await snapshot()).result
      })
      after(async function () {
        await revert(id)
      })

      it('should reject if dapp owner has insufficient deposit', async function () {
        // deposit to hub so the balance error is raised by the paymaster and not the relay hub
        await hub.depositFor(pm.address, { value: 1e18.toString() })

        // adding configuration to pass the initial check
        await pm.whitelistSenders([from, from2], true, { from: owner1 })
        await pm.setDappConfiguration(true, false, false, { from: owner1 })
        // TODO: this is lazy. Build the call to 'preRelayedCall' manually to control the inputs!
        await expectRevert(testRecipient1.emitMessageNoParams({ from }), 'insufficient balance for charge')
      })

      it('should attribute incoming ether to the sender', async function () {
        const res = await web3.eth.sendTransaction({ from: owner1, to: pm.address, value: 1e18 })
        const ifacePm = new Interface(pm.abi as any)
        const ifaceRh = new Interface(hub.abi as any)
        const deposited = ifaceRh.decodeEventLog('Deposited', res.logs[0].data, res.logs[0].topics)
        const received = ifacePm.decodeEventLog('Received', res.logs[1].data, res.logs[1].topics)
        assert.equal(deposited.amount.toString(), received.amount.toString())
        assert.equal(deposited.paymaster.toLowerCase(), pm.address.toLowerCase())
        assert.equal(received.dappOwner.toLowerCase(), owner1.toLowerCase())
      })

      it('should allow dapp owner to withdraw from the remaining deposit', async function () {
        const dappDetails: any = await pm.registeredDapps(owner1)
        assert.equal(dappDetails.balance, 1e18.toString()) // depends on previous test
        const ownerBalanceBefore = await web3.eth.getBalance(owner1)
        const { receipt } = await pm.withdrawBalance(dappDetails.balance.toString(), { from: owner1 })
        const txCost = toBN(receipt.gasUsed * receipt.effectiveGasPrice)
        const ownerBalanceAfter = await web3.eth.getBalance(owner1)
        const expectedBalance = toBN(ownerBalanceBefore).add(dappDetails.balance).sub(txCost)
        assert.equal(ownerBalanceAfter, expectedBalance.toString())
        const ifacePm = new Interface(pm.abi as any)
        const withdrawn = ifacePm.decodeEventLog('Withdrawn', receipt.rawLogs[1].data, receipt.rawLogs[1].topics)
        assert.equal(withdrawn.balance.toString(), '0')
        assert.equal(withdrawn.amount.toString(), dappDetails.balance.toString())
        assert.equal(withdrawn.dappOwner.toLowerCase(), owner1.toLowerCase())
      })

      it('should not allow dapp owner to withdraw more than available', async function () {
        await web3.eth.sendTransaction({ from: owner1, to: pm.address, value: 1e18 })
        // correct owner but excessive balance
        await expectRevert(
          pm.withdrawBalance(2e18.toString(), { from: owner1 }), 'dapp owner balance insufficient')
        // incorrect owner
        await expectRevert(
          pm.withdrawBalance('100', { from: owner2 }), 'dapp owner balance insufficient')
        // repeated withdrawals affect balance
        await pm.withdrawBalance(0.3e18.toString(), { from: owner1 })
        await pm.withdrawBalance(0.5e18.toString(), { from: owner1 })
        await expectRevert(
          pm.withdrawBalance(0.6e18.toString(), { from: owner1 }), 'dapp owner balance insufficient')
        const dappDetails: any = await pm.registeredDapps(owner1)
        assert.equal(dappDetails.balance.toString(), 0.2e18.toString())
      })

      it('should not allow dapp owner to withdraw during the relaying', async function () {
        // adding configuration to pass the initial check
        await pm.whitelistSenders([from, from2], true, { from: owner1 })
        await pm.setDappConfiguration(true, false, false, { from: owner1 })
        await web3.eth.sendTransaction({ from: owner1, to: pm.address, value: 1e18 })

        await expectRevert(
          testRecipient1.withdrawFromSingletonWhitelistPaymaster(pm.address, { from }), 'withdrawBalance reentrant call')
      })
    })

    describe('configuration', function () {
      it('should allow only the paymaster owner to change shared configuration', async function () {
        await pm.setSharedConfiguration(100, 500, { from: paymasterDeployer })
        const gasUsedByPost1 = await pm.gasUsedByPost()
        const paymasterFee1 = await pm.paymasterFee()
        assert.equal(gasUsedByPost1.toString(), '100')
        assert.equal(paymasterFee1.toString(), '500')
        await pm.setSharedConfiguration(300, 400, { from: paymasterDeployer })
        const gasUsedByPost2 = await pm.gasUsedByPost()
        const paymasterFee2 = await pm.paymasterFee()
        assert.equal(gasUsedByPost2.toString(), '300')
        assert.equal(paymasterFee2.toString(), '400')
        await expectRevert(
          pm.setSharedConfiguration(300, 400, { from: another }),
          'Ownable: caller is not the owner')
      })

      it('should reject without dapp configuration', async function () {
        await web3.eth.sendTransaction({ from: owner2, to: pm.address, value: 1e18 })
        gsnProvider.relayClient.dependencies.asyncPaymasterData =
          async () => { return new AbiCoder().encode(['address'], [owner2]) }
        await expectRevert(
          testRecipient1.emitMessageNoParams({ from: from }),
          'turning off checks is forbidden')

        // NOTE: ugly - restoring the original 'asyncPaymasterData'
        gsnProvider.relayClient.dependencies.asyncPaymasterData =
          async () => { return new AbiCoder().encode(['address'], [owner1]) }
      })
    })

    it('should reject the transaction outright with invalid paymasterData', async function () {
      relayRequest.relayData.paymasterData = '0xdeadbeef'
      await impersonateAccount(_relayHubAddress)
      await expectRevert(
        pm.preRelayedCall(relayRequest, '0x', '0x', 10000, { from: _relayHubAddress }),
        'paymasterData: invalid length')
    })

    describe('with senders whitelist enabled', () => {
      before(async () => {
        await web3.eth.sendTransaction({ from: owner1, to: pm.address, value: 1e18 })
        await pm.whitelistSenders([from, from2], true, { from: owner1 })
        await pm.setDappConfiguration(true, false, false, { from: owner1 })
      })

      it('should allow whitelisted sender, charge the dapp owner for gas and a paymaster fee', async () => {
        const pmBalanceBefore = await hub.balanceOf(pm.address)
        const deployerEntryBefore: any = await pm.registeredDapps(paymasterDeployer)
        assert.equal(deployerEntryBefore.balance.toString(), '0') // TODO: revert each test

        await pm.setSharedConfiguration(POST_GAS_USE, 15, { from: paymasterDeployer })

        const { receipt: transactionReceipt1 } = await testRecipient1.emitMessageNoParams({
          from: from
        })

        const { receipt: transactionReceipt2 } = await testRecipient1.emitMessageNoParams({
          from: from2
        })

        const ifacePm = new Interface(pm.abi as any)
        const postEvent1 = ifacePm.decodeEventLog('PostRelayedCall', transactionReceipt1.rawLogs[1].data, transactionReceipt1.rawLogs[1].topics)
        const postEvent2 = ifacePm.decodeEventLog('PostRelayedCall', transactionReceipt2.rawLogs[1].data, transactionReceipt2.rawLogs[1].topics)

        const pmBalanceAfter = await hub.balanceOf(pm.address)
        const deployerEntryAfter: any = await pm.registeredDapps(paymasterDeployer)

        const actualFee1 = postEvent1.paymasterCharge.toString() / postEvent1.totalCharge.sub(postEvent1.paymasterCharge).toString()
        const actualFee2 = postEvent2.paymasterCharge.toString() / postEvent2.totalCharge.sub(postEvent2.paymasterCharge).toString()
        assert.equal(actualFee1, 0.15)
        assert.equal(actualFee2, 0.15)

        const expectedDevBalance = toBN(postEvent1.paymasterCharge.toString()).add(toBN(postEvent2.paymasterCharge.toString()))
        const pmHubBalanceCharge = pmBalanceBefore.sub(pmBalanceAfter)
        const pmEstimatedHubCharge = toBN(postEvent1.totalCharge.toString()).add(toBN(postEvent2.totalCharge.toString())).sub(expectedDevBalance)

        assert.equal(deployerEntryAfter.balance.toString(), expectedDevBalance.toString())
        // 15% is actually a bit too much - investigate further
        assert.closeTo(parseInt(pmHubBalanceCharge.toString()) / parseInt(pmEstimatedHubCharge.toString()), 1, 0.15)
      })

      it('should prevent non-whitelisted sender', async () => {
        await expectRevert(testRecipient1.emitMessageNoParams({ from: another }), 'sender not whitelisted')
      })
    })
  }
)
