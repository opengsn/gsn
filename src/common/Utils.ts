import { JsonRpcResponse } from 'web3-core-helpers'
import ethUtils, { stripZeros, toBuffer } from 'ethereumjs-util'
import web3Utils, { toWei, toBN } from 'web3-utils'
import abi from 'web3-eth-abi'
import { Transaction as Web3Transaction } from 'web3-core'

import TypedRequestData from './EIP712/TypedRequestData'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'
import { Address } from '../relayclient/types/Aliases'
import { EventData } from 'web3-eth-contract'
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
export function decodeRevertReason (revertBytes: PrefixedHexString, throwOnError = false): string {
  if (!revertBytes.startsWith('0x08c379a0')) {
    if (throwOnError) {
      throw new Error('invalid revert bytes: ' + revertBytes)
    }
    return revertBytes
  }
  return web3.eth.abi.decodeParameter('string', '0x' + revertBytes.slice(10)) as any
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
    }, (error: Error | null, result?: JsonRpcResponse) => {
      if (error != null || result == null) {
        reject(error)
      } else {
        resolve(result.result)
      }
    })
  })
}

export async function getDataAndSignatureFromHash (txHash: string, chainId: number): Promise<{ data: string, signature: string }> {
  const web3Tx = await web3.eth.getTransaction(txHash)
  // eslint: this is stupid how many checks for 0 there are
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!chainId && parseInt(web3Tx.v, 16) > 28) {
    throw new Error('Missing ChainID for EIP-155 signature')
  }
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (chainId && parseInt(web3Tx.v, 16) <= 28) {
    throw new Error('Passed ChainID for non-EIP-155 signature')
  }
  // @ts-ignore
  const tx = web3TransactionToEthUtilTransaction(web3Tx)

  return getDataAndSignature(tx, chainId)
}

export function getDataAndSignature (tx: Transaction, chainId: number): { data: string, signature: string } {
  const input = [tx.nonce, tx.gasPrice, tx.gasLimit, tx.to, tx.value, tx.data]
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (chainId) {
    input.push(
      toBuffer(chainId),
      stripZeros(toBuffer(0)),
      stripZeros(toBuffer(0))
    )
  }
  let v = tx.v[0]
  if (v > 28) {
    v -= chainId * 2 + 8
  }
  const data = `0x${encode(input).toString('hex')}`
  const signature = `0x${'00'.repeat(32 - tx.r.length) + tx.r.toString('hex')}${'00'.repeat(
    32 - tx.s.length) + tx.s.toString('hex')}${v.toString(16)}`
  return {
    data,
    signature
  }
}

export function web3TransactionToEthUtilTransaction (web3Tx: Web3Transaction): Transaction {
  // @ts-ignore
  const tx = new Transaction({
    nonce: toBN(web3Tx.nonce),
    gasPrice: toBN(web3Tx.gasPrice),
    gasLimit: toBN(web3Tx.gas),
    to: web3Tx.to,
    value: toBN(web3Tx.value),
    data: web3Tx.input,
    // @ts-ignore
    v: web3Tx.v,
    // @ts-ignore
    r: web3Tx.r,
    // @ts-ignore
    s: web3Tx.s
  })
  return tx
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
  const recoveredPubKey = ethUtils.ecrecover(bufSigned, signature.v[0], Buffer.from(signature.r), Buffer.from(signature.s))
  return ethUtils.bufferToHex(ethUtils.pubToAddress(recoveredPubKey))
}

export function parseHexString (str: string): number[] {
  var result = []
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
  return toBN(toWei(n, 'ether'))
}

export function randomInRange (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min)
}

export function reduceToLatestTx (events: EventData[]): EventData | undefined {
  if (events.length === 0) {
    return
  }
  return events
    .reduce(
      (b1, b2) => {
        if (b1.blockNumber === b2.blockNumber) {
          return b1.transactionIndex > b2.transactionIndex ? b1 : b2
        }
        return b1.blockNumber > b2.blockNumber ? b1 : b2
      })
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

interface PaymasterGasLimits {
  acceptanceBudget: string
  preRelayedCallGasLimit: string
  postRelayedCallGasLimit: string
}

interface Signature {
  v: number[]
  r: number[]
  s: number[]
}
