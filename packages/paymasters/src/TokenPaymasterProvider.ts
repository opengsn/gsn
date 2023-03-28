import { getPaymasterAddress, GSNUnresolvedConstructorInput, RelayClient, RelayProvider } from '@opengsn/provider'
import { PrefixedHexString, toChecksumAddress, isValidChecksumAddress } from 'ethereumjs-util'
import { Address, removeHexPrefix } from '@opengsn/common/dist'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import {
  MAX_PAYMASTERDATA_LENGTH,
  PERMIT_SIGNATURE_DAI
} from './constants/MainnetPermitERC20UniswapV3PaymasterConstants'

import { signAndEncodeDaiPermit, signAndEncodeEIP2612Permit } from './PermitPaymasterUtils'
import { constants } from '@opengsn/common/dist/Constants'
import {
  EIP712Domain,
  EIP712DomainType,
  EIP712DomainTypeWithoutVersion
} from '@opengsn/common/dist/EIP712/TypedRequestData'
import { TokenPaymasterInteractor } from './TokenPaymasterInteractor'
import {
  getTokenBySymbol,
  SupportedTokenSymbols
} from '@opengsn/common/dist/environments/OfficialPaymasterDeployments'

export class TokenPaymasterProvider extends RelayProvider {
  permitSignature!: string
  tokenPaymasterInteractor!: TokenPaymasterInteractor

  static newProvider (input: GSNUnresolvedConstructorInput): TokenPaymasterProvider {
    if (input.config.maxPaymasterDataLength != null) {
      throw new Error('Token paymaster doesn\'t accept maxPaymasterDataLength modification. Please leave this field empty')
    }
    input.config.maxPaymasterDataLength = MAX_PAYMASTERDATA_LENGTH
    return new TokenPaymasterProvider(new RelayClient(input))
  }

  /**
   *
   * @param permitERC20TokenForGas
   */
  async init (permitERC20TokenForGas?: Address | SupportedTokenSymbols): Promise<this> {
    await super.init()
    this.relayClient.dependencies.asyncPaymasterData = this._buildPaymasterData.bind(this)
    if (permitERC20TokenForGas != null) {
      await this.setToken(permitERC20TokenForGas)
    }
    return this
  }

  async _buildPaymasterData (relayRequest: RelayRequest): Promise<PrefixedHexString> {
    if (this.config.tokenPaymasterDomainSeparators == null) {
      throw new Error('TokenPaymasterProvider not initialized. Call init() first')
    }
    //  Optionally encode permit method,then concatenate token address
    if (relayRequest.relayData.paymaster !== this.tokenPaymasterInteractor.paymaster.address) {
      throw new Error('Paymaster address mismatch')
    }
    const allowance = await this.tokenPaymasterInteractor.getAllowance(relayRequest.request.from, relayRequest.relayData.paymaster)
    let permitMethod = ''
    if (allowance.eqn(0)) {
      const domainSeparator: EIP712Domain =
        this.config.tokenPaymasterDomainSeparators[this.tokenPaymasterInteractor.token.address]
      if (this.permitSignature === PERMIT_SIGNATURE_DAI) {
        permitMethod = await signAndEncodeDaiPermit(
          relayRequest.request.from,
          relayRequest.relayData.paymaster,
          this.tokenPaymasterInteractor.token.address,
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
          this.tokenPaymasterInteractor.token.address,
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
    return '0x' + removeHexPrefix(this.tokenPaymasterInteractor.token.address) + removeHexPrefix(permitMethod)
  }

  async setToken (permitERC20TokenForGas: Address | SupportedTokenSymbols): Promise<void> {
    const chainId = this.origProvider.network.chainId
    const tokenAddress = getTokenBySymbol(permitERC20TokenForGas as any, chainId) ?? toChecksumAddress(permitERC20TokenForGas.toString())
    if (tokenAddress == null || !isValidChecksumAddress(tokenAddress)) {
      throw new Error(`Unable to find token with name/address ${permitERC20TokenForGas} on chainId ${chainId}`)
    }

    // resolve paymaster address from enum type if needed
    const paymasterAddress = getPaymasterAddress(this.config?.paymasterAddress as any, chainId) ?? this.config?.paymasterAddress

    this.tokenPaymasterInteractor = new TokenPaymasterInteractor(this.origProvider, paymasterAddress as string, tokenAddress)

    const isSupported = await this.tokenPaymasterInteractor.isTokenSupported(tokenAddress)
    if (!isSupported) {
      throw new Error(`token ${tokenAddress} reported as not supported by paymaster ${this.tokenPaymasterInteractor.paymaster.address}`)
    }
    if (this.config.tokenPaymasterDomainSeparators[tokenAddress] == null) {
      throw new Error(`Domain separator not found for token ${tokenAddress}`)
    }
  }
}
