import BN from 'bn.js'
import { ether, expectEvent } from '@openzeppelin/test-helpers'

import {
  ArbRelayHubInstance,
  ForwarderInstance,
  StakeManagerInstance, TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { constants, defaultEnvironment, environments, getEip712Signature } from '@opengsn/common'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { TypedRequestData } from '@opengsn/common/dist/EIP712/TypedRequestData'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { TransactionRelayed } from '@opengsn/contracts/types/truffle-contracts/RelayHub'
import { RelayRegistrarInstance } from '@opengsn/contracts'

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
    stakeManager = await StakeManager.new(Number.MAX_SAFE_INTEGER, constants.BURN_ADDRESS)
    const testArbSys = await TestArbSys.new()
    arbRelayHub = await ArbRelayHub.new(testArbSys.address, stakeManager.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, environments.arbitrum.relayHubConfiguration)
    await arbRelayHub.setMinimumStakes([testToken.address], [stake])
    relayRegistrar = await RelayRegistrar.new(arbRelayHub.address, true)
    await arbRelayHub.setRegistrar(relayRegistrar.address)
  })

  context('#aggregateGasleft()', function () {
    it('should return gas left both for execution and for L2 storage', async function () {
      const aggregateGasleft = await arbRelayHub.aggregateGasleft({ gas: 1000000 })
      assert.closeTo(aggregateGasleft.toNumber(), 100000000, 5000000)
    })
  })

  context('#relayCall()', function () {
    const transactionCalldataGasUsed = 7e6.toString()

    let relayRequest: RelayRequest
    let signature: string

    // TODO: extract repetitive test code to test utils
    before('prepare the relay request and relay worker', async function () {
      await registerForwarderForGsn(forwarder)
      const testRecipient = await TestRecipient.new(forwarder.address)
      const paymaster = await TestPaymasterEverythingAccepted.new()
      await paymaster.setTrustedForwarder(forwarder.address)

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
      await relayRegistrar.registerRelayServer('0', '0', '', { from: relayManager })

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
          pctRelayFee: '0',
          baseRelayFee: '0',
          transactionCalldataGasUsed,
          maxFeePerGas: 1e8.toString(),
          maxPriorityFeePerGas: 1e8.toString(),
          relayWorker,
          forwarder: forwarder.address,
          paymaster: paymaster.address,
          paymasterData: '0x',
          clientId: ''
        }
      }
      const dataToSign = new TypedRequestData(
        defaultEnvironment.chainId,
        forwarder.address,
        relayRequest
      )
      signature = await getEip712Signature(
        web3,
        dataToSign
      )
    })

    it('should use aggregateGasleft results when calculating charge', async function () {
      const res = await arbRelayHub.relayCall(10e6, relayRequest, signature, '0x', {
        from: relayWorker,
        gas: 10000000,
        gasPrice: 1e8.toString()
      })

      await expectEvent.inTransaction(res.tx, TestRecipient, 'SampleRecipientEmitted', {
        message: 'Method with no parameters'
      })

      // just an observed value
      const expectedGasUsed = 21000000

      const transactionRelayedEvent = res.logs[0].args as TransactionRelayed['args']
      const charge = transactionRelayedEvent.charge.div(new BN('100000000'))
      assert.closeTo(charge.toNumber(), expectedGasUsed, 1000000)
    })
  })
})
