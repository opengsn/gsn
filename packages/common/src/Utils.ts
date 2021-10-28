import BN from 'bn.js'
import abi from 'web3-eth-abi'
import web3Utils, { toWei } from 'web3-utils'
import { EventData } from 'web3-eth-contract'
import { JsonRpcResponse } from 'web3-core-helpers'
import { Transaction, TxOptions } from '@ethereumjs/tx'
import {
  PrefixedHexString,
  bufferToHex,
  ecrecover,
  pubToAddress,
  toBuffer,
  unpadBuffer,
  bnToUnpaddedBuffer
} from 'ethereumjs-util'

import { Address } from './types/Aliases'

import chalk from 'chalk'
import { encode, List } from 'rlp'
import { EIP712TypedData } from 'eth-sig-util'
import { RelayRequest } from './EIP712/RelayRequest'
import Web3 from 'web3'

export const ValidHexString = /^0x[a-f0-9]*$/

export function removeHexPrefix (hex: string): string {
  if (hex == null || typeof hex.replace !== 'function') {
    throw new Error('Cannot remove hex prefix')
  }
  return hex.replace(/^0x/, '')
}

const zeroPad = '0000000000000000000000000000000000000000000000000000000000000000'

export function padTo64 (hex: string): string {
  if (hex.length < 64) {
    hex = (zeroPad + hex).slice(-64)
  }
  return hex
}

export function signatureRSV2Hex (r: BN | Buffer, s: BN | Buffer, v: number): string {
  return '0x' + padTo64(r.toString('hex')) + padTo64(s.toString('hex')) + v.toString(16).padStart(2, '0')
}

export function event2topic (contract: any, names: string[]): any {
  // for testing: don't crash on mockup..
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!contract.options || !contract.options.jsonInterface) { return names }
  return contract.options.jsonInterface
    .filter((e: any) => names.includes(e.name))
    // @ts-ignore
    .map(abi.encodeEventSignature)
}

export function addresses2topics (addresses: string[]): string[] {
  return addresses.map(address2topic)
}

export function address2topic (address: string): string {
  return '0x' + '0'.repeat(24) + address.toLowerCase().slice(2)
}

// extract revert reason from a revert bytes array.
export function decodeRevertReason (revertBytes: PrefixedHexString, throwOnError = false): string | null {
  if (revertBytes == null) { return null }
  if (!revertBytes.startsWith('0x08c379a0')) {
    if (throwOnError) {
      throw new Error('invalid revert bytes: ' + revertBytes)
    }
    return revertBytes
  }
  // @ts-ignore
  return abi.decodeParameter('string', '0x' + revertBytes.slice(10)) as any
}

export async function getDefaultMethodSuffix (web3: Web3): Promise<string> {
  const nodeInfo = await web3.eth.getNodeInfo()
  // ganache-cli
  if (nodeInfo.toLowerCase().includes('testrpc')) return ''
  // hardhat
  if (nodeInfo.toLowerCase().includes('hardhat')) return '_v4'
  // all other networks
  return '_v4'
}

export async function getEip712Signature (
  senderAddress: Address,
  web3: Web3,
  typedRequestData: EIP712TypedData,
  methodSuffix: string | null = null,
  jsonStringifyRequest = false
): Promise<PrefixedHexString> {
  let dataToSign: EIP712TypedData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
  methodSuffix = methodSuffix ?? await getDefaultMethodSuffix(web3)
  return await new Promise((resolve, reject) => {
    let method
    // @ts-ignore (the entire web3 typing is fucked up)
    if (typeof web3.currentProvider.sendAsync === 'function') {
      // @ts-ignore
      method = web3.currentProvider.sendAsync
    } else {
      // @ts-ignore
      method = web3.currentProvider.send
    }
    const paramBlock = {
      method: `eth_signTypedData${methodSuffix}`,
      params: [senderAddress, dataToSign],
      jsonrpc: '2.0',
      id: Date.now()
    }
    method.bind(web3.currentProvider)(paramBlock, (error: Error | string | null, result?: JsonRpcResponse) => {
      if (result?.error != null) {
        error = result.error
      }
      if (error != null || result == null) {
        reject((error as any).message ?? error)
      } else {
        resolve(result.result)
      }
    })
  })
}

/**
 * @param calldata the hex string of data to be sent to the blockchain
 * @returns { calldataZeroBytes, calldataNonzeroBytes } - number of zero and nonzero bytes in the given calldata input
 */
export function calculateCalldataBytesZeroNonzero (
  calldata: PrefixedHexString
): { calldataZeroBytes: number, calldataNonzeroBytes: number } {
  const calldataBuf = Buffer.from(calldata.replace('0x', ''), 'hex')
  let calldataZeroBytes = 0
  let calldataNonzeroBytes = 0
  calldataBuf.forEach(ch => {
    ch === 0 ? calldataZeroBytes++ : calldataNonzeroBytes++
  })
  return { calldataZeroBytes, calldataNonzeroBytes }
}

export function getEcRecoverMeta (message: PrefixedHexString, signature: string | Signature): PrefixedHexString {
  if (typeof signature === 'string') {
    const r = parseHexString(signature.substr(2, 65))
    const s = parseHexString(signature.substr(66, 65))
    const v = parseHexString(signature.substr(130, 2))

    signature = {
      v: v,
      r: r,
      s: s
    }
  }
  const msg = Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n32'), Buffer.from(removeHexPrefix(message), 'hex')])
  const signed = web3Utils.sha3('0x' + msg.toString('hex'))
  if (signed == null) {
    throw new Error('web3Utils.sha3 failed somehow')
  }
  const bufSigned = Buffer.from(removeHexPrefix(signed), 'hex')
  const recoveredPubKey = ecrecover(bufSigned, signature.v[0], Buffer.from(signature.r), Buffer.from(signature.s))
  return bufferToHex(pubToAddress(recoveredPubKey))
}

export function parseHexString (str: string): number[] {
  const result = []
  while (str.length >= 2) {
    result.push(parseInt(str.substring(0, 2), 16))

    str = str.substring(2, str.length)
  }

  return result
}

export function isSameAddress (address1: Address, address2: Address): boolean {
  return address1.toLowerCase() === address2.toLowerCase()
}

export async function sleep (ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

export function ether (n: string): BN {
  return new BN(toWei(n, 'ether'))
}

export function randomInRange (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min)
}

export function eventsComparator (a: EventData, b: EventData): number {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex - a.transactionIndex
  }
  return b.blockNumber - a.blockNumber
}

export function isSecondEventLater (a: EventData, b: EventData): boolean {
  return eventsComparator(a, b) > 0
}

export function getLatestEventData (events: EventData[]): EventData | undefined {
  if (events.length === 0) {
    return
  }
  const eventDataSorted = events.sort(eventsComparator)
  return eventDataSorted[0]
}

export interface PaymasterGasAndDataLimits {
  acceptanceBudget: BN
  preRelayedCallGasLimit: BN
  postRelayedCallGasLimit: BN
  calldataSizeLimit: BN
}

interface Signature {
  v: number[]
  r: number[]
  s: number[]
}

export function boolString (bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14))
}

export function getDataAndSignature (tx: Transaction, chainId: number): { data: string, signature: string } {
  if (tx.to == null) {
    throw new Error('tx.to must be defined')
  }
  if (tx.s == null || tx.r == null || tx.v == null) {
    throw new Error('tx signature must be defined')
  }
  const input: List = [bnToUnpaddedBuffer(tx.nonce), bnToUnpaddedBuffer(tx.gasPrice), bnToUnpaddedBuffer(tx.gasLimit), tx.to.toBuffer(), bnToUnpaddedBuffer(tx.value), tx.data]
  input.push(
    toBuffer(chainId),
    unpadBuffer(toBuffer(0)),
    unpadBuffer(toBuffer(0))
  )
  let vInt = tx.v.toNumber()
  if (vInt > 28) {
    vInt -= chainId * 2 + 8
  }
  const data = `0x${encode(input).toString('hex')}`
  const signature = signatureRSV2Hex(tx.r, tx.s, vInt)
  return {
    data,
    signature
  }
}

export function signedTransactionToHash (signedTransaction: PrefixedHexString, transactionOptions: TxOptions): PrefixedHexString {
  return bufferToHex(Transaction.fromSerializedTx(toBuffer(signedTransaction), transactionOptions).hash())
}

export const RelayRequestABITupleType = 'tuple(tuple(address,address,uint256,uint256,uint256,bytes,uint256),tuple(uint256,uint256,uint256,uint256,address,address,address,bytes,uint256))'

export function abiTupleRelayRequest (relayRequest: RelayRequest): any[] {
  return [
    [
      relayRequest.request.from,
      relayRequest.request.to,
      relayRequest.request.value,
      relayRequest.request.gas,
      relayRequest.request.nonce,
      relayRequest.request.data,
      relayRequest.request.validUntil
    ],
    [
      relayRequest.relayData.gasPrice,
      relayRequest.relayData.pctRelayFee,
      relayRequest.relayData.baseRelayFee,
      relayRequest.relayData.transactionCalldataGasUsed,
      relayRequest.relayData.relayWorker,
      relayRequest.relayData.paymaster,
      relayRequest.relayData.forwarder,
      relayRequest.relayData.paymasterData,
      relayRequest.relayData.clientId
    ]
  ]
}

export function abiEncodeRelayRequest (relayRequest: RelayRequest): PrefixedHexString {
  const web3 = new Web3()
  const types = [RelayRequestABITupleType]
  const parameters = [abiTupleRelayRequest(relayRequest)]
  return web3.eth.abi.encodeParameters(types, parameters)
}

export function getRelayRequestID (relayRequest: RelayRequest, signature: PrefixedHexString = '0x'): PrefixedHexString {
  const types = ['address', 'uint256', 'bytes']
  const parameters = [relayRequest.request.from, relayRequest.request.nonce, signature]
  return web3.utils.keccak256(web3.eth.abi.encodeParameters(types, parameters))
}
