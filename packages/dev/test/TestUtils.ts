/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'

import { ether } from '@openzeppelin/test-helpers'

import {
  StakeManagerInstance,
  RelayHubContract,
  RelayHubInstance,
  TestTokenInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { HttpWrapper } from '@opengsn/common/dist/HttpWrapper'
import { HttpClient } from '@opengsn/common/dist/HttpClient'
import { defaultGsnConfig, GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import { defaultEnvironment } from '@opengsn/common/dist/Environments'
import { PrefixedHexString } from 'ethereumjs-util'
import { isSameAddress, sleep } from '@opengsn/common/dist/Utils'
import { RelayHubConfiguration } from '@opengsn/common/dist/types/RelayHubConfiguration'
import { createServerLogger } from '@opengsn/relay/dist/ServerWinstonLogger'
import { Environment } from '@opengsn/common'
import { Address, IntString } from '@opengsn/common/dist/types/Aliases'
import { toBN } from 'web3-utils'

require('source-map-support').install({ errorFormatterForce: true })

const RelayHub = artifacts.require('RelayHub')
const RelayRegistrar = artifacts.require('RelayRegistrar')

const localhostOne = 'http://localhost:8090'

// start a background relay process.
// rhub - relay hub contract
// options:
//  stake, delay, pctRelayFee, url, relayOwner: parameters to pass to registerNewRelay, to stake and register it.
//
export async function startRelay (
  relayHubAddress: string,
  testToken: TestTokenInstance,
  stakeManager: StakeManagerInstance,
  options: any): Promise<ChildProcessWithoutNullStreams> {
  const args = []

  const serverWorkDir = '/tmp/gsn/test/server'

  fs.rmSync(serverWorkDir, {
    recursive: true,
    force: true
  })
  args.push('--workdir', serverWorkDir)
  args.push('--devMode')
  if (options.checkInterval) {
    args.push('--checkInterval', options.checkInterval)
  } else {
    args.push('--checkInterval', 100)
  }
  args.push('--logLevel', 'debug')
  args.push('--relayHubAddress', relayHubAddress)
  args.push('--managerStakeTokenAddress', testToken.address)
  const configFile = path.resolve(__dirname, './server-config.json')
  args.push('--config', configFile)
  args.push('--ownerAddress', options.relayOwner)
  if (options.loggingProvider) {
    args.push('--loggingProvider', options.loggingProvider)
  }
  if (options.confirmationsNeeded) {
    args.push('--confirmationsNeeded', options.confirmationsNeeded)
  }

  if (options.ethereumNodeUrl) {
    args.push('--ethereumNodeUrl', options.ethereumNodeUrl)
  }
  if (options.gasPriceFactor) {
    args.push('--gasPriceFactor', options.gasPriceFactor)
  }
  if (options.pctRelayFee) {
    args.push('--pctRelayFee', options.pctRelayFee)
  }
  if (options.baseRelayFee) {
    args.push('--baseRelayFee', options.baseRelayFee)
  }
  if (options.checkInterval) {
    args.push('--checkInterval', options.checkInterval)
  }
  if (options.initialReputation) {
    args.push('--initialReputation', options.initialReputation)
  }
  if (options.workerTargetBalance) {
    args.push('--workerTargetBalance', options.workerTargetBalance)
  }
  if (options.environmentName) {
    args.push('--environmentName', options.environmentName)
  }
  if (options.refreshStateTimeoutBlocks) {
    args.push('--refreshStateTimeoutBlocks', options.refreshStateTimeoutBlocks)
  }
  const runServerPath = path.resolve(__dirname, '../../relay/dist/runServer.js')
  const proc: ChildProcessWithoutNullStreams = childProcess.spawn('./node_modules/.bin/ts-node',
    [runServerPath, ...args])

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let relaylog = function (_: string): void {}
  if (options.relaylog) {
    relaylog = (msg: string) => msg.split('\n').forEach(line => console.log(`relay-${proc.pid!.toString()}> ${line}`))
  }

  await new Promise((resolve, reject) => {
    let lastresponse: string
    const listener = (data: any): void => {
      const str = data.toString().replace(/\s+$/, '')
      lastresponse = str
      relaylog(str)
      if (str.indexOf('Listening on port') >= 0) {
        // @ts-ignore
        proc.alreadystarted = 1
        resolve(proc)
      }
    }
    proc.stdout.on('data', listener)
    proc.stderr.on('data', listener)
    const doaListener = (code: Object): void => {
      // @ts-ignore
      if (!proc.alreadystarted) {
        relaylog(`died before init code=${JSON.stringify(code)}`)
        reject(new Error(lastresponse))
      }
    }
    proc.on('exit', doaListener.bind(proc))
  })

  const logger = createServerLogger('error', '', '')
  let res: any
  const http = new HttpClient(new HttpWrapper(), logger)
  let count1 = 3
  while (count1-- > 0) {
    try {
      res = await http.getPingResponse(localhostOne)
      if (res) break
    } catch (e) {
      console.log('startRelay getaddr error', e)
    }
    console.log('sleep before cont.')
    await sleep(1000)
  }
  assert.ok(res, 'can\'t ping server')
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  assert.ok(res.relayWorkerAddress, `server returned unknown response ${res.toString()}`)
  const relayManagerAddress = res.relayManagerAddress
  console.log('Relay Server Address', relayManagerAddress)
  // @ts-ignore
  await web3.eth.sendTransaction({
    to: relayManagerAddress,
    from: options.relayOwner,
    value: options.value ?? ether('2')
  })

  // TODO: this entire function is a logical duplicate of 'CommandsLogic::registerRelay'
  // now wait for server until it sets the owner on stake manager
  let i = 0
  while (true) {
    await sleep(100)
    const newStakeInfo = await stakeManager.getStakeInfo(relayManagerAddress)
    if (isSameAddress(newStakeInfo[0].owner, options.relayOwner)) {
      console.log('RelayServer successfully set its owner on the StakeManager')
      break
    }
    if (i++ === 5) {
      throw new Error('RelayServer failed to set its owner on the StakeManager')
    }
  }

  const amount = options.stake || ether('1')
  await stakeManager.stakeForRelayManager(testToken.address, relayManagerAddress, options.delay || 15000, amount, {
    from: options.relayOwner
  })
  await sleep(500)
  await stakeManager.authorizeHubByOwner(relayManagerAddress, relayHubAddress, {
    from: options.relayOwner
  })

  // now ping server until it "sees" the stake and funding, and gets "ready"
  res = ''
  let count = 25
  while (count-- > 0) {
    res = await http.getPingResponse(localhostOne)
    if (res?.ready) break
    await sleep(500)
  }
  assert.ok(res.ready, 'Timed out waiting for relay to get staked and registered')

  // TODO: this is temporary hack to make helper test work!!!
  // @ts-ignore
  proc.relayManagerAddress = relayManagerAddress
  return proc
}

export function stopRelay (proc: ChildProcessWithoutNullStreams): void {
  proc?.kill()
}

export async function increaseTime (time: number): Promise<void> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [time],
      id: Date.now()
    }, (err: Error | null) => {
      if (err) return reject(err)
      evmMine()
        .then((r: any) => resolve(r))
        .catch((e: Error) => reject(e))
    })
  })
}
export async function setNextBlockTimestamp (time: number | BN): Promise<void> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_setNextBlockTimestamp',
      params: [parseInt(time.toString())],
      id: Date.now()
    }, (e: Error | null, r: any) => {
      if (e) {
        reject(e)
      } else {
        resolve(r)
      }
    })
  })
}

export async function evmMineMany (count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await evmMine()
  }
}

export async function evmMine (): Promise<any> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      params: [],
      id: Date.now()
    }, (e: Error | null, r: any) => {
      if (e) {
        reject(e)
      } else {
        resolve(r)
      }
    })
  })
}

export async function snapshot (): Promise<{ id: number, jsonrpc: string, result: string }> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_snapshot',
      id: Date.now()
    }, (err: Error | null, snapshotId: { id: number, jsonrpc: string, result: string }) => {
      if (err) { return reject(err) }
      return resolve(snapshotId)
    })
  })
}

export async function revert (id: string): Promise<void> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_revert',
      params: [id],
      id: Date.now()
    }, (err: Error | null, result: any) => {
      if (err) { return reject(err) }
      return resolve(result)
    })
  })
}

// encode revert reason string as a byte error returned by revert(string)
export function encodeRevertReason (reason: string): PrefixedHexString {
  return web3.eth.abi.encodeFunctionCall({
    name: 'Error',
    type: 'function',
    inputs: [{ name: 'error', type: 'string' }]
  }, [reason])
  // return '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', reason))
}

export async function deployHub (
  stakeManager: string,
  penalizer: string,
  batchGateway: string,
  testToken: string,
  testTokenMinimumStake: IntString,
  configOverride: Partial<RelayHubConfiguration> = {},
  environment: Environment = defaultEnvironment,
  hubContract: any = undefined): Promise<RelayHubInstance> {
  const relayHubConfiguration: RelayHubConfiguration = {
    ...environment.relayHubConfiguration,
    ...configOverride
  }
  const HubContract: RelayHubContract = hubContract ?? RelayHub
  const hub: RelayHubInstance = await HubContract.new(
    stakeManager,
    penalizer,
    batchGateway,
    relayHubConfiguration)

  const relayRegistrar = await RelayRegistrar.new(hub.address, true)
  await hub.setRegistrar(relayRegistrar.address)
  await hub.setMinimumStakes([testToken], [testTokenMinimumStake])

  return hub
}

export function configureGSN (partialConfig: Partial<GSNConfig>): GSNConfig {
  return Object.assign({}, defaultGsnConfig, partialConfig) as GSNConfig
}

export async function emptyBalance (source: Address, target: Address): Promise<void> {
  const gasPrice = toBN(1e9)
  const txCost = toBN(defaultEnvironment.mintxgascost).mul(gasPrice)
  let balance = toBN(await web3.eth.getBalance(source))
  const transferValue = balance.sub(txCost)
  console.log('bal=', balance.toString(), 'xfer=', transferValue.toString())
  if (transferValue.gtn(0)) {
    await web3.eth.sendTransaction({ from: source, to: target, value: transferValue, gasPrice, gas: defaultEnvironment.mintxgascost })
  }
  balance = toBN(await web3.eth.getBalance(source))
  assert.isTrue(balance.eqn(0))
}

export function disableTruffleAutoEstimateGas (truffleContract: any): void {
  if (truffleContract.autoGas) {
    truffleContract.autoGas = false
  }
  truffleContract.defaults
  delete truffleContract.class_defaults.gas
}

/**
 * Not all "signatures" are valid, so using a hard-coded one for predictable error message.
 */
export const INCORRECT_ECDSA_SIGNATURE = '0xdeadface00000a58b757da7dea5678548be5ff9b16e9d1d87c6157aff6889c0f6a406289908add9ea6c3ef06d033a058de67d057e2c0ae5a02b36854be13b0731c'
