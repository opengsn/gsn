import {
  DAI_CONTRACT_ADDRESS,
  UNI_CONTRACT_ADDRESS,
  USDC_CONTRACT_ADDRESS,
  WETH9_CONTRACT_ADDRESS
} from '@opengsn/common'

import {
  CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS,
  CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS,
  DAI_ETH_POOL_FEE,
  GAS_USED_BY_POST,
  GSN_FORWARDER_CONTRACT_ADDRESS,
  GSN_HUB_CONTRACT_ADDRESS,
  MIN_HUB_BALANCE,
  MIN_SWAP_AMOUNT,
  MIN_WITHDRAWAL_AMOUNT,
  PERMIT_SIGNATURE_DAI,
  PERMIT_SIGNATURE_EIP2612,
  SLIPPAGE,
  SWAP_ROUTER_CONTRACT_ADDRESS,
  TARGET_HUB_BALANCE,
  UNI_ETH_POOL_FEE,
  USDC_ETH_POOL_FEE
} from '../src'

module.exports = {
  1: {
    PermitERC20UniswapV3Paymaster: {
      tokens: [
        {
          name: 'DAI',
          slippage: SLIPPAGE,
          tokenAddress: DAI_CONTRACT_ADDRESS,
          priceFeed: CHAINLINK_DAI_ETH_FEED_CONTRACT_ADDRESS,
          uniswapPoolFee: DAI_ETH_POOL_FEE,
          permitMethodSignature: PERMIT_SIGNATURE_DAI,
          reverseQuote: false
        },
        {
          name: 'USDC',
          slippage: SLIPPAGE,
          tokenAddress: USDC_CONTRACT_ADDRESS,
          priceFeed: CHAINLINK_USDC_ETH_FEED_CONTRACT_ADDRESS,
          uniswapPoolFee: USDC_ETH_POOL_FEE,
          permitMethodSignature: PERMIT_SIGNATURE_EIP2612,
          reverseQuote: false
        },
        {
          name: 'UNI',
          slippage: SLIPPAGE,
          tokenAddress: UNI_CONTRACT_ADDRESS,
          priceFeed: CHAINLINK_UNI_ETH_FEED_CONTRACT_ADDRESS,
          uniswapPoolFee: UNI_ETH_POOL_FEE,
          permitMethodSignature: PERMIT_SIGNATURE_EIP2612,
          reverseQuote: false
        }
      ],
      MIN_SWAP_AMOUNT,
      SWAP_ROUTER_CONTRACT_ADDRESS,
      WETH9_CONTRACT_ADDRESS,
      GAS_USED_BY_POST,
      MIN_HUB_BALANCE,
      TARGET_HUB_BALANCE,
      MIN_WITHDRAWAL_AMOUNT,
      GSN_FORWARDER_CONTRACT_ADDRESS,
      GSN_HUB_CONTRACT_ADDRESS
    }
  },
  5: {
    PermitERC20UniswapV3Paymaster: {
      tokens: [
        {
          name: 'DAI',
          slippage: SLIPPAGE,
          tokenAddress: '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844',
          priceFeed: '0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e',
          uniswapPoolFee: 3000,
          permitMethodSignature: PERMIT_SIGNATURE_DAI,
          reverseQuote: true
        }
      ],
      SWAP_ROUTER_CONTRACT_ADDRESS, // same address on mainnet and goerli
      MIN_SWAP_AMOUNT,
      WETH9_CONTRACT_ADDRESS: '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6',
      GAS_USED_BY_POST,
      MIN_HUB_BALANCE,
      TARGET_HUB_BALANCE,
      MIN_WITHDRAWAL_AMOUNT,
      GSN_FORWARDER_CONTRACT_ADDRESS, // same address on mainnet and goerli
      GSN_HUB_CONTRACT_ADDRESS: '0x7DDa9Bf2C0602a96c06FA5996F715C7Acfb8E7b0'
    }
  }
}
