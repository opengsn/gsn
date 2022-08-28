import { toBN } from 'web3-utils'
import { EIP712Domain } from '@opengsn/common/dist/EIP712/TypedRequestData'

export const DAI_CONTRACT_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
export const WETH9_CONTRACT_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const UNI_CONTRACT_ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
export const USDC_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

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
export const UNISWAP_V3_DAI_WETH_2_POOL_CONTRACT_ADDRESS = '0x60594a405d53811d3BC4766596EFD80fd545A270'
export const UNISWAP_V3_USDC_WETH_POOL_CONTRACT_ADDRESS = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
export const UNISWAP_V3_DAI_USDC_2_POOL_CONTRACT_ADDRESS = '0xa63b490aA077f541c9d64bFc1Cc0db2a752157b5'
export const UNISWAP_V3_DAI_USDC_4_POOL_CONTRACT_ADDRESS = '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168'
export const UNISWAP_V3_UNI_DAI_POOL_CONTRACT_ADDRESS = '0x7cf70eD6213F08b70316bD80F7c2ddDc94E41aC5'
export const UNISWAP_V3_UNI_DAI_2_POOL_CONTRACT_ADDRESS = '0x57D7d040438730d4029794799dEEd8601E23fF80'

// price is approximate so USD can be used for any of the US Dollar stablecoins
export const CHAINLINK_ETH_USD_FEED_CONTRACT_ADDRESS = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
export const CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS = '0x773616E4d11A78F511299002da57A0a94577F1f4'
export const CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS = '0x986b5E1e1755e3C2440e960477f25201B0a8bbD4'
export const CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS = '0xD6aA3D25116d8dA79Ea0246c4826EB951872e02e'

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

export const GAS_USED_BY_POST = 230000
export const DAI_ETH_POOL_FEE = 500
export const USDC_ETH_POOL_FEE = 500
export const UNI_ETH_POOL_FEE = 3000
export const SLIPPAGE = 10
export const MIN_HUB_BALANCE = 1e17.toString()
export const TARGET_HUB_BALANCE = 1e18.toString()
export const MIN_WITHDRAWAL_AMOUNT = 2e18.toString()
export const MIN_SWAP_AMOUNT = 1e17.toString()
export const ETHER = toBN(1e18.toString())
export const GAS_PRICE = '10000000000'
