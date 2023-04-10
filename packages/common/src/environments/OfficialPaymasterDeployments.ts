import { isValidAddress } from 'ethereumjs-util'

import { Address } from '../types/Aliases'
import { EIP712Domain } from '../EIP712/TypedRequestData'
import { LoggerInterface } from '../LoggerInterface'
import { gsnRuntimeVersion } from '../Version'

export enum PaymasterType {
  /**
   * This Paymaster will accept all transactions sent to it.
   * This is only useful on testnets as it will be instantly drained on a mainnet.
   * This Paymaster may not have any balance so funding it with testnet Ether is up to you.
   */
  AcceptEverythingPaymaster = 'AcceptEverythingPaymaster',

  /**
   * This Paymaster will use the EIP-2612 'permit' method to charge the user for the transaction.
   * The latest exchange rate on Chainlink Oracle will be used for price conversion.
   */
  PermitERC20UniswapV3Paymaster = 'PermitERC20UniswapV3Paymaster',

  /** This Paymaster allows the dapp owners to co-sign the Relay Request off-chain */
  VerifyingPaymaster = 'VerifyingPaymaster',

  /** This Paymaster allows the dapp owners to maintain a simple set of rules on-chain for their GSN integrations. */
  SingletonWhitelistPaymaster = 'SingletonWhitelistPaymaster',

  /** not used */
  SingleRecipientPaymaster = 'SingleRecipientPaymaster',
  /** not used */
  TokenPaymasterLegacy = 'TokenPaymasterLegacy',
  /** not used */
  WhitelistPaymaster = 'WhitelistPaymaster',
  /** not used */
  HashcashPaymaster = 'HashcashPaymaster'
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

export const DAI_CONTRACT_ADDRESS = '0x6b175474e89094c44da98b954eedeac495271d0f'
export const UNI_CONTRACT_ADDRESS = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
export const USDC_CONTRACT_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
export const WETH9_CONTRACT_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

const DAI_CONTRACT_ADDRESS_GOERLI = '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844'
const PERMIT_ERC20_UNISWAP_V3_PAYMASTER_GOERLI_5 = '0xc7709b37c63e116cc973842ae902462580d76104'
const SINGLETON_WHITELIST_PAYMASTER_GOERLI_5 = '0xfc9d2357570b0b2b87be4ac7461a082daaf19f4b'

const ACCEPT_EVERYTHING_PAYMASTER_AVALANCHE_FUJI = '0x735719a8c5af199ea5b93207083787a5b548c0e2'
const ACCEPT_EVERYTHING_PAYMASTER_BSC_TESTNET = '0x735719a8c5af199ea5b93207083787a5b548c0e2'
const ACCEPT_EVERYTHING_PAYMASTER_GOERLI = '0x7e4123407707516bd7a3afa4e3ebceacfcbbb107'
const ACCEPT_EVERYTHING_PAYMASTER_GOERLI_ARBITRUM = '0x9dc769b8cbd07131227b0815bed3526b1f8acd52'
const ACCEPT_EVERYTHING_PAYMASTER_GOERLI_OPTIMISM = '0x735719a8c5af199ea5b93207083787a5b548c0e2'
const ACCEPT_EVERYTHING_PAYMASTER_MUMBAI = '0x086c11bd5a61ac480b326916656a33c474d1e4d8'

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
    [PaymasterType.SingletonWhitelistPaymaster]: {
      type: PaymasterType.SingletonWhitelistPaymaster,
      address: SINGLETON_WHITELIST_PAYMASTER_GOERLI_5,
      supportedTokensERC20: {}
    },
    [PaymasterType.AcceptEverythingPaymaster]:
      {
        type: PaymasterType.AcceptEverythingPaymaster,
        address: ACCEPT_EVERYTHING_PAYMASTER_GOERLI,
        supportedTokensERC20: {}
      }
  },
  [SupportedChains.GOERLI_OPTIMISM]: {
    [PaymasterType.AcceptEverythingPaymaster]:
      {
        type: PaymasterType.AcceptEverythingPaymaster,
        address: ACCEPT_EVERYTHING_PAYMASTER_GOERLI_OPTIMISM,
        supportedTokensERC20: {}
      }
  },
  [SupportedChains.AVALANCHE_FUJI_TESTNET]: {
    [PaymasterType.AcceptEverythingPaymaster]:
      {
        type: PaymasterType.AcceptEverythingPaymaster,
        address: ACCEPT_EVERYTHING_PAYMASTER_AVALANCHE_FUJI,
        supportedTokensERC20: {}
      }
  },
  [SupportedChains.MUMBAI]: {
    [PaymasterType.AcceptEverythingPaymaster]:
      {
        type: PaymasterType.AcceptEverythingPaymaster,
        address: ACCEPT_EVERYTHING_PAYMASTER_MUMBAI,
        supportedTokensERC20: {}
      }
  },
  [SupportedChains.GOERLI_ARBITRUM]: {
    [PaymasterType.AcceptEverythingPaymaster]:
      {
        type: PaymasterType.AcceptEverythingPaymaster,
        address: ACCEPT_EVERYTHING_PAYMASTER_GOERLI_ARBITRUM,
        supportedTokensERC20: {}
      }
  },
  [SupportedChains.BSC_TESTNET]: {
    [PaymasterType.AcceptEverythingPaymaster]:
      {
        type: PaymasterType.AcceptEverythingPaymaster,
        address: ACCEPT_EVERYTHING_PAYMASTER_BSC_TESTNET,
        supportedTokensERC20: {}
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
    ?.toLowerCase()
}

export function getPaymasterAddressByTypeAndChain (
  paymasterType: PaymasterType | Address | undefined,
  chainId: number,
  logger: LoggerInterface
): Address {
  if (paymasterType == null) {
    throw new Error('Configured paymaster address or type is undefined!')
  }
  if (isValidAddress(paymasterType)) {
    return paymasterType
  }

  const _paymasterType = paymasterType as PaymasterType

  const paymasterAddress = OfficialPaymasterDeployments[chainId]
    ?.[_paymasterType]
    ?.address

  if (
    paymasterType === PaymasterType.VerifyingPaymaster ||
    paymasterType === ''
  ) {
    logger.info(`VerifyingPaymaster address is not yet known for chain ${chainId} and will be fetched from the Verifier Server`)
    return ''
  }

  if (paymasterAddress == null) {
    throw new Error(`Paymaster type ${PaymasterType[_paymasterType]}(${paymasterType}) has no known official deployed on chain ${chainId} as of publishing ver. ${gsnRuntimeVersion}`)
  }
  return paymasterAddress
}
