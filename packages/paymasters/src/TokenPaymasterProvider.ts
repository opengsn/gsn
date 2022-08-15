// import abiDecoder from 'abi-decoder'

import BN from 'bn.js'
import { RelayClient, RelayProvider, GSNUnresolvedConstructorInput } from '@opengsn/provider'
import { PrefixedHexString } from 'ethereumjs-util'
import { Address, removeHexPrefix, Web3ProviderBaseInterface } from '@opengsn/common/dist'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'
import {
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance
} from '@opengsn/paymasters/types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import {
  getDaiDomainSeparator, getUniDomainSeparator, PERMIT_SIGHASH_DAI, PERMIT_SIGHASH_EIP2612,
  PERMIT_SIGNATURE_DAI,
  PERMIT_SIGNATURE_EIP2612,
  signAndEncodeDaiPermit,
  signAndEncodeEIP2612Permit
} from './PermitPaymasterUtils'
import { constants } from '@opengsn/common/dist/Constants'
import { EIP712DomainType, EIP712DomainTypeWithoutVersion } from '@opengsn/common/dist/EIP712/TypedRequestData'
import { TokenPaymasterInteractor } from './TokenPaymasterInteractor'
// import abiCoder, { AbiCoder } from 'web3-eth-abi'

// const abi: AbiCoder = abiCoder as any

// abiDecoder.addABI(PermitERC20UniswapV3Paymaster.abi)

export interface TokenPaymasterConfig extends GSNConfig {
  tokenAddress: Address
  permitAmount?: string | number | BN
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

  constructor (relayClient: RelayClient, provider: Web3ProviderBaseInterface) {
    super(relayClient)
    this.tokenPaymasterInteractor = new TokenPaymasterInteractor(provider)
  }

  static newProvider (input: TokenPaymasterUnresolvedConstructorInput): TokenPaymasterProvider {
    const provider = new TokenPaymasterProvider(new RelayClient(input), input.provider)
    // input.overrideDependencies = input.overrideDependencies ?? {}
    // input.overrideDependencies.asyncPaymasterData = provider._buildPaymasterData.bind(provider)
    return provider
  }

  async init (): Promise<this> {
    await super.init(true)
    this.relayClient.dependencies.asyncPaymasterData = this._buildPaymasterData.bind(this)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.paymaster = await this.tokenPaymasterInteractor._createPermitERC20UniswapV3Paymaster(this.relayClient.config.tokenPaymasterAddress!)
    if (this.config.tokenAddress != null) {
      await this.useToken(this.config.tokenAddress)
    }
    return this
  }

  async _buildPaymasterData (relayRequest: RelayRequest): Promise<PrefixedHexString> {
    //  Optionally encode permit method,then concatenate token address
    if (relayRequest.relayData.paymaster !== this.paymaster.address) {
      throw new Error('Paymaster address mismatch')
    }
    const allowance = await this.token.allowance(relayRequest.request.from, relayRequest.relayData.paymaster)
    let permitMethod = ''
    // todo: decide domain separator and type based on token given
    if (allowance.eqn(0)) {
      if (this.permitSignature === PERMIT_SIGNATURE_DAI) {
        permitMethod = await signAndEncodeDaiPermit(
          relayRequest.request.from,
          relayRequest.relayData.paymaster,
          this.token.address,
          constants.MAX_UINT256.toString(),
          this.web3,
          getDaiDomainSeparator()
        )
      } else {
        const domainSeparator = getUniDomainSeparator()
        permitMethod = await signAndEncodeEIP2612Permit(
          relayRequest.request.from,
          relayRequest.relayData.paymaster,
          this.token.address,
          constants.MAX_UINT256.toString(),
          constants.MAX_UINT256.toString(),
          this.web3,
          domainSeparator,
          domainSeparator.version == null ? EIP712DomainTypeWithoutVersion : EIP712DomainType
        )
      }
    }
    // return abi.encodeParameters(['bytes', 'address'], [permitMethod, this.token.address])
    return removeHexPrefix(permitMethod) + removeHexPrefix(this.token.address)
  }

  async useToken (tokenAddress: Address): Promise<void> {
    const isSupported = await this.isTokenSupported(tokenAddress)
    if (!isSupported) {
      throw new Error(`token ${tokenAddress} not supported`)
    }
    this.config.tokenAddress = tokenAddress
    const permitSigHash = await this.paymaster.permitMethodSignatures(tokenAddress)
    if (permitSigHash === PERMIT_SIGHASH_DAI) {
      this.permitSignature = PERMIT_SIGNATURE_DAI
      this.token = await this.tokenPaymasterInteractor._createPermitInterfaceDAIToken(tokenAddress)
    } else if (permitSigHash === PERMIT_SIGHASH_EIP2612) {
      this.permitSignature = PERMIT_SIGNATURE_EIP2612
      this.token = await this.tokenPaymasterInteractor._createPermitInterfaceEIP2612Token(tokenAddress)
    } else {
      throw new Error(`Unknown permit signature hash ${permitSigHash}`)
    }
  }

  async supportedTokens (): Promise<Address[]> {
    return await this.paymaster.getTokens()
  }

  async isTokenSupported (token: Address): Promise<boolean> {
    return await this.paymaster.isTokenSupported(token)
  }
}
