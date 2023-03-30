import BN from 'bn.js'

import { getPaymasterAddress, GSNUnresolvedConstructorInput, RelayClient, RelayProvider } from '@opengsn/provider'
import { PrefixedHexString, toChecksumAddress, isValidChecksumAddress } from 'ethereumjs-util'
import { Address, RelayRequest, removeHexPrefix } from '@opengsn/common'

import {
  MAX_PAYMASTERDATA_LENGTH,
  PERMIT_SELECTOR_DAI
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

interface TokenSelectionDetails {
  address: string
  balance: BN
  // token balance converted to the native chain currency
  balanceWei: BN
  allowance: BN
  // token allowance converted to the native chain currency
  allowanceWei: BN
}

export class TokenPaymasterProvider extends RelayProvider {
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
    const chainId = this.origProvider.network.chainId

    // TODO: this oneliner code is complex and repeated - refactor
    // resolve paymaster address from enum type if needed
    const paymasterAddress = getPaymasterAddress(this.config?.paymasterAddress as any, chainId) ?? this.config?.paymasterAddress
    this.tokenPaymasterInteractor = new TokenPaymasterInteractor(this.origProvider, paymasterAddress as any)
    await this.tokenPaymasterInteractor.init()
    this.relayClient.dependencies.asyncPaymasterData = this._buildPaymasterData.bind(this)
    if (permitERC20TokenForGas == null) {
      await this.autoSelectToken()
    } else {
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
      if (this.tokenPaymasterInteractor.tokenSwapData?.permitMethodSelector === PERMIT_SELECTOR_DAI) {
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

  async autoSelectToken (): Promise<void> {
    const tokenBalancesNativeWei: TokenSelectionDetails[] = []
    const [account0] = await this.origProvider.listAccounts()
    const supportedTokens = await this.tokenPaymasterInteractor.supportedTokens()
    if (supportedTokens.length === 0) {
      throw new Error(`Paymaster ${this.tokenPaymasterInteractor.paymaster.address} does not have configured tokens.`)
    }
    for (const tokenAddress of supportedTokens) {
      const tokenBalance = await this.tokenPaymasterInteractor.tokenBalanceOf(account0, tokenAddress)
      const tokenAllowance = await this.tokenPaymasterInteractor.tokenPaymasterAllowance(account0, tokenAddress)
      const tokenBalanceNativeWei = await this.tokenPaymasterInteractor.tokenToWei(tokenAddress, tokenBalance)
      const tokenAllowanceNativeWei = await this.tokenPaymasterInteractor.tokenToWei(tokenAddress, tokenAllowance)
      tokenBalancesNativeWei.push({
        address: tokenAddress,
        allowance: tokenAllowance,
        allowanceWei: tokenAllowanceNativeWei,
        balance: tokenBalance,
        balanceWei: tokenBalanceNativeWei
      })
    }

    const selectedToken = tokenBalancesNativeWei
      .sort((a, b) => {
        return b.balanceWei.gte(a.balanceWei) ? 1 : -1
      })[0]

    this.logger.info(`Automatically selected token: ${JSON.stringify(selectedToken)}`)
    await this.setToken(selectedToken.address)
  }

  async setToken (permitERC20TokenForGas: Address | SupportedTokenSymbols): Promise<void> {
    const chainId = this.origProvider.network.chainId
    const tokenAddress = getTokenBySymbol(permitERC20TokenForGas as any, chainId) ?? toChecksumAddress(permitERC20TokenForGas.toString())
    if (tokenAddress == null || !isValidChecksumAddress(tokenAddress)) {
      throw new Error(`Unable to find token with name/address ${permitERC20TokenForGas} on chainId ${chainId}`)
    }

    await this.tokenPaymasterInteractor.setToken(tokenAddress)

    const isSupported = await this.tokenPaymasterInteractor.isTokenSupported(tokenAddress)
    if (!isSupported) {
      throw new Error(`token ${tokenAddress} reported as not supported by paymaster ${this.tokenPaymasterInteractor.paymaster.address}`)
    }
    if (this.config.tokenPaymasterDomainSeparators[tokenAddress] == null) {
      throw new Error(`Domain separator not found for token ${tokenAddress}`)
    }
  }
}
