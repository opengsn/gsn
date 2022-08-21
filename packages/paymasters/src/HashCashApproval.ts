import { keccak256, toBN } from 'web3-utils'
import { RelayRequest } from '@opengsn/common'
import abi from 'web3-eth-abi'

import IForwarder from '@opengsn/common/dist/interfaces/IForwarder.json'

import HashcashDifficulty from '../build/contracts/HashcashPaymaster.json'

/**
 * low-level hashcash calculation for the given address and nonce
 * This value should be passed as approvalData for the HashcashPaymaster
 * @param senderAddress the address of the sender
 * @param senderNonce the current nonce of the sender
 * @param difficulty target difficulty to meet
 * @param interval call the callback every that many iterations
 * @param callback async callback to call. return "false" to abort. true to continue
 * @return the approvalData value (bytes32 hash, uint256 counter)
 */
export async function calculateHashcash (senderAddress: string, senderNonce: string, difficulty: any, interval?: number, callback?: any): Promise<string> {
  const diffMax = toBN(1).shln(256 - difficulty)
  let hashNonce = 0
  let intervalCount = 0
  while (true) {
    // @ts-ignore
    const params = abi.encodeParameters(['address', 'uint256', 'uint256'],
      [senderAddress, senderNonce, hashNonce])
    const hash = keccak256(params)
    const val = toBN(hash)
    if (val.lt(diffMax)) {
      if (callback != null) {
        await callback(difficulty) // signal "done"
      }
      // @ts-ignore
      return abi.encodeParameters(['bytes32', 'uint256'],
        [hash, hashNonce])
    }
    hashNonce++
    if (interval != null && intervalCount++ > interval) {
      intervalCount = 0
      const cbresp = await callback(difficulty, hashNonce)
      if (cbresp == null) { return '0x' }
    }
  }
}

/**
 * RelayProvider Helper: use to initialize
 * the asyncApprovalData, when using HashcashProvider.
 * NOTE: this will cause the method call to block until the calculation is finished.
 * @param difficulty level this hashcash instance requires. make sure this value is
 *  the same (or higher) as the provider requires, otherwise, you'll get a revert of
 *  "difficulty not met"
 *  @param interval call the callback function every that many iterations
 *  @param callback async callback to call. return false to abort calculation
 * @returns - an async function to pass as a parameter for "asyncApprovalData" of the
 *  RelayProvider. see the HashcashPaymaster.test.ts for usage example.
 */
export function createHashcashAsyncApproval (difficulty: any, interval?: number, callback?: any): (relayRequest: RelayRequest) => Promise<string> {
  return async function (relayRequest: RelayRequest): Promise<string> {
    console.log('=== calculating approval')
    const { from: senderAddress, nonce: senderNonce } = relayRequest.request
    const val = calculateHashcash(senderAddress, senderNonce, difficulty, interval, callback)
    console.log('=== done calculating approval')
    return await val
  }
}

// helper: call the "call()" method, and throw the given string in case of error
// (most likely - object doens't support this method..)
function checkedCall (method: any, str: string): any {
  try {
    return method.call()
  } catch (e) {
    console.log('==e', e)
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    throw new Error(str + ': ' + e)
  }
}

/**
 * calculate in advance async approval.
 * @param web3
 * @param senderAddr
 * @param recipientAddr the recipient address to use
 * @param forwarderAddress
 * @param hashcashPaymasterAddr the hashcash paymaster to work with
 * @param interval
 * @param callback
 */
export async function calculateHashcashApproval (web3: Web3, senderAddr: string, recipientAddr: string, forwarderAddress: string, hashcashPaymasterAddr?: string, interval?: number, callback?: any): Promise<string | null> {
  // @ts-ignore
  const paymaster = new web3.eth.Contract(HashcashDifficulty.abi, hashcashPaymasterAddr).methods
  const difficulty = await checkedCall(paymaster.difficulty(), hashcashPaymasterAddr ?? 'undefined' + ': not A HashcashPaymaster')
  // @ts-ignore
  const forwarder = new web3.eth.Contract(IForwarder, forwarderAddress).methods
  const nonce = await checkedCall(forwarder.getNonce(senderAddr), 'No getNonce()')

  console.log('calling with addr=', senderAddr, 'nonce=', nonce, 'fwd=', forwarderAddress, 'recipient=', recipientAddr)
  return await calculateHashcash(senderAddr, nonce, difficulty, interval, callback)
}
