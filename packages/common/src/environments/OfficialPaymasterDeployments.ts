import { Address } from '../types/Aliases'
import { EIP712Domain } from '../EIP712/TypedRequestData'
import { gsnRuntimeVersion } from '../Version'

export const enum PaymasterType {
  AcceptEverythingPaymaster,
  HashcashPaymaster,
  PermitERC20UniswapV3Paymaster,
  SingleRecipientPaymaster,
  TokenPaymasterLegacy,
  VerifyingPaymaster,
  WhitelistPaymaster
}

export const enum SupportedTokenSymbols {
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

const ERC20_TOKEN_DAI_GOERLI_5 = '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844'
const PERMIT_ERC20_UNISWAP_V3_PAYMASTER_GOERLI_5 = '0xc7709b37c63e116cc973842ae902462580d76104'

/**
 * This object exists to allow using the 'const enums' instead of addresses on Relay Provider construction.
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
  1: {},
  5: {
    ERC20_TOKEN_DAI_GOERLI_5: {
      name: 'Dai Stablecoin',
      version: '1',
      chainId: 1,
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

/**
 * Note: TypeScript removes all info of the 'const enum' type at runtime.
 */
export function getPaymasterAddress (paymasterType: PaymasterType, chainId: number): Address | undefined {
  const paymasterAddress = OfficialPaymasterDeployments[chainId][paymasterType]?.address
  // noinspection PointlessBooleanExpressionJS
  if (typeof paymasterType === 'number' && paymasterType == null) {
    throw new Error(`Paymaster type ${paymasterType as string} has no known official deployed on chain ${chainId} as of publishing ver. ${gsnRuntimeVersion}`)
  }
  return paymasterAddress
}
