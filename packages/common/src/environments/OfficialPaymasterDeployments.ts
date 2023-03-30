import { Address } from '../types/Aliases'
import { EIP712Domain } from '../EIP712/TypedRequestData'
import { gsnRuntimeVersion } from '../Version'

export enum PaymasterType {
  /**
   * This Paymaster will accept all transactions sent to it.
   * This is only useful on testnets as it will be instantly drained on a mainnet.
   * This Paymaster may not have any balance so funding it with testnet Ether is up to you.
   */
  AcceptEverythingPaymaster,
  /** not used */
  HashcashPaymaster,
  /**
   * This Paymaster will use the EIP-2612 'permit' method to charge the user for the transaction.
   * The latest exchange rate on Chainlink Oracle will be used for price conversion.
   */
  PermitERC20UniswapV3Paymaster,
  /** not used */
  SingleRecipientPaymaster,
  /** not used */
  TokenPaymasterLegacy,
  VerifyingPaymaster,
  /** not used */
  WhitelistPaymaster
}

export enum SupportedTokenSymbols {
  DAI = 'DAI',
  USDC = 'USDC',
  UNI = 'UNI'
}

export interface ERC20TokenDetails {
  displayedName: string
  symbol: string
  address: Address
}

export interface PaymasterDeployment {
  type: PaymasterType
  address: Address
  /** only relevant for TokenPaymasters */
  supportedTokensERC20: TokenDeploymentObject
}

type TokenDeploymentObject = {
  [supportedTokenSymbol in SupportedTokenSymbols]?: ERC20TokenDetails
}

type PaymasterDeploymentsObject = {
  [paymasterType in PaymasterType]?: PaymasterDeployment
}

interface DomainSeparatorObject {[address: Address]: EIP712Domain}

interface DeploymentObject {[chainId: number]: PaymasterDeploymentsObject}

export const DAI_CONTRACT_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
export const UNI_CONTRACT_ADDRESS = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
export const USDC_CONTRACT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
export const WETH9_CONTRACT_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const ERC20_TOKEN_DAI_GOERLI_5 = '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844'
const PERMIT_ERC20_UNISWAP_V3_PAYMASTER_GOERLI_5 = '0xc7709b37c63e116cc973842ae902462580d76104'

/**
 * This object exists to allow using the enums instead of addresses on Relay Provider construction.
 */
export const OfficialPaymasterDeployments: DeploymentObject = {
  1: {},
  5: {
    [PaymasterType.PermitERC20UniswapV3Paymaster]:
      {
        type: PaymasterType.PermitERC20UniswapV3Paymaster,
        address: PERMIT_ERC20_UNISWAP_V3_PAYMASTER_GOERLI_5,
        supportedTokensERC20:
          {
            [SupportedTokenSymbols.DAI]:
              {
                symbol: SupportedTokenSymbols.DAI,
                displayedName: 'Dai Stablecoin @ Goerli',
                address: ERC20_TOKEN_DAI_GOERLI_5
              }
          }
      }
  }
}

/**
 * Using Address here as key to simplify merging object with the user-provided token data if necessary.
 */
export const TokenDomainSeparators: { [chainId: number]: DomainSeparatorObject } = {
  1: {
    [DAI_CONTRACT_ADDRESS]: {
      name: 'Dai Stablecoin',
      version: '1',
      chainId: 1,
      verifyingContract: DAI_CONTRACT_ADDRESS
    },
    [UNI_CONTRACT_ADDRESS]: {
      name: 'Uniswap',
      chainId: 1,
      verifyingContract: UNI_CONTRACT_ADDRESS
    },
    [USDC_CONTRACT_ADDRESS]: {
      name: 'USD Coin',
      version: '2',
      chainId: 1,
      verifyingContract: USDC_CONTRACT_ADDRESS
    }
  },
  5: {
    [ERC20_TOKEN_DAI_GOERLI_5]: {
      name: 'Dai Stablecoin',
      version: '1',
      chainId: 5,
      verifyingContract: ERC20_TOKEN_DAI_GOERLI_5
    }
  }
}

export function getTokenBySymbol (symbol: SupportedTokenSymbols, chainId: number): Address | undefined {
  return OfficialPaymasterDeployments[chainId]
    ?.[PaymasterType.PermitERC20UniswapV3Paymaster]
    ?.supportedTokensERC20
    ?.[symbol]
    ?.address
}

export function getPaymasterAddressByTypeAndChain (paymasterType: PaymasterType | Address | undefined, chainId: number): Address {
  if (paymasterType == null) {
    throw new Error('Configured paymaster address or type is undefined!')
  }
  if (typeof paymasterType === 'string') {
    return paymasterType
  }
  const paymasterAddress = OfficialPaymasterDeployments[chainId]?.[paymasterType]?.address
  if (paymasterAddress == null) {
    throw new Error(`Paymaster type ${PaymasterType[paymasterType]}(${paymasterType}) has no known official deployed on chain ${chainId} as of publishing ver. ${gsnRuntimeVersion}`)
  }
  return paymasterAddress
}
