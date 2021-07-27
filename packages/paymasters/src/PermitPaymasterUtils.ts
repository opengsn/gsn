import Web3 from 'web3'
import { PrefixedHexString } from 'ethereumjs-tx'
import { getEip712Signature, TruffleContract } from '@opengsn/common'
import { EIP712Domain, EIP712TypedData, EIP712TypeProperty, EIP712Types } from 'eth-sig-util'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { EIP712DomainType } from '@opengsn/common/dist/EIP712/TypedRequestData'

import daiPermitAbi from '../build/contracts/DAIPermitInterface.json'

function getDaiDomainSeparator (verifier: Address, chainId: number): EIP712Domain {
  return {
    name: 'Dai Stablecoin',
    version: '1',
    chainId: chainId,
    verifyingContract: verifier
  }
}

interface Types extends EIP712Types {
  EIP712Domain: EIP712TypeProperty[]
  Permit: EIP712TypeProperty[]
}

interface PermitInterface {
  // TODO: for now, 'from' field can be thrown in without exception; this makes it compatible with
  from: Address
  holder: Address
  spender: Address
  nonce: number | string
  expiry: number | string
  allowed: boolean
}

const PermitType = [
  { name: 'holder', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'allowed', type: 'bool' }
]

export class TypedPermit implements EIP712TypedData {
  readonly types: Types
  readonly domain: EIP712Domain
  readonly primaryType: string
  readonly message: any

  constructor (
    chainId: number,
    verifier: Address,
    permit: PermitInterface) {
    this.types = {
      EIP712Domain: EIP712DomainType,
      Permit: PermitType
    }
    this.domain = getDaiDomainSeparator(verifier, chainId)
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
  expiry: number | string,
  web3Input: Web3,
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
  const permit: PermitInterface = {
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
    token,
    permit
  )
  const signature = await getEip712Signature(
    web3,
    dataToSign
  )
  // TODO: extract RSV split into utils
  const r = signature.slice(0, 66)
  const s = '0x' + signature.slice(66, 130)
  const v = Number('0x' + signature.slice(130, 132))
  // we use 'estimateGas' to check against the permit method revert (hard to debug otherwise)
  if (!skipValidation) {
    await daiInstance.contract.methods.permit(holder, spender, nonce, expiry, true, v, r, s).estimateGas()
  }
  return daiInstance.contract.methods.permit(holder, spender, nonce, expiry, true, v, r, s).encodeABI()
}
