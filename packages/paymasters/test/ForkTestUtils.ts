import { toBN } from 'web3-utils'
import { DAI_CONTRACT_ADDRESS } from '../src/PermitPaymasterUtils'

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

// as we are using forked mainnet, we will need to impersonate an account with a lot of DAI & UNI
export const MAJOR_DAI_AND_UNI_HOLDER = '0xF977814e90dA44bFA03b6295A0616a897441aceC' // '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503'

export const GAS_USED_BY_POST = 204766
export const DAI_ETH_POOL_FEE = 500
export const USDC_ETH_POOL_FEE = 500
export const UNI_ETH_POOL_FEE = 3000
export const MIN_HUB_BALANCE = 1e17.toString()
export const TARGET_HUB_BALANCE = 1e18.toString()
export const MIN_WITHDRAWAL_AMOUNT = 2e18.toString()
export const ETHER = toBN(1e18.toString())
export const GAS_PRICE = '1000000000'
