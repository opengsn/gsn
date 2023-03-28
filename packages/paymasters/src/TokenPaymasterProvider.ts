import { JsonRpcProvider, ExternalProvider } from '@ethersproject/providers'
import { RelayClient, RelayProvider, GSNUnresolvedConstructorInput } from '@opengsn/provider'
import { PrefixedHexString, toChecksumAddress } from 'ethereumjs-util'
import { Address, removeHexPrefix } from '@opengsn/common/dist'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import {
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance
} from '../types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import {
  MAX_PAYMASTERDATA_LENGTH,
  PERMIT_SELECTOR_DAI,
  PERMIT_SELECTOR_EIP2612,
  PERMIT_SIGNATURE_DAI,
  PERMIT_SIGNATURE_EIP2612
} from './constants/MainnetPermitERC20UniswapV3PaymasterConstants'

import {
  signAndEncodeDaiPermit,
  signAndEncodeEIP2612Permit
} from './PermitPaymasterUtils'
import { constants } from '@opengsn/common/dist/Constants'
import {
  EIP712Domain,
  EIP712DomainType,
  EIP712DomainTypeWithoutVersion
} from '@opengsn/common/dist/EIP712/TypedRequestData'
import { TokenPaymasterInteractor } from './TokenPaymasterInteractor'

export interface TokenPaymasterConfig extends GSNConfig {
  tokenAddress: Address
}

export interface TokenPaymasterUnresolvedConstructorInput extends GSNUnresolvedConstructorInput {
  config: Partial<TokenPaymasterConfig>
}

export class TokenPaymasterProvider extends RelayProvider {
  config!: TokenPaymasterConfig
  token!: PermitInterfaceDAIInstance | PermitInterfaceEIP2612Instance
  permitSignature!: string
  protected paymaster!: PermitERC20UniswapV3PaymasterInstance
  readonly tokenPaymasterInteractor: TokenPaymasterInteractor

  constructor (relayClient: RelayClient, provider: JsonRpcProvider | ExternalProvider) {
    super(relayClient)
    this.tokenPaymasterInteractor = new TokenPaymasterInteractor(provider)
  }

  static newProvider (input: TokenPaymasterUnresolvedConstructorInput): TokenPaymasterProvider {
    TokenPaymasterProvider._applyTokenPaymasterConfig(input.config)
    const provider = new TokenPaymasterProvider(new RelayClient(input), input.provider)
    return provider
  }

  private static _applyTokenPaymasterConfig (config: Partial<TokenPaymasterConfig>): void {
    if (config.maxPaymasterDataLength != null) {
      throw new Error('Token paymaster doesn\'t accept maxPaymasterDataLength modification. Please leave this field empty')
    }
    config.maxPaymasterDataLength = MAX_PAYMASTERDATA_LENGTH
  }

  async init (): Promise<this> {
    await super.init(true)
    this.relayClient.dependencies.asyncPaymasterData = this._buildPaymasterData.bind(this)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.paymaster = await this.tokenPaymasterInteractor._createPermitERC20UniswapV3Paymaster(this.relayClient.config.tokenPaymasterAddress)
    if (this.config.tokenAddress != null) {
      await this.setToken(this.config.tokenAddress)
    }
    return this
  }

  async _buildPaymasterData (relayRequest: RelayRequest): Promise<PrefixedHexString> {
    if (this.config.tokenPaymasterDomainSeparators == null) {
      throw new Error('TokenPaymasterProvider not initialized. Call init() first')
    }
    //  Optionally encode permit method,then concatenate token address
    if (relayRequest.relayData.paymaster !== this.paymaster.address) {
      throw new Error('Paymaster address mismatch')
    }
    const allowance = await this.token.allowance(relayRequest.request.from, relayRequest.relayData.paymaster)
    let permitMethod = ''
    if (allowance.eqn(0)) {
      const domainSeparator: EIP712Domain = this.config.tokenPaymasterDomainSeparators[this.config.tokenAddress]
      if (this.permitSignature === PERMIT_SIGNATURE_DAI) {
        permitMethod = await signAndEncodeDaiPermit(
          relayRequest.request.from,
          relayRequest.relayData.paymaster,
          this.config.tokenAddress,
          constants.MAX_UINT256.toString(),
          this.origProvider,
          domainSeparator,
          this.config.methodSuffix,
          this.config.jsonStringifyRequest
        )
      } else {
        permitMethod = await signAndEncodeEIP2612Permit(
          relayRequest.request.from,
          relayRequest.relayData.paymaster,
          this.config.tokenAddress,
          constants.MAX_UINT256.toString(),
          constants.MAX_UINT256.toString(),
          this.origProvider,
          domainSeparator,
          this.config.methodSuffix,
          this.config.jsonStringifyRequest,
          domainSeparator.version == null ? EIP712DomainTypeWithoutVersion : EIP712DomainType
        )
      }
    }
    return '0x' + removeHexPrefix(this.config.tokenAddress) + removeHexPrefix(permitMethod)
  }

  async setToken (tokenAddress: Address): Promise<void> {
    const isSupported = await this.isTokenSupported(tokenAddress)
    if (!isSupported) {
      throw new Error(`token ${tokenAddress} not supported`)
    }
    this.config.tokenAddress = toChecksumAddress(tokenAddress)
    if (this.config.tokenPaymasterDomainSeparators[this.config.tokenAddress] == null) {
      throw new Error(`Domain separator not found for token ${tokenAddress}`)
    }
    const { permitMethodSelector } = await this.paymaster.getTokenSwapData(tokenAddress)
    if (permitMethodSelector === PERMIT_SELECTOR_DAI) {
      this.permitSignature = PERMIT_SIGNATURE_DAI
      this.token = await this.tokenPaymasterInteractor._createPermitInterfaceDAIToken(tokenAddress)
    } else if (permitMethodSelector === PERMIT_SELECTOR_EIP2612) {
      this.permitSignature = PERMIT_SIGNATURE_EIP2612
      this.token = await this.tokenPaymasterInteractor._createPermitInterfaceEIP2612Token(tokenAddress)
    } else {
      throw new Error(`Unknown permit signature hash ${permitMethodSelector}`)
    }
  }

  async supportedTokens (): Promise<Address[]> {
    return await this.paymaster.getTokens()
  }

  async isTokenSupported (token: Address): Promise<boolean> {
    return await this.paymaster.isTokenSupported(token)
  }
}
