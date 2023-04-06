import { bufferToHex, keccakFromString } from 'ethereumjs-util'

// List of "permittable" tokens we should add to the Paymaster:

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
export const GSN_FORWARDER_CONTRACT_ADDRESS = '0xB2b5841DBeF766d4b521221732F9B618fCf34A87'
export const GSN_HUB_CONTRACT_ADDRESS = '0x8f812FAE28a3Aa634d97659091D6540FABD234F5'

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

export const GAS_USED_BY_POST = 230000
export const DAI_ETH_POOL_FEE = 500
export const USDC_ETH_POOL_FEE = 500
export const UNI_ETH_POOL_FEE = 3000
export const SLIPPAGE = 10
export const MIN_HUB_BALANCE = 1e17.toString()
export const TARGET_HUB_BALANCE = 1e18.toString()
export const MIN_WITHDRAWAL_AMOUNT = 2e18.toString()
export const MIN_SWAP_AMOUNT = 1e17.toString()

export const PERMIT_SIGNATURE_DAI = 'permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'
export const PERMIT_SIGNATURE_EIP2612 = 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'
export const PERMIT_CALLDATA_MAX_LEN = 280 // address + address + uint256 + uint256 + bool? + uint8 + bytes32 + bytes32 == at most 8 * 32 == 256
export const MAX_PAYMASTERDATA_LENGTH = PERMIT_CALLDATA_MAX_LEN + 20 // optional permit calldata plus token address
export const PERMIT_SELECTOR_DAI = bufferToHex(keccakFromString(PERMIT_SIGNATURE_DAI).slice(0, 4))
export const PERMIT_SELECTOR_EIP2612 = bufferToHex(keccakFromString(PERMIT_SIGNATURE_EIP2612).slice(0, 4))
