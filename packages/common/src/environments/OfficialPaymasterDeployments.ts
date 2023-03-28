// TODO: we should probably generate such a file from the 'deployments' folder
//  (it is probably not cool to npm-pack and read the folder ar runtime as it uses named chains not IDs)

import { EIP712Domain } from '../EIP712/TypedRequestData'
import { Address } from '../types/Aliases'

export const enum PaymasterType {
  AcceptEverythingPaymaster,
  HashcashPaymaster,
  PermitERC20UniswapV3Paymaster,
  SingleRecipientPaymaster,
  TokenPaymasterLegacy,
  VerifyingPaymaster,
  WhitelistPaymaster
}

export const enum SupportedERC20Tokens {
  DAI = 'DAI',
  USDC = 'USDC',
  UNI = 'UNI'
}

export interface ERC20TokenDetails {
  displayedName: string
  symbol: string
  address: string
  eip712domain: EIP712Domain
}

export interface PaymasterDeployment {
  type: PaymasterType
  address: string

  // there is no very good way to define per-token configuration type
  supportedTokensERC20: TokenDeploymentObject
}

type TokenDeploymentObject = {
  [key in SupportedERC20Tokens]?: ERC20TokenDetails
}

type PaymasterDeploymentsObject = {
  [key in PaymasterType]?: PaymasterDeployment
}

type DeploymentObject = { [chainId: number]: PaymasterDeploymentsObject | undefined }

export const OfficialPaymasterDeployments: DeploymentObject = {
  1: {},
  5: {
    [PaymasterType.PermitERC20UniswapV3Paymaster]:
      {
        type: PaymasterType.PermitERC20UniswapV3Paymaster,
        address: '0xc7709b37c63e116cc973842ae902462580d76104',
        supportedTokensERC20:
          {
            [SupportedERC20Tokens.DAI]:
              {
                symbol: SupportedERC20Tokens.DAI,
                displayedName: 'Dai Stablecoin @ Goerli',
                address: '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844',
                eip712domain: {
                  name: 'Dai Stablecoin',
                  version: '1',
                  chainId: 1,
                  verifyingContract: '0x11fe4b6ae13d2a6055c8d9cf65c55bac32b5d844'
                }
              }
          }
      }
  }
}

// TODO: UGLY - bend backwards to provide domain separator; squash it into a single entry; query from there - refactor!
export function getTokenBySymbol (symbol: SupportedERC20Tokens, chainId: number): Address | undefined {
  return OfficialPaymasterDeployments[chainId]
    ?.[PaymasterType.PermitERC20UniswapV3Paymaster]
    ?.supportedTokensERC20
    ?.[symbol]
    ?.address
}

export function getAllTokenDomainSeparators (chainId: number): Record<Address, EIP712Domain> {
  const deployment = OfficialPaymasterDeployments[chainId]
  if (deployment == null) {
    return {}
  }
  const tokenDomainSeparators: Record<Address, EIP712Domain> = {}
  Object
    .values(deployment)
    .forEach((paymasterDeployment: PaymasterDeployment) => {
      Object.values(paymasterDeployment.supportedTokensERC20)
        ?.forEach((tokenDetails: ERC20TokenDetails) => {
          tokenDomainSeparators[tokenDetails.address] = tokenDetails.eip712domain
        })
    })
  return tokenDomainSeparators
}
