import { PrefixedHexString, isValidAddress } from 'ethereumjs-util'

import {
  GSNUnresolvedConstructorInput,
  RelayClient,
  RelayProvider,
  getPaymasterAddressByTypeAndChain,
  toBN
} from '@opengsn/provider'

import {
  Address,
  EIP712Domain,
  EIP712DomainType,
  EIP712DomainTypeWithoutVersion,
  RelayRequest,
  SupportedTokenSymbols,
  constants,
  getTokenBySymbol,
  removeHexPrefix
} from '@opengsn/common'

import {
  MAX_PAYMASTERDATA_LENGTH,
  PERMIT_SELECTOR_DAI
} from './constants/MainnetPermitERC20UniswapV3PaymasterConstants'

import { signAndEncodeDaiPermit, signAndEncodeEIP2612Permit } from './PermitPaymasterUtils'
import { TokenPaymasterInteractor } from './TokenPaymasterInteractor'

interface TokenSelectionDetails {
  address: string
  balance: string
  chainlinkQuote: string
  // token balance converted to the native chain currency
  balanceWei: string
  allowance: string
  // token allowance converted to the native chain currency
  allowanceWei: string
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

    const paymasterAddress = getPaymasterAddressByTypeAndChain(this.config?.paymasterAddress, chainId, this.logger)
    this.tokenPaymasterInteractor = new TokenPaymasterInteractor(this.origProvider, paymasterAddress as any, this.logger)
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
      const { amountInWei: tokenBalanceNativeWei, actualQuote } =
        await this.tokenPaymasterInteractor.tokenToWei(tokenAddress, tokenBalance)
      const { amountInWei: tokenAllowanceNativeWei } =
        await this.tokenPaymasterInteractor.tokenToWei(tokenAddress, tokenAllowance)
      tokenBalancesNativeWei.push({
        address: tokenAddress,
        chainlinkQuote: actualQuote.toString(),
        allowance: tokenAllowance.toString(),
        allowanceWei: tokenAllowanceNativeWei.toString(),
        balance: tokenBalance.toString(),
        balanceWei: tokenBalanceNativeWei.toString()
      })
    }

    const selectedToken = tokenBalancesNativeWei
      .sort((a, b) => {
        return toBN(b.balanceWei).gte(toBN(a.balanceWei)) ? 1 : -1
      })[0]

    this.logger.debug(`TokenPaymasterProvider initialized with no token selected and automatically selected token: ${JSON.stringify(selectedToken)}`)
    await this.setToken(selectedToken.address)
  }

  async setToken (permitERC20TokenForGas: Address | SupportedTokenSymbols): Promise<void> {
    const chainId = this.origProvider.network.chainId
    const tokenAddress = getTokenBySymbol(permitERC20TokenForGas as any, chainId) ?? permitERC20TokenForGas.toString().toLowerCase()
    if (tokenAddress == null || !isValidAddress(tokenAddress)) {
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
