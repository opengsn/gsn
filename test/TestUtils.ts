/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'

import { constants, ether } from '@openzeppelin/test-helpers'

import { RelayHubInstance, StakeManagerInstance } from '../types/truffle-contracts'
import HttpWrapper from '../src/relayclient/HttpWrapper'
import HttpClient from '../src/relayclient/HttpClient'
import { configureGSN } from '../src/relayclient/GSNConfigurator'
import { defaultEnvironment } from '../src/common/Environments'
import { PrefixedHexString } from 'ethereumjs-tx'
import { sleep } from '../src/common/Utils'
import { RelayHubConfiguration } from '../src/relayclient/types/RelayHubConfiguration'

require('source-map-support').install({ errorFormatterForce: true })

const RelayHub = artifacts.require('RelayHub')

const localhostOne = 'http://localhost:8090'

// start a background relay process.
// rhub - relay hub contract
// options:
//  stake, delay, pctRelayFee, url, relayOwner: parameters to pass to registerNewRelay, to stake and register it.
//
export async function startRelay (
  relayHubAddress: string,
  stakeManager: StakeManagerInstance,
  options: any): Promise<ChildProcessWithoutNullStreams> {
  const args = []

  const serverWorkDir = '/tmp/gsn/test/server'

  fs.rmdirSync(serverWorkDir, { recursive: true })
  args.push('--workdir', serverWorkDir)
  args.push('--devMode')
  args.push('--relayHubAddress', relayHubAddress)
  const configFile = path.resolve(__dirname, './server-config.json')
  args.push('--config', configFile)
  if (options.ethereumNodeUrl) {
    args.push('--ethereumNodeUrl', options.ethereumNodeUrl)
  }
  if (options.gasPricePercent) {
    args.push('--gasPricePercent', options.gasPricePercent)
  }
  if (options.pctRelayFee) {
    args.push('--pctRelayFee', options.pctRelayFee)
  }
  if (options.baseRelayFee) {
    args.push('--baseRelayFee', options.baseRelayFee)
  }
  const runServerPath = path.resolve(__dirname, '../src/relayserver/runServer.ts')
  const proc: ChildProcessWithoutNullStreams = childProcess.spawn('./node_modules/.bin/ts-node',
    [runServerPath, ...args])

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let relaylog = function (_: string): void {}
  if (options.relaylog) {
    relaylog = (msg: string) => msg.split('\n').forEach(line => console.log(`relay-${proc.pid.toString()}> ${line}`))
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

  let res: any
  const http = new HttpClient(new HttpWrapper(), configureGSN({}))
  let count1 = 3
  while (count1-- > 0) {
    try {
      res = await http.getPingResponse(localhostOne)
      if (res) break
    } catch (e) {
      console.log('startRelay getaddr error', e)
    }
    console.log('sleep before cont.')
    await module.exports.sleep(1000)
  }
  assert.ok(res, 'can\'t ping server')
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  assert.ok(res.RelayServerAddress, `server returned unknown response ${res.toString()}`)
  const relayManagerAddress = res.RelayManagerAddress
  console.log('Relay Server Address', relayManagerAddress)
  // @ts-ignore
  await web3.eth.sendTransaction({
    to: relayManagerAddress,
    from: options.relayOwner,
    value: ether('2')
  })

  await stakeManager.stakeForAddress(relayManagerAddress, options.delay || 2000, {
    from: options.relayOwner,
    value: options.stake || ether('1')
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
    if (res?.Ready) break
    await sleep(500)
  }
  assert.ok(res.Ready, 'Timed out waiting for relay to get staked and registered')

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
      module.exports.evmMine()
        .then((r: any) => resolve(r))
        .catch((e: Error) => reject(e))
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

// encode revert reason string as a byte error returned by revert(stirng)
export function encodeRevertReason (reason: string): PrefixedHexString {
  return web3.eth.abi.encodeFunctionCall({
    name: 'Error',
    type: 'function',
    inputs: [{ name: 'error', type: 'string' }]
  }, [reason])
  // return '0x08c379a0' + removeHexPrefix(web3.eth.abi.encodeParameter('string', reason))
}

export async function deployHub (
  stakeManager: string = constants.ZERO_ADDRESS,
  penalizer: string = constants.ZERO_ADDRESS,
  configOverride: Partial<RelayHubConfiguration> = {}): Promise<RelayHubInstance> {
  const relayHubConfiguration: RelayHubConfiguration = {
    ...defaultEnvironment.relayHubConfiguration,
    ...configOverride
  }
  return await RelayHub.new(
    stakeManager,
    penalizer,
    relayHubConfiguration.maxWorkerCount,
    relayHubConfiguration.gasReserve,
    relayHubConfiguration.postOverhead,
    relayHubConfiguration.gasOverhead,
    relayHubConfiguration.maximumRecipientDeposit,
    relayHubConfiguration.minimumUnstakeDelay,
    relayHubConfiguration.minimumStake)
}

/**
 * Not all "signatures" are valid, so using a hard-coded one for predictable error message.
 */
export const INCORRECT_ECDSA_SIGNATURE = '0xdeadface00000a58b757da7dea5678548be5ff9b16e9d1d87c6157aff6889c0f6a406289908add9ea6c3ef06d033a058de67d057e2c0ae5a02b36854be13b0731c'
