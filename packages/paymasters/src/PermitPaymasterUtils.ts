import Web3 from 'web3'
import { PrefixedHexString, fromRpcSig, bufferToHex, keccakFromString } from 'ethereumjs-util'
import { getEip712Signature, TruffleContract, Address, IntString } from '@opengsn/common'
import { TypedMessage } from '@metamask/eth-sig-util'

import {
  EIP712Domain,
  EIP712DomainType,
  MessageTypeProperty,
  MessageTypes
} from '@opengsn/common/dist/EIP712/TypedRequestData'

import daiPermitAbi from './interfaces/PermitInterfaceDAI.json'
import eip2612PermitAbi from './interfaces/PermitInterfaceEIP2612.json'
import BN from 'bn.js'

export const PERMIT_SIGNATURE_DAI = 'permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'
export const PERMIT_SIGNATURE_EIP2612 = 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'
export const PERMIT_CALLDATA_MAX_LEN = 280 // address + address + uint256 + uint256 + bool? + uint8 + bytes32 + bytes32 == at most 8 * 32 == 256
export const MAX_PAYMASTERDATA_LENGTH = PERMIT_CALLDATA_MAX_LEN + 20 // optional permit calldata plus token address
export const PERMIT_SIGHASH_DAI = bufferToHex(keccakFromString(PERMIT_SIGNATURE_DAI).slice(0, 4))
export const PERMIT_SIGHASH_EIP2612 = bufferToHex(keccakFromString(PERMIT_SIGNATURE_EIP2612).slice(0, 4))

interface Types extends MessageTypes{
  EIP712Domain: MessageTypeProperty[]
  Permit: MessageTypeProperty[]
}

// TODO: for now, 'from' field can be thrown in without exception raised by Metamask
//  this makes it compatible with old 'getEip712Signature' (used in too many tests)
export interface PermitInterfaceDAI {
  from: Address
  holder: Address
  spender: Address
  nonce: IntString
  expiry: IntString
  allowed: boolean
}

export interface PermitInterfaceEIP2612 {
  from: Address
  owner: Address
  spender: Address
  nonce: IntString
  deadline: IntString
  value: IntString
}

export interface PaymasterConfig {
  weth: string
  tokens: string[]
  relayHub: string
  priceFeeds: string[]
  uniswap: string
  trustedForwarder: string
  uniswapPoolFees: number[] | BN[] | string[]
  slippages: number[] | BN[] | string[]
  gasUsedByPost: number | BN | string
  permitMethodSignatures: string[]
  minHubBalance: number | BN | string
  targetHubBalance: number | BN | string
  minWithdrawalAmount: number | BN | string
  minSwapAmount: number | BN | string
  paymasterFee: number | BN | string
}

// currently not imposing any limitations on how the 'Permit' type can look like
export type PermitType = MessageTypeProperty[]

export const PermitTypeDai: PermitType = [
  { name: 'holder', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'allowed', type: 'bool' }
]

export const PermitTypeEIP2612: PermitType = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' }
]

export class TypedPermit implements TypedMessage<Types> {
  readonly types: Types
  readonly domain: EIP712Domain
  readonly primaryType: string
  readonly message: any

  constructor (
    chainId: number,
    permitType: PermitType,
    domain: EIP712Domain,
    permit: PermitInterfaceDAI | PermitInterfaceEIP2612,
    eip712DomainType: MessageTypeProperty[] = EIP712DomainType) {
    this.types = {
      EIP712Domain: eip712DomainType,
      Permit: permitType
    }
    this.domain = domain
    this.primaryType = 'Permit'
    // in the signature, all "request" fields are flattened out at the top structure.
    // other params are inside "relayData" sub-type
    this.message = {
      ...permit
    }
  }
}

export async function signAndEncodeDaiPermit (
  holder: Address,
  spender: Address,
  token: Address,
  expiry: IntString,
  web3Input: Web3,
  domainSeparator: EIP712Domain,
  forceNonce?: number,
  skipValidation = false
): Promise<PrefixedHexString> {
  const web3 = new Web3(web3Input.currentProvider)
  const DaiContract = TruffleContract({
    contractName: 'DAIPermitInterface',
    abi: daiPermitAbi
  })

  DaiContract.setProvider(web3.currentProvider, undefined)
  const daiInstance = await DaiContract.at(token)
  const nonce = forceNonce ?? await daiInstance.nonces(holder)
  const chainId = await web3.eth.getChainId()
  const permit: PermitInterfaceDAI = {
    // TODO: not include holder as 'from', not pass 'from'
    from: holder,
    holder,
    spender,
    nonce,
    expiry,
    allowed: true
  }
  const dataToSign = new TypedPermit(
    chainId,
    PermitTypeDai,
    domainSeparator,
    permit
  )
  const signature = await getEip712Signature(
    web3,
    dataToSign
  )
  const { r, s, v } = fromRpcSig(signature)
  // we use 'estimateGas' to check against the permit method revert (hard to debug otherwise)
  if (!skipValidation) {
    await daiInstance.contract.methods.permit(holder, spender, nonce, expiry, true, v, r, s).estimateGas()
  }
  return daiInstance.contract.methods.permit(holder, spender, nonce, expiry, true, v, r, s).encodeABI()
}

export async function signAndEncodeEIP2612Permit (
  owner: Address,
  spender: Address,
  token: Address,
  value: string,
  deadline: string,
  web3Input: Web3,
  domainSeparator: EIP712Domain,
  domainType?: MessageTypeProperty[],
  forceNonce?: number,
  skipValidation = false
): Promise<PrefixedHexString> {
  const web3 = new Web3(web3Input.currentProvider)
  const EIP2612Contract = TruffleContract({
    contractName: 'EIP2612Contract',
    abi: eip2612PermitAbi
  })

  EIP2612Contract.setProvider(web3.currentProvider, undefined)
  const eip2612TokenInstance = await EIP2612Contract.at(token)
  const nonce = forceNonce ?? await eip2612TokenInstance.nonces(owner)
  const chainId = await web3.eth.getChainId()
  const permit: PermitInterfaceEIP2612 = {
    // TODO: not include holder as 'from', not pass 'from'
    from: owner,
    owner,
    spender,
    nonce: nonce.toString(),
    deadline,
    value
  }
  const dataToSign = new TypedPermit(
    chainId,
    PermitTypeEIP2612,
    domainSeparator,
    permit,
    domainType
  )
  const signature = await getEip712Signature(
    web3,
    dataToSign
  )
  const { r, s, v } = fromRpcSig(signature)
  // we use 'estimateGas' to check against the permit method revert (hard to debug otherwise)
  if (!skipValidation) {
    await eip2612TokenInstance.contract.methods.permit(owner, spender, value, deadline, v, r, s).estimateGas()
  }
  return eip2612TokenInstance.contract.methods.permit(owner, spender, value, deadline, v, r, s).encodeABI()
}
