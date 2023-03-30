import { toBN } from 'web3-utils'
import { EIP712Domain } from '@opengsn/common/dist/EIP712/TypedRequestData'

import {
  DAI_CONTRACT_ADDRESS,
  UNI_CONTRACT_ADDRESS,
  USDC_CONTRACT_ADDRESS
} from '@opengsn/common'

export function getDaiDomainSeparator (): EIP712Domain {
  return {
    name: 'Dai Stablecoin',
    version: '1',
    chainId: 1,
    verifyingContract: DAI_CONTRACT_ADDRESS
  }
}

export function getUSDCDomainSeparator (): EIP712Domain {
  return {
    name: 'USD Coin',
    version: '2',
    chainId: 1,
    verifyingContract: USDC_CONTRACT_ADDRESS
  }
}

export function getUniDomainSeparator (): EIP712Domain {
  return {
    name: 'Uniswap',
    chainId: 1,
    verifyingContract: UNI_CONTRACT_ADDRESS
  }
}

export async function detectMainnet (): Promise<boolean> {
  const code = await web3.eth.getCode(DAI_CONTRACT_ADDRESS)
  return code !== '0x'
}

export async function skipWithoutFork (test: any): Promise<void> {
  const isMainnet = await detectMainnet()
  if (!isMainnet) {
    test.skip()
  }
}

export async function impersonateAccount (address: string): Promise<void> {
  return await new Promise((resolve, reject) => {
    // @ts-ignore
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'hardhat_impersonateAccount',
      params: [address],
      id: Date.now()
    }, (e: Error | null, r: any) => {
      if (e != null) {
        reject(e)
      } else {
        resolve(r)
      }
    })
  })
}

// as we are using forked mainnet, we will need to impersonate an account with a lot of DAI & UNI
export const MAJOR_DAI_AND_UNI_HOLDER = '0x28C6c06298d514Db089934071355E5743bf21d60' // '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503'

export const ETHER = toBN(1e18.toString())
export const GAS_PRICE = '10000000000'
