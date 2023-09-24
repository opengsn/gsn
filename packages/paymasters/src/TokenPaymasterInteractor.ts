import { type JsonRpcProvider, type ExternalProvider } from '@ethersproject/providers'

import {
  type Address,
  type LoggerInterface,
  constants
} from '@opengsn/common'
import { type IERC20 } from '@opengsn/contracts'
import {
  type IChainlinkOracle, IChainlinkOracle__factory,
  IERC20__factory,
  type PermitERC20UniswapV3Paymaster,
  PermitERC20UniswapV3Paymaster__factory
} from '../types/ethers-contracts'

import { wrapInputProviderLike } from '@opengsn/provider'
import { BigNumber } from 'ethers'

export interface TokenSwapData {
  priceFeed: string
  reverseQuote: boolean
  uniswapPoolFee: number
  slippage: number
  permitMethodSelector: string
  priceDivisor: BigNumber
  validFromBlockNumber: BigNumber
}

export class TokenPaymasterInteractor {
  private provider: JsonRpcProvider
  private readonly paymasterAddress: Address
  private readonly logger: LoggerInterface

  tokenAddress?: Address
  tokenSwapData?: TokenSwapData

  paymaster!: PermitERC20UniswapV3Paymaster
  token!: IERC20

  constructor (
    provider: JsonRpcProvider | ExternalProvider,
    paymasterAddress: Address,
    logger: LoggerInterface
  ) {
    this.paymasterAddress = paymasterAddress
    this.logger = logger
    this.provider = provider as any
  }

  async init (): Promise<this> {
    this.provider = (await wrapInputProviderLike(this.provider)).provider
    this.paymaster = await this._createPermitERC20UniswapV3Paymaster(this.paymasterAddress)
    return this
  }

  async setToken (tokenAddress: Address): Promise<void> {
    this.tokenAddress = tokenAddress
    this.token = await this._createIERC20Instance(this.tokenAddress)
    this.tokenSwapData = await this.paymaster.getTokenSwapData(tokenAddress)
  }

  async _createIERC20Instance (address: Address): Promise<IERC20> {
    return IERC20__factory.connect(address, this.provider)
  }

  async _createPermitERC20UniswapV3Paymaster (address: Address): Promise<PermitERC20UniswapV3Paymaster> {
    return PermitERC20UniswapV3Paymaster__factory.connect(address, this.provider)
  }

  async _createChainlinkOracleInstance (address: Address): Promise<IChainlinkOracle> {
    return IChainlinkOracle__factory.connect(address, this.provider)
  }

  async getAllowance (owner: Address, spender: Address): Promise<BigNumber> {
    return await this.token.allowance(owner, spender)
  }

  async supportedTokens (): Promise<Address[]> {
    return await this.paymaster.getTokens()
  }

  async isTokenSupported (token: Address): Promise<boolean> {
    return await this.paymaster.isTokenSupported(token)
  }

  async tokenBalanceOf (owner: Address, tokenAddress: Address): Promise<BigNumber> {
    const tokenInstance = await this._createIERC20Instance(tokenAddress)
    return await tokenInstance.balanceOf(owner)
  }

  async tokenPaymasterAllowance (owner: Address, tokenAddress: Address): Promise<BigNumber> {
    const tokenInstance = await this._createIERC20Instance(tokenAddress)
    return await tokenInstance.allowance(owner, this.paymaster.address)
  }

  async tokenToWei (tokenAddress: Address, tokenAmount: BigNumber): Promise<{
    actualQuote: BigNumber
    amountInWei: BigNumber
  }> {
    const tokenSwapData = await this.paymaster.getTokenSwapData(tokenAddress)
    const chainlinkInstance = await this._createChainlinkOracleInstance(tokenSwapData.priceFeed)
    const quote = await chainlinkInstance.latestAnswer()
    const description = `(tokenAddress=${tokenAddress} tokenAmount=${tokenAmount.toString()} priceFeed=${tokenSwapData.priceFeed} quote=${quote.toString()} priceDivisor=${tokenSwapData.priceDivisor.toString()} reverseQuote=${tokenSwapData.reverseQuote})`
    this.logger.debug(`Converting token balance to Ether quote ${description}`)
    try {
      const actualQuote = await this.paymaster.toActualQuote(quote.toString(), tokenSwapData.priceDivisor.toString())
      this.logger.debug(`actualQuote=${actualQuote.toString()}`)
      if (tokenAmount.gt(BigNumber.from(10).pow(30))) {
        this.logger.debug(`Amount to convert is > 1e30 which is infinity in most cases (tokenAddress=${tokenAddress})`)
        return {
          actualQuote: BigNumber.from(0),
          amountInWei: BigNumber.from(constants.MAX_UINT256.toString())
        }
      }
      const amountInWei = await this.paymaster.tokenToWei(tokenAmount.toString(), actualQuote.toString(), tokenSwapData.reverseQuote)
      this.logger.debug(`amountInWei=${amountInWei.toString()}`)
      return { actualQuote, amountInWei }
    } catch (error: any) {
      this.logger.error(`Failed to convert token balance to Ether quote ${description}`)
      this.logger.error(error)
      return {
        actualQuote: BigNumber.from(0),
        amountInWei: BigNumber.from(0)
      }
    }
  }
}
