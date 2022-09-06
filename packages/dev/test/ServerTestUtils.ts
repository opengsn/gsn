// @ts-ignore
import abiDecoder from 'abi-decoder'
import { TransactionReceipt } from 'web3-core'
import { toBN } from 'web3-utils'

import PayMasterABI from '@opengsn/common/dist/interfaces/IPaymaster.json'
import RelayHubABI from '@opengsn/common/dist/interfaces/IRelayHub.json'
import RelayRegistrarABI from '@opengsn/common/dist/interfaces/IRelayRegistrar.json'
import StakeManagerABI from '@opengsn/common/dist/interfaces/IStakeManager.json'
import { RelayServer } from '@opengsn/relay/dist/RelayServer'
import { PrefixedHexString } from 'ethereumjs-util'
import { packRelayUrlForRegistrar } from '@opengsn/common'

const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
abiDecoder.addABI(RelayRegistrarABI)
// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)

async function resolveAllReceipts (transactionHashes: PrefixedHexString[]): Promise<TransactionReceipt[]> {
  // actually returns promise for '.all'
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return await Promise.all(transactionHashes.map((transactionHash) => web3.eth.getTransactionReceipt(transactionHash)))
}

export async function assertRelayAdded (
  transactionHashes: PrefixedHexString[],
  server: RelayServer,
  checkWorkers = true,
  checkPrivate = false
): Promise<void> {
  const receipts = await resolveAllReceipts(transactionHashes)
  const registeredReceipt = receipts.find(r => {
    const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
    return decodedLogs.find((it: any) => it.name === 'RelayServerRegistered') != null
  })
  if (registeredReceipt == null) {
    throw new Error('Registered Receipt not found')
  }
  const registeredLog = abiDecoder
    .decodeLogs(registeredReceipt.logs)
    .map(server.registrationManager._parseEvent)
    .find((it: any) => it.name === 'RelayServerRegistered')
  assert.isNotNull(registeredLog)
  assert.equal(registeredLog.name, 'RelayServerRegistered')
  assert.equal(registeredLog.args.relayManager.toLowerCase(), server.managerAddress.toLowerCase())
  if (checkPrivate) {
    assert.notEqual(server.config.url.length, 0, 'cannot check private mode without URL in configuration')
    assert.equal(packRelayUrlForRegistrar(registeredLog.args.relayUrl), '')
  } else {
    assert.equal(packRelayUrlForRegistrar(registeredLog.args.relayUrl), server.config.url)
  }
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

export async function getTotalTxCosts (transactionHashes: PrefixedHexString[], gasPrice: string): Promise<BN> {
  const receipts = await resolveAllReceipts(transactionHashes)
  // @ts-ignore
  return receipts.map(r => toBN(r.gasUsed).mul(toBN(r.effectiveGasPrice))).reduce(
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
