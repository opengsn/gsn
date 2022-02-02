/* global contract artifacts before it */

import { ether, expectEvent } from '@openzeppelin/test-helpers'
import { RelayRequest, cloneRelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { TypedRequestData } from '@opengsn/common/dist/EIP712/TypedRequestData'

import { getEip712Signature } from '@opengsn/common/dist/Utils'

import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import {
  RelayHubInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance,
  BatchForwarderInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { deployHub, encodeRevertReason } from '../TestUtils'
import { registerForwarderForGsn } from '@opengsn/common/dist/EIP712/ForwarderUtil'
import { constants } from '@opengsn/common'

const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const BatchForwarder = artifacts.require('BatchForwarder')
const TestRecipient = artifacts.require('TestRecipient')
const TestToken = artifacts.require('TestToken')
const RelayRegistrar = artifacts.require('RelayRegistrar')

contract('BatchForwarder', ([from, relayManager, relayWorker, relayOwner]) => {
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let recipient: TestRecipientInstance
  let hub: RelayHubInstance
  let forwarder: BatchForwarderInstance
  let sharedRelayRequestData: RelayRequest
  const chainId = defaultEnvironment.chainId

  before(async () => {
    const stake = ether('2')
    const paymasterDeposit = 1e18.toString()

    const testToken = await TestToken.new()
    const stakeManager = await StakeManager.new(defaultEnvironment.maxUnstakeDelay, constants.BURN_ADDRESS)
    const penalizer = await Penalizer.new(defaultEnvironment.penalizerConfiguration.penalizeBlockDelay, defaultEnvironment.penalizerConfiguration.penalizeBlockExpiration)
    hub = await deployHub(stakeManager.address, penalizer.address, constants.ZERO_ADDRESS, testToken.address, stake.toString())
    const relayRegistrar = await RelayRegistrar.at(await hub.getRelayRegistrar())
    const relayHub = hub

    await testToken.mint(stake, { from: relayOwner })
    await testToken.approve(stakeManager.address, stake, { from: relayOwner })
    await stakeManager.setRelayManagerOwner(relayOwner, { from: relayManager })
    await stakeManager.stakeForRelayManager(testToken.address, relayManager, 15000, stake, {
      from: relayOwner
    })
    await stakeManager.authorizeHubByOwner(relayManager, relayHub.address, { from: relayOwner })
    const baseRelayFee = 1
    const pctRelayFee = 2
    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    await relayRegistrar.registerRelayServer(baseRelayFee, pctRelayFee, 'url', { from: relayManager })

    paymaster = await TestPaymasterEverythingAccepted.new({ gas: 1e7 })
    await hub.depositFor(paymaster.address, { value: paymasterDeposit })

    forwarder = await BatchForwarder.new()
    await registerForwarderForGsn(forwarder)

    recipient = await TestRecipient.new(forwarder.address)

    await paymaster.setTrustedForwarder(forwarder.address)
    await paymaster.setRelayHub(hub.address)

    const gasPrice = await web3.eth.getGasPrice()
    sharedRelayRequestData = {
      request: {
        to: recipient.address,
        data: '',
        from,
        nonce: '1',
        value: '0',
        gas: 1e6.toString(),
        validUntilTime: '0'
      },
      relayData: {
        pctRelayFee: '1',
        baseRelayFee: '0',
        transactionCalldataGasUsed: '0',
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        relayWorker: relayWorker,
        forwarder: forwarder.address,
        paymaster: paymaster.address,
        paymasterData: '0x',
        clientId: '1'
      }
    }
  })

  context('#sendBatch', function () {
    it('should send all methods in the batch', async () => {
      const relayRequest = cloneRelayRequest(sharedRelayRequestData)
      relayRequest.request.nonce = (await forwarder.getNonce(from)).toString()
      relayRequest.request.to = forwarder.address
      relayRequest.relayData.maxFeePerGas = 1e6.toString()
      relayRequest.relayData.maxPriorityFeePerGas = 1e6.toString()
      relayRequest.request.data = forwarder.contract.methods.sendBatch([recipient.address, recipient.address],
        [
          recipient.contract.methods.emitMessage('hello').encodeABI(),
          recipient.contract.methods.emitMessage('world').encodeABI()
        ]).encodeABI()

      const dataToSign = new TypedRequestData(
        chainId,
        forwarder.address,
        relayRequest
      )
      const signature = await getEip712Signature(
        web3,
        dataToSign
      )

      const ret = await hub.relayCall(10e6, relayRequest, signature, '0x', {
        from: relayWorker,
        gas: 7e6
      })

      // console.log(getLogs(ret))
      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      // @ts-ignore
      assert.equal(relayed.args.status, 0)

      // @ts-ignore
      const logs = await recipient.getPastEvents({ fromBlock: 1 })
      const testevents = logs.filter((e: any) => e.event === 'SampleRecipientEmitted')
      assert.equal(testevents.length, 2)
      assert.equal(testevents[0].args.realSender, from)
    })

    it('should revert all requests if one fails', async () => {
      const relayRequest = cloneRelayRequest(sharedRelayRequestData)
      relayRequest.request.nonce = (await forwarder.getNonce(from)).toString()
      relayRequest.request.to = forwarder.address
      relayRequest.relayData.maxFeePerGas = 1e6.toString()
      relayRequest.relayData.maxPriorityFeePerGas = 1e6.toString()
      relayRequest.request.data = forwarder.contract.methods.sendBatch([recipient.address, recipient.address],
        [
          recipient.contract.methods.emitMessage('hello').encodeABI(),
          recipient.contract.methods.testRevert().encodeABI()
        ]).encodeABI()

      const dataToSign = new TypedRequestData(
        chainId,
        forwarder.address,
        relayRequest
      )
      const signature = await getEip712Signature(
        web3,
        dataToSign
      )

      const ret = await hub.relayCall(10e6, relayRequest, signature, '0x', {
        from: relayWorker,
        gas: 7e6
      })
      const expectedReturnValue = encodeRevertReason('always fail')

      expectEvent(ret, 'TransactionResult', {
        status: '1',
        returnValue: expectedReturnValue
      })
    })

    it('should not batch with wrong # of params', async () => {
      const relayRequest = cloneRelayRequest(sharedRelayRequestData)
      relayRequest.request.nonce = (await forwarder.getNonce(from)).toString()
      relayRequest.request.to = forwarder.address
      relayRequest.relayData.maxFeePerGas = 1e6.toString()
      relayRequest.relayData.maxPriorityFeePerGas = 1e6.toString()
      relayRequest.request.data = forwarder.contract.methods.sendBatch([recipient.address, recipient.address],
        [
          recipient.contract.methods.emitMessage('hello').encodeABI()
        ]).encodeABI()

      const dataToSign = new TypedRequestData(
        chainId,
        forwarder.address,
        relayRequest
      )
      const signature = await getEip712Signature(
        web3,
        dataToSign
      )

      const ret = await hub.relayCall(10e6, relayRequest, signature, '0x', {
        from: relayWorker,
        gas: 7e6
      })
      expectEvent(ret, 'TransactionRelayed', { status: '1' })
    })
  })
})
