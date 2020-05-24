/* global contract artifacts before it */

import { ether } from '@openzeppelin/test-helpers'

const Environments = require('../src/relayclient/types/Environments')

const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted.sol')
const RelayHub = artifacts.require('RelayHub.sol')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TrustedBatchForwarder = artifacts.require('./TrustedBatchForwarder.sol')
const TestRecipient = artifacts.require('TestRecipient.sol')
const { getEip712Signature } = require('../src/common/utils')
const getDataToSign = require('../src/common/EIP712/Eip712Helper')
const { expectEvent } = require('@openzeppelin/test-helpers')

const RelayRequest = require('../src/common/EIP712/RelayRequest')

contract('TrustedBatchForwarder', ([from, relayManager, relayWorker, relayOwner]) => {
  let paymaster, recipient, hub, forwarder
  let sharedRelayRequestData
  const chainId = Environments.defaultEnvironment.chainId

  before(async () => {
    const paymasterDeposit = 1e18.toString()

    const stakeManager = await StakeManager.new()
    const penalizer = await Penalizer.new()
    hub = await RelayHub.new(Environments.defaultEnvironment.gtxdatanonzero, stakeManager.address, penalizer.address, { gas: 10000000 })
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

    recipient = await TestRecipient.new()
    forwarder = await TrustedBatchForwarder.new()
    recipient.setTrustedForwarder(forwarder.address)

    await paymaster.setRelayHub(hub.address)

    sharedRelayRequestData = {
      senderAddress: from,
      senderNonce: '1',
      target: recipient.address,
      pctRelayFee: '1',
      baseRelayFee: '0',
      gasPrice: await web3.eth.getGasPrice(),
      gasLimit: 1e6.toString(),
      relayWorker: relayWorker,
      paymaster: paymaster.address,
      forwarder: forwarder.address
    }
  })

  context('#sendBatch', async () => {
    it('should send all methods in the batch', async () => {
      const relayRequest = new RelayRequest({
        ...sharedRelayRequestData,
        senderNonce: (await forwarder.getNonce(from)).toString(),
        target: forwarder.address,
        gasPrice: 1e6.toString(),
        encodedFunction: forwarder.contract.methods.sendBatch([recipient.address, recipient.address],
          [
            recipient.contract.methods.emitMessage('hello').encodeABI(),
            recipient.contract.methods.emitMessage('world').encodeABI()
          ]).encodeABI()
      })

      const dataToSign = await getDataToSign({
        chainId,
        verifier: forwarder.address,
        relayRequest
      })
      const signature = await getEip712Signature({
        web3,
        dataToSign
      })

      const ret = await hub.relayCall(relayRequest, signature, '0x', {
        from: relayWorker
      })

      // console.log(getLogs(ret))
      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      assert.equal(relayed.args.status, 0)

      const logs = await recipient.getPastEvents({ fromBlock: 1 })
      const testevents = logs.filter(e => e.event === 'SampleRecipientEmitted')
      assert.equal(testevents.length, 2)
      assert.equal(testevents[0].args.realSender, from)
    })

    it('should revert all requests if one fails', async () => {
      const relayRequest = new RelayRequest({
        ...sharedRelayRequestData,
        senderNonce: (await forwarder.getNonce(from)).toString(),
        target: forwarder.address,
        gasPrice: 1e6.toString(),
        encodedFunction: forwarder.contract.methods.sendBatch([recipient.address, recipient.address],
          [
            recipient.contract.methods.emitMessage('hello').encodeABI(),
            recipient.contract.methods.testRevert().encodeABI()
          ]).encodeABI()
      })

      const dataToSign = await getDataToSign({
        chainId,
        verifier: forwarder.address,
        relayRequest
      })
      const signature = await getEip712Signature({
        web3,
        dataToSign
      })

      const ret = await hub.relayCall(relayRequest, signature, '0x', {
        from: relayWorker
      })
      expectEvent(ret, 'TransactionRelayed', { status: '1' })
    })

    it('should not batch with wrong # of params', async () => {
      const relayRequest = new RelayRequest({
        ...sharedRelayRequestData,
        senderNonce: (await forwarder.getNonce(from)).toString(),
        target: forwarder.address,
        gasPrice: 1e6.toString(),
        encodedFunction: forwarder.contract.methods.sendBatch([recipient.address, recipient.address],
          [
            recipient.contract.methods.emitMessage('hello').encodeABI()
          ]).encodeABI()
      })

      const dataToSign = await getDataToSign({
        chainId,
        verifier: forwarder.address,
        relayRequest
      })
      const signature = await getEip712Signature({
        web3,
        dataToSign
      })

      const ret = await hub.relayCall(relayRequest, signature, '0x', {
        from: relayWorker
      })
      expectEvent(ret, 'TransactionRelayed', { status: '1' })
    })
  })
})
