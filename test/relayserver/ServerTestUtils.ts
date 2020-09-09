// @ts-ignore
import abiDecoder from 'abi-decoder'
import { TransactionReceipt } from 'web3-core'
import { toBN } from 'web3-utils'
import * as ethUtils from 'ethereumjs-util'

import PayMasterABI from '../../src/common/interfaces/IPaymaster.json'
import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../src/common/interfaces/IStakeManager.json'
import { RelayServer } from '../../src/relayserver/RelayServer'

const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)

export function assertRelayAdded (receipts: TransactionReceipt[], server: RelayServer, checkWorkers = true): void {
  const registeredReceipt = receipts.find(r => {
    const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
    return decodedLogs[0].name === 'RelayServerRegistered'
  })
  if (registeredReceipt == null) {
    throw new Error('Registered Receipt not found')
  }
  const registeredLogs = abiDecoder.decodeLogs(registeredReceipt.logs).map(server.registrationManager._parseEvent)
  assert.equal(registeredLogs.length, 1)
  assert.equal(registeredLogs[0].name, 'RelayServerRegistered')
  assert.equal(registeredLogs[0].args.relayManager.toLowerCase(), server.managerAddress.toLowerCase())
  assert.equal(registeredLogs[0].args.baseRelayFee, server.config.baseRelayFee)
  assert.equal(registeredLogs[0].args.pctRelayFee, server.config.pctRelayFee)
  assert.equal(registeredLogs[0].args.relayUrl, server.config.url)

  if (checkWorkers) {
    const workersAddedReceipt = receipts.find(r => {
      const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
      return decodedLogs[0].name === 'RelayWorkersAdded'
    })
    const workersAddedLogs = abiDecoder.decodeLogs(workersAddedReceipt!.logs).map(server.registrationManager._parseEvent)
    assert.equal(workersAddedLogs.length, 1)
    assert.equal(workersAddedLogs[0].name, 'RelayWorkersAdded')
  }
}

export function getTotalTxCosts (receipts: TransactionReceipt[], gasPrice: string): ethUtils.BN {
  return receipts.map(r => toBN(r.gasUsed).mul(toBN(gasPrice))).reduce(
    (previous, current) => previous.add(current), toBN(0))
}

export interface ServerWorkdirs {
  workdir: string
  managerWorkdir: string
  workersWorkdir: string
}

export function getTemporaryWorkdirs (): ServerWorkdirs {
  const workdir = '/tmp/gsn/test/relayserver/defunct' + Date.now().toString()
  const managerWorkdir = workdir + '/manager'
  const workersWorkdir = workdir + '/workers'

  return {
    workdir,
    managerWorkdir,
    workersWorkdir
  }
}
