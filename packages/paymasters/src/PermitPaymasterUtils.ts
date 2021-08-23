import Web3 from 'web3'
import { PrefixedHexString, fromRpcSig } from 'ethereumjs-util'
import { getEip712Signature, TruffleContract } from '@opengsn/common'
import { EIP712Domain, EIP712TypedData, EIP712TypeProperty, EIP712Types } from 'eth-sig-util'

import { Address, IntString } from '@opengsn/common/dist/types/Aliases'
import { EIP712DomainType } from '@opengsn/common/dist/EIP712/TypedRequestData'

import daiPermitAbi from '../build/contracts/PermitInterfaceDAI.json'
import eip2612PermitAbi from '../build/contracts/PermitInterfaceEIP2612.json'

export const DAI_CONTRACT_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
export const WETH9_CONTRACT_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const UNI_CONTRACT_ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'

// USD Coin 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 false true
// Uniswap 0x1f9840a85d5af5bf1d1762f925bdaddc4201f984 true true
// Graph Token 0xc944e90c64b2c07662a292be6244bdf05cda44a7 true true
// Dai Stablecoin 0x6b175474e89094c44da98b954eedeac495271d0f true true
// renBTC 0xeb4c2781e4eba804ce9a9803c67d0893436bb27d false true
// Aave interest bearing CRV 0x8dae6cb04688c62d939ed9b68d32bc62e49970b1 false true
// Balancer 0xba100000625a3754423978a60c9317c58a424e3d false true
// 1INCH Token 0x111111111117dc0aa78b770fa6a738034120c302 false true

export const UNISWAP_V3_QUOTER_CONTRACT_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
export const SWAP_ROUTER_CONTRACT_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
export const GSN_FORWARDER_CONTRACT_ADDRESS = '0xAa3E82b4c4093b4bA13Cb5714382C99ADBf750cA'
export const UNISWAP_V3_DAI_WETH_POOL_CONTRACT_ADDRESS = '0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8'

// price is approximate so USD can be used for any of the US Dollar stablecoins
export const CHAINLINK_USD_ETH_FEED_CONTRACT_ADDRESS = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
export const CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS = '0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e'

export const PERMIT_SIGNATURE_DAI = 'permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'
export const PERMIT_SIGNATURE_EIP2612 = 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'

export function getDaiDomainSeparator (): EIP712Domain {
  return {
    name: 'Dai Stablecoin',
    version: '1',
    chainId: 1,
    verifyingContract: DAI_CONTRACT_ADDRESS
  }
}

export function getUniDomainSeparator (): EIP712Domain {
  return {
    name: 'Uniswap',
    chainId: 1,
    verifyingContract: UNI_CONTRACT_ADDRESS
  }
}

interface Types extends EIP712Types {
  EIP712Domain: EIP712TypeProperty[]
  Permit: EIP712TypeProperty[]
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

// currently not imposing any limitations on how the 'Permit' type can look like
export type PermitType = EIP712TypeProperty[]

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

export class TypedPermit implements EIP712TypedData {
  readonly types: Types
  readonly domain: EIP712Domain
  readonly primaryType: string
  readonly message: any

  constructor (
    chainId: number,
    permitType: PermitType,
    domain: EIP712Domain,
    permit: PermitInterfaceDAI | PermitInterfaceEIP2612,
    eip712DomainType: EIP712TypeProperty[] = EIP712DomainType) {
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
  domainSeparator: EIP712Domain = getDaiDomainSeparator(),
  forceNonce?: number,
  skipValidation = false
): Promise<PrefixedHexString> {
  const web3 = new Web3(web3Input.currentProvider)
  const DaiContract = TruffleContract({
    contractName: 'DAIPermitInterface',
    abi: daiPermitAbi.abi
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
  domainType?: EIP712TypeProperty[],
  forceNonce?: number,
  skipValidation = false
): Promise<PrefixedHexString> {
  const web3 = new Web3(web3Input.currentProvider)
  const EIP2612Contract = TruffleContract({
    contractName: 'EIP2612Contract',
    abi: eip2612PermitAbi.abi
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
