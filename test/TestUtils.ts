/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'

import { RelayHubInstance, StakeManagerInstance } from '../types/truffle-contracts'
import HttpWrapper from '../src/relayclient/HttpWrapper'
import HttpClient from '../src/relayclient/HttpClient'
import { configureGSN } from '../src/relayclient/GSNConfigurator'
import { ether } from '@openzeppelin/test-helpers'
import fs from 'fs'

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
  args.push('--Workdir', serverWorkDir)
  args.push('--DevMode')
  args.push('--RelayHubAddress', relayHubAddress)

  if (options.EthereumNodeUrl) {
    args.push('--EthereumNodeUrl', options.EthereumNodeUrl)
  }
  if (options.GasPricePercent) {
    args.push('--GasPricePercent', options.GasPricePercent)
  }
  if (options.pctRelayFee) {
    args.push('--PercentFee', options.pctRelayFee)
  }
  if (options.baseRelayFee) {
    args.push('--BaseFee', options.baseRelayFee)
  }
  const runServerPath = path.resolve(__dirname, '../src/relayserver/runServer.js')
  const proc: ChildProcessWithoutNullStreams = childProcess.spawn('node',
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
        relaylog(`died before init code=${code.toString()}`)
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
  await stakeManager.authorizeHub(relayManagerAddress, relayHubAddress, {
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

export async function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function stopRelay (proc: ChildProcessWithoutNullStreams): void {
  proc?.kill()
}

export async function registerNewRelay (
  {
    relayHub,
    stakeManager,
    stake,
    delay,
    baseRelayFee,
    pctRelayFee,
    url,
    relayManager,
    relayWorker,
    ownerAccount
  }: {
    relayHub: RelayHubInstance
    stakeManager: StakeManagerInstance
    stake: BN
    delay: number
    baseRelayFee: number
    pctRelayFee: number
    url: string
    relayManager: string
    relayWorker: string
    ownerAccount: string
  }): Promise<Truffle.TransactionResponse> {
  await stakeManager.stakeForAddress(relayManager, delay, {
    from: ownerAccount,
    value: stake
  })
  await stakeManager.authorizeHub(relayManager, relayHub.address, { from: ownerAccount })
  await relayHub.addRelayWorkers([relayWorker], { from: relayManager })
  return relayHub.registerRelayServer(baseRelayFee, pctRelayFee, url, { from: relayManager })
}

export async function increaseTime (time: number): Promise<void> {
  return new Promise((resolve, reject) => {
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
  return new Promise((resolve, reject) => {
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

export async function snapshot (): Promise<number> {
  return new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_snapshot',
      id: Date.now()
    }, (err: Error | null, snapshotId: number) => {
      if (err) { return reject(err) }
      return resolve(snapshotId)
    })
  })
}

export async function revert (id: number): Promise<void> {
  return new Promise((resolve, reject) => {
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

/**
 * If ganache is run without '-b' parameter, reverted transaction return
 * error message instantly. Otherwise, revert will only occur once 'evm_mine'
 * is executed, and the error will be generated by truffle.
 *
 * @param {*} error - returned by web3 from RPC call
 * @param {*} errorMessage - expected error message
 */
export function assertErrorMessageCorrect (error: Error, errorMessage: string): void {
  const blocktimeModeError = 'does not trigger a Solidity `revert` statement'
  if (!error || !error.message) {
    console.log('no error: ', error, 'expected:', errorMessage)
    // @ts-ignore
    assert.equals(errorMessage, error) // expected some error, got null
  }
  if (error.message.includes(errorMessage) || error.message.includes(blocktimeModeError)) { return }
  console.log('invalid error message: ' + error.message + '\n(expected: ' + errorMessage + ')')
  assert.ok(false, 'invalid error message: ' + error.message + '\n(expected: ' + errorMessage + ')')
}
