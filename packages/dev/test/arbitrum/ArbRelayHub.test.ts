import BN from 'bn.js'
import { ether, expectEvent } from '@openzeppelin/test-helpers'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

import {
  ArbRelayHubInstance,
  ForwarderInstance,
  StakeManagerInstance,
  TestRecipientInstance,
  TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import {
  RelayRequest,
  TypedRequestData,
  constants,
  defaultEnvironment,
  environments,
  getEip712Signature,
  splitRelayUrlForRegistrar
} from '@opengsn/common'

import { TransactionRelayed } from '@opengsn/contracts/types/truffle-contracts/RelayHub'
import { RelayRegistrarInstance } from '@opengsn/contracts'
import { defaultGsnConfig } from '@opengsn/provider'
import { registerForwarderForGsn } from '@opengsn/cli/dist/ForwarderUtil'

import { hardhatNodeChainId } from '../TestUtils'

const TestToken = artifacts.require('TestToken')
const Forwarder = artifacts.require('Forwarder')
const TestArbSys = artifacts.require('TestArbSys')
const ArbRelayHub = artifacts.require('ArbRelayHub')
const StakeManager = artifacts.require('StakeManager')
const RelayRegistrar = artifacts.require('RelayRegistrar')
const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

contract('ArbRelayHub', function ([from, relayWorker, relayManager, relayOwner]: string[]) {
  const stake = ether('2')

  let arbRelayHub: ArbRelayHubInstance
  let forwarder: ForwarderInstance
  let stakeManager: StakeManagerInstance
  let relayRegistrar: RelayRegistrarInstance
  let testToken: TestTokenInstance

  before(async function () {
    testToken = await TestToken.new()
    forwarder = await Forwarder.new()
    stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, 0, 0, constants.BURN_ADDRESS, constants.BURN_ADDRESS)
    const testArbSys = await TestArbSys.new()
    relayRegistrar = await RelayRegistrar.new(constants.yearInSec)
    arbRelayHub = await ArbRelayHub.new(testArbSys.address, stakeManager.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, relayRegistrar.address, environments.arbitrum.relayHubConfiguration)
    await arbRelayHub.setMinimumStakes([testToken.address], [stake])
  })

  context('#aggregateGasleft()', function () {
    it('should return gas left both for execution and for L2 storage', async function () {
      const aggregateGasleft = await arbRelayHub.aggregateGasleft({ gas: 1000000 })
      assert.closeTo(aggregateGasleft.toNumber(), 100000000, 5000000)
    })
  })

  context('#getCreationBlock()', function () {
    it('should return separate L1 and L2 creation blocks', async function () {
      const l1CreationBlock = await arbRelayHub.getL1CreationBlock()
      const l2CreationBlock = await arbRelayHub.getCreationBlock()
      assert.equal(l1CreationBlock.muln(17).toString(), l2CreationBlock.toString())
    })
  })

  context('#relayCall()', function () {
    const transactionCalldataGasUsed = 7e6.toString()

    let testRecipient: TestRecipientInstance
    let relayRequest: RelayRequest
    let signature: string

    // TODO: extract repetitive test code to test utils
    before('prepare the relay request and relay worker', async function () {
      await registerForwarderForGsn(defaultGsnConfig.domainSeparatorName, forwarder)
      testRecipient = await TestRecipient.new(forwarder.address)
      const paymaster = await TestPaymasterEverythingAccepted.new()
      await paymaster.setTrustedForwarder(forwarder.address)
      await paymaster.setRelayHub(arbRelayHub.address)

      await arbRelayHub.depositFor(paymaster.address, {
        value: ether('1'),
        from: from
      })

      await testToken.mint(stake, { from: relayOwner })
      await testToken.approve(stakeManager.address, stake, { from: relayOwner })
      await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
      await stakeManager.stakeForRelayManager(testToken.address, relayManager, 15000, stake, {
        from: relayOwner
      })
      await stakeManager.authorizeHubByOwner(relayManager, arbRelayHub.address, { from: relayOwner })
      await arbRelayHub.addRelayWorkers([relayWorker], { from: relayManager })
      await relayRegistrar.registerRelayServer(arbRelayHub.address, splitRelayUrlForRegistrar(''), { from: relayManager })

      relayRequest = {
        request: {
          to: testRecipient.address,
          data: testRecipient.contract.methods.emitMessageNoParams().encodeABI(),
          from: from,
          nonce: '0',
          value: '0',
          gas: '1000000',
          validUntilTime: '0'
        },
        relayData: {
          transactionCalldataGasUsed,
          maxFeePerGas: 1e8.toString(),
          maxPriorityFeePerGas: 1e8.toString(),
          relayWorker,
          forwarder: forwarder.address,
          paymaster: paymaster.address,
          paymasterData: '0x',
          clientId: '0'
        }
      }
      const dataToSign = new TypedRequestData(
        defaultGsnConfig.domainSeparatorName,
        hardhatNodeChainId,
        forwarder.address,
        relayRequest
      )

      // @ts-ignore
      const currentProviderHost = web3.currentProvider.host
      const provider = new StaticJsonRpcProvider(currentProviderHost)
      signature = await getEip712Signature(
        provider.getSigner(),
        dataToSign
      )
    })

    it('should use aggregateGasleft results when calculating charge', async function () {
      const res = await arbRelayHub.relayCall(defaultGsnConfig.domainSeparatorName, 10e6, relayRequest, signature, '0x', {
        from: relayWorker,
        gas: 10000000,
        gasPrice: 1e8.toString()
      })

      await expectEvent.inTransaction(res.tx, testRecipient, 'SampleRecipientEmitted', {
        message: 'Method with no parameters'
      })

      // just an observed value
      const expectedGasUsed = 25000000

      const transactionRelayedEvent = res.logs[0].args as TransactionRelayed['args']
      const charge = transactionRelayedEvent.charge.div(new BN('100000000'))
      assert.closeTo(charge.toNumber(), expectedGasUsed, 1000000)
    })
  })
})
