import BN from 'bn.js'

import { JsonRpcProvider, ExternalProvider } from '@ethersproject/providers'

import {
  Address,
  Contract,
  LoggerInterface,
  TruffleContract,
  constants,
  toBN
} from '@opengsn/common'
import { IERC20Instance } from '@opengsn/contracts'
import { IChainlinkOracleInstance, PermitERC20UniswapV3PaymasterInstance } from '../types/truffle-contracts'

import IERC20TokenInterface from '@opengsn/common/dist/interfaces/IERC20Token.json'
import PermitERC20UniswapV3Paymaster from './interfaces/PermitERC20UniswapV3Paymaster.json'
import IChainlinkOracle from './interfaces/IChainlinkOracle.json'
import { wrapInputProviderLike } from '@opengsn/provider'

export interface TokenSwapData {
  priceFeed: string
  reverseQuote: boolean
  uniswapPoolFee: BN
  slippage: BN
  permitMethodSelector: string
  priceDivisor: BN
  validFromBlockNumber: BN
}

export class TokenPaymasterInteractor {
  private provider: JsonRpcProvider
  private ERC20Instance!: Contract<IERC20Instance>
  private PermitERC20UniswapV3Paymaster!: Contract<PermitERC20UniswapV3PaymasterInstance>
  private ChainlinkOracle!: Contract<IChainlinkOracleInstance>
  private readonly paymasterAddress: Address
  private readonly logger: LoggerInterface

  tokenAddress?: Address
  tokenSwapData?: TokenSwapData

  paymaster!: PermitERC20UniswapV3PaymasterInstance
  token!: IERC20Instance

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
    this.ERC20Instance = TruffleContract({
      useEthersV6: false,
      contractName: 'ERC20Instance',
      abi: IERC20TokenInterface
    })
    this.PermitERC20UniswapV3Paymaster = TruffleContract({
      useEthersV6: false,
      contractName: 'PermitERC20UniswapV3Paymaster',
      abi: PermitERC20UniswapV3Paymaster
    })
    this.ChainlinkOracle = TruffleContract({
      useEthersV6: false,
      contractName: 'IChainlinkOracle',
      abi: IChainlinkOracle
    })
    this.ChainlinkOracle.setProvider(this.provider, undefined)
    this.ERC20Instance.setProvider(this.provider, undefined)
    this.PermitERC20UniswapV3Paymaster.setProvider(this.provider, undefined)
    this.paymaster = await this._createPermitERC20UniswapV3Paymaster(this.paymasterAddress)
    return this
  }

  async setToken (tokenAddress: Address): Promise<void> {
    this.tokenAddress = tokenAddress
    this.token = await this._createIERC20Instance(this.tokenAddress)
    this.tokenSwapData = await this.paymaster.getTokenSwapData(tokenAddress)
  }

  async _createIERC20Instance (address: Address): Promise<IERC20Instance> {
    return await this.ERC20Instance.at(address)
  }

  async _createPermitERC20UniswapV3Paymaster (address: Address): Promise<PermitERC20UniswapV3PaymasterInstance> {
    return await this.PermitERC20UniswapV3Paymaster.at(address)
  }

  async _createChainlinkOracleInstance (address: Address): Promise<IChainlinkOracleInstance> {
    return await this.ChainlinkOracle.at(address)
  }

  async getAllowance (owner: Address, spender: Address): Promise<BN> {
    return await this.token.allowance(owner, spender)
  }

  async supportedTokens (): Promise<Address[]> {
    return await this.paymaster.getTokens()
  }

  async isTokenSupported (token: Address): Promise<boolean> {
    return await this.paymaster.isTokenSupported(token)
  }

  async tokenBalanceOf (owner: Address, tokenAddress: Address): Promise<BN> {
    const tokenInstance = await this._createIERC20Instance(tokenAddress)
    return await tokenInstance.balanceOf(owner)
  }

  async tokenPaymasterAllowance (owner: Address, tokenAddress: Address): Promise<BN> {
    const tokenInstance = await this._createIERC20Instance(tokenAddress)
    return await tokenInstance.allowance(owner, this.paymaster.address)
  }

  async tokenToWei (tokenAddress: Address, tokenAmount: BN): Promise<{
    actualQuote: BN
    amountInWei: BN
  }> {
    const tokenSwapData = await this.paymaster.getTokenSwapData(tokenAddress)
    const chainlinkInstance = await this._createChainlinkOracleInstance(tokenSwapData.priceFeed)
    const quote = await chainlinkInstance.latestAnswer()
    const description = `(tokenAddress=${tokenAddress} tokenAmount=${tokenAmount.toString()} priceFeed=${tokenSwapData.priceFeed} quote=${quote.toString()} priceDivisor=${tokenSwapData.priceDivisor.toString()} reverseQuote=${tokenSwapData.reverseQuote})`
    this.logger.debug(`Converting token balance to Ether quote ${description}`)
    try {
      const actualQuote = await this.paymaster.toActualQuote(quote.toString(), tokenSwapData.priceDivisor.toString())
      this.logger.debug(`actualQuote=${actualQuote.toString()}`)
      if (tokenAmount.gt(toBN(10).pow(toBN(30)))) {
        this.logger.debug(`Amount to convert is > 1e30 which is infinity in most cases (tokenAddress=${tokenAddress})`)
        return {
          actualQuote: toBN(0),
          amountInWei: constants.MAX_UINT256
        }
      }
      const amountInWei = await this.paymaster.tokenToWei(tokenAmount.toString(), actualQuote.toString(), tokenSwapData.reverseQuote)
      this.logger.debug(`amountInWei=${amountInWei.toString()}`)
      return { actualQuote, amountInWei }
    } catch (error: any) {
      this.logger.error(`Failed to convert token balance to Ether quote ${description}`)
      this.logger.error(error)
      return {
        actualQuote: toBN(0),
        amountInWei: toBN(0)
      }
    }
  }
}
