import BN from 'bn.js'
import abi from 'web3-eth-abi'
import web3Utils, { toWei } from 'web3-utils'
import { EventData } from 'web3-eth-contract'
import { JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString, Transaction, TransactionOptions } from 'ethereumjs-tx'
import { bufferToHex, bufferToInt, ecrecover, pubToAddress, stripZeros, toBuffer } from 'ethereumjs-util'

import { Address } from './types/Aliases'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'

import TypedRequestData from './EIP712/TypedRequestData'
import chalk from 'chalk'
import { encode } from 'rlp'

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

export function event2topic (contract: any, names: any): any {
  // for testing: don't crash on mockup..
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!contract.options || !contract.options.jsonInterface) { return names }
  if (typeof names === 'string') {
    return event2topic(contract, [names])[0]
  }
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

export async function getEip712Signature (
  web3: Web3,
  typedRequestData: TypedRequestData,
  methodSuffix = '',
  jsonStringifyRequest = false
): Promise<PrefixedHexString> {
  const senderAddress = typedRequestData.message.from
  let dataToSign: TypedRequestData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
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
    method.bind(web3.currentProvider)({
      method: 'eth_signTypedData' + methodSuffix,
      params: [senderAddress, dataToSign],
      from: senderAddress,
      id: Date.now()
    }, (error: Error | string | null, result?: JsonRpcResponse) => {
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
 * @returns maximum possible gas consumption by this relayed call
 */
export function calculateTransactionMaxPossibleGas (
  {
    gasLimits,
    hubOverhead,
    relayCallGasLimit
  }: TransactionGasComponents): number {
  return hubOverhead +
    parseInt(relayCallGasLimit) +
    parseInt(gasLimits.preRelayedCallGasLimit) +
    parseInt(gasLimits.postRelayedCallGasLimit)
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

export function isSecondEventLater (a: EventData, b: EventData): boolean {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex > a.transactionIndex
  }
  return b.blockNumber > a.blockNumber
}

export function getLatestEventData (events: EventData[]): EventData | undefined {
  if (events.length === 0) {
    return
  }
  const eventDataSorted = events.sort(
    (a: EventData, b: EventData) => {
      if (a.blockNumber === b.blockNumber) {
        return b.transactionIndex - a.transactionIndex
      }
      return b.blockNumber - a.blockNumber
    })
  return eventDataSorted[0]
}

export function isRegistrationValid (registerEvent: EventData | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
  return registerEvent != null &&
    isSameAddress(registerEvent.returnValues.relayManager, managerAddress) &&
    registerEvent.returnValues.baseRelayFee.toString() === config.baseRelayFee.toString() &&
    registerEvent.returnValues.pctRelayFee.toString() === config.pctRelayFee.toString() &&
    registerEvent.returnValues.relayUrl.toString() === config.url.toString()
}

/**
 * @param gasLimits
 * @param hubOverhead
 * @param relayCallGasLimit
 * @param calldataSize
 * @param gtxdatanonzero
 */
interface TransactionGasComponents {
  gasLimits: PaymasterGasLimits
  hubOverhead: number
  relayCallGasLimit: string
}

export interface PaymasterGasLimits {
  acceptanceBudget: string
  preRelayedCallGasLimit: string
  postRelayedCallGasLimit: string
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
  const input = [tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data]
  input.push(
    toBuffer(chainId),
    stripZeros(toBuffer(0)),
    stripZeros(toBuffer(0))
  )
  let vInt = bufferToInt(tx.v)
  if (vInt > 28) {
    vInt -= chainId * 2 + 8
  }
  const data = `0x${encode(input).toString('hex')}`
  const r = tx.r.toString('hex').padStart(64, '0')
  const s = tx.s.toString('hex').padStart(64, '0')
  const v = vInt.toString(16).padStart(2, '0')
  const signature = `0x${r}${s}${v}`
  return {
    data,
    signature
  }
}

export function signedTransactionToHash (signedTransaction: PrefixedHexString, transactionOptions: TransactionOptions): PrefixedHexString {
  return bufferToHex(new Transaction(signedTransaction, transactionOptions).hash())
}
