/* global contract artifacts before it */

import { ether, expectEvent } from '@openzeppelin/test-helpers'
import RelayRequest, { cloneRelayRequest } from '../src/common/EIP712/RelayRequest'
import TypedRequestData, { GsnRequestType } from '../src/common/EIP712/TypedRequestData'

import { getEip712Signature } from '../src/common/Utils'

import { defaultEnvironment } from '../src/relayclient/types/Environments'
import {
  RelayHubInstance,
  TestPaymasterEverythingAcceptedInstance,
  TestRecipientInstance,
  BatchForwarderInstance
} from '../types/truffle-contracts'

const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted.sol')
const RelayHub = artifacts.require('RelayHub.sol')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const BatchForwarder = artifacts.require('./BatchForwarder.sol')
const TestRecipient = artifacts.require('TestRecipient.sol')

contract('BatchForwarder', ([from, relayManager, relayWorker, relayOwner]) => {
  let paymaster: TestPaymasterEverythingAcceptedInstance
  let recipient: TestRecipientInstance
  let hub: RelayHubInstance
  let forwarder: BatchForwarderInstance
  let sharedRelayRequestData: RelayRequest
  const chainId = defaultEnvironment.chainId

  before(async () => {
    const paymasterDeposit = 1e18.toString()

    const stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    hub = await RelayHub.new(stakeManager.address, penalizer.address, { gas: 10000000 })
    const relayHub = hub
    await stakeManager.stakeForAddress(relayManager, 2000, {
      value: ether('2'),
      from: relayOwner
    })
    await stakeManager.authorizeHub(relayManager, relayHub.address, { from: relayOwner })
    const baseRelayFee = 1
    const pctRelayFee = 2
    await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
    await relayHub.registerRelayServer(baseRelayFee, pctRelayFee, 'url', { from: relayManager })

    paymaster = await TestPaymasterEverythingAccepted.new({ gas: 1e7 })
    await hub.depositFor(paymaster.address, { value: paymasterDeposit })

    forwarder = await BatchForwarder.new()
    await forwarder.registerRequestType(
      GsnRequestType.typeName,
      GsnRequestType.typeSuffix
    )
    recipient = await TestRecipient.new(forwarder.address)

    await paymaster.setRelayHub(hub.address)

    sharedRelayRequestData = {
      request: {
        to: recipient.address,
        data: '',
        from,
        nonce: '1',
        value: '0',
        gas: 1e6.toString()
      },
      relayData: {
        pctRelayFee: '1',
        baseRelayFee: '0',
        gasPrice: await web3.eth.getGasPrice(),
        relayWorker: relayWorker,
        forwarder: forwarder.address,
        paymaster: paymaster.address
      }
    }
  })

  context('#sendBatch', function () {
    it('should send all methods in the batch', async () => {
      const relayRequest = cloneRelayRequest(sharedRelayRequestData)
      relayRequest.request.nonce = (await forwarder.getNonce(from)).toString()
      relayRequest.request.to = forwarder.address
      relayRequest.relayData.gasPrice = 1e6.toString()
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

      const ret = await hub.relayCall(relayRequest, signature, '0x', 7e6, {
        from: relayWorker
      })

      // console.log(getLogs(ret))
      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      assert.equal(relayed!.args.status, 0)

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
      relayRequest.relayData.gasPrice = 1e6.toString()
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

      const ret = await hub.relayCall(relayRequest, signature, '0x', 7e6, {
        from: relayWorker
      })
      expectEvent(ret, 'TransactionRelayed', { status: '1' })
    })

    it('should not batch with wrong # of params', async () => {
      const relayRequest = cloneRelayRequest(sharedRelayRequestData)
      relayRequest.request.nonce = (await forwarder.getNonce(from)).toString()
      relayRequest.request.to = forwarder.address
      relayRequest.relayData.gasPrice = 1e6.toString()
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

      const ret = await hub.relayCall(relayRequest, signature, '0x', 7e6, {
        from: relayWorker
      })
      expectEvent(ret, 'TransactionRelayed', { status: '1' })
    })
  })
})
