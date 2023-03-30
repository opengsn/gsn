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

export enum SupportedChains {
  MAINNET = 1,
  GOERLI = 5,
  BSC_TESTNET = 97,
  GOERLI_OPTIMISM = 420,
  AVALANCHE_FUJI_TESTNET = 43113,
  MUMBAI = 80001,
  GOERLI_ARBITRUM = 421613
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

const DAI_CONTRACT_ADDRESS_GOERLI = '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844'
const PERMIT_ERC20_UNISWAP_V3_PAYMASTER_GOERLI_5 = '0xc7709b37c63e116cc973842ae902462580d76104'

const ACCEPT_EVERYTHING_PAYMASTER_AVALANCHE_FUJI = '0x735719A8C5aF199ea5b93207083787a5B548C0e2'
const ACCEPT_EVERYTHING_PAYMASTER_BSC_TESTNET = '0x735719A8C5aF199ea5b93207083787a5B548C0e2'
const ACCEPT_EVERYTHING_PAYMASTER_GOERLI = '0x7e4123407707516bD7a3aFa4E3ebCeacfcbBb107'
const ACCEPT_EVERYTHING_PAYMASTER_GOERLI_ARBITRUM = '0x9dC769B8cBD07131227b0815BEd3526b1f8ACD52'
const ACCEPT_EVERYTHING_PAYMASTER_GOERLI_OPTIMISM = '0x735719A8C5aF199ea5b93207083787a5B548C0e2'
const ACCEPT_EVERYTHING_PAYMASTER_MUMBAI = '0x086c11bd5A61ac480b326916656a33c474d1E4d8'

/**
 * This object exists to allow using the enums instead of addresses on Relay Provider construction.
 */
export const OfficialPaymasterDeployments: DeploymentObject = {
  [SupportedChains.MAINNET]: {},
  [SupportedChains.GOERLI]: {
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
                address: DAI_CONTRACT_ADDRESS_GOERLI
              }
          }
      },
    [PaymasterType.AcceptEverythingPaymaster]:
      {
        type: PaymasterType.AcceptEverythingPaymaster,
        address: ACCEPT_EVERYTHING_PAYMASTER_GOERLI,
        supportedTokensERC20: {}
      }
  },
  [SupportedChains.GOERLI_OPTIMISM]: [
    {
      type: PaymasterType.AcceptEverythingPaymaster,
      address: ACCEPT_EVERYTHING_PAYMASTER_GOERLI_OPTIMISM,
      supportedTokensERC20: {}
    }
  ],
  [SupportedChains.AVALANCHE_FUJI_TESTNET]: [
    {
      type: PaymasterType.AcceptEverythingPaymaster,
      address: ACCEPT_EVERYTHING_PAYMASTER_AVALANCHE_FUJI,
      supportedTokensERC20: {}
    }
  ],
  [SupportedChains.MUMBAI]: [
    {
      type: PaymasterType.AcceptEverythingPaymaster,
      address: ACCEPT_EVERYTHING_PAYMASTER_MUMBAI,
      supportedTokensERC20: {}
    }
  ],
  [SupportedChains.GOERLI_ARBITRUM]: [
    {
      type: PaymasterType.AcceptEverythingPaymaster,
      address: ACCEPT_EVERYTHING_PAYMASTER_GOERLI_ARBITRUM,
      supportedTokensERC20: {}
    }
  ],
  [SupportedChains.BSC_TESTNET]: [
    {
      type: PaymasterType.AcceptEverythingPaymaster,
      address: ACCEPT_EVERYTHING_PAYMASTER_BSC_TESTNET,
      supportedTokensERC20: {}
    }
  ]
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
    [DAI_CONTRACT_ADDRESS_GOERLI]: {
      name: 'Dai Stablecoin',
      version: '1',
      chainId: 5,
      verifyingContract: DAI_CONTRACT_ADDRESS_GOERLI
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

  const paymasterAddress = OfficialPaymasterDeployments[chainId]
    ?.[paymasterType]
    ?.address

  if (paymasterAddress == null) {
    throw new Error(`Paymaster type ${PaymasterType[paymasterType]}(${paymasterType}) has no known official deployed on chain ${chainId} as of publishing ver. ${gsnRuntimeVersion}`)
  }
  return paymasterAddress
}
