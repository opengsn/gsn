import BN from 'bn.js'

import { JsonRpcProvider, ExternalProvider } from '@ethersproject/providers'

import { Address, Contract, TruffleContract, wrapWeb3JsProvider } from '@opengsn/common'
import { IERC20Instance } from '@opengsn/contracts'
import { IChainlinkOracleInstance, PermitERC20UniswapV3PaymasterInstance } from '../types/truffle-contracts'

import IERC20TokenInterface from '@opengsn/common/dist/interfaces/IERC20Token.json'
import PermitERC20UniswapV3Paymaster from './interfaces/PermitERC20UniswapV3Paymaster.json'
import IChainlinkOracle from './interfaces/IChainlinkOracle.json'

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
  private readonly provider: JsonRpcProvider
  private readonly ERC20Instance: Contract<IERC20Instance>
  private readonly PermitERC20UniswapV3Paymaster: Contract<PermitERC20UniswapV3PaymasterInstance>
  private readonly ChainlinkOracle: Contract<IChainlinkOracleInstance>
  private readonly paymasterAddress: Address

  tokenAddress?: Address
  tokenSwapData?: TokenSwapData

  paymaster!: PermitERC20UniswapV3PaymasterInstance
  token!: IERC20Instance

  constructor (
    provider: JsonRpcProvider | ExternalProvider,
    paymasterAddress: Address
  ) {
    this.paymasterAddress = paymasterAddress
    this.provider = wrapWeb3JsProvider(provider)
    this.ERC20Instance = TruffleContract({
      contractName: 'ERC20Instance',
      abi: IERC20TokenInterface
    })
    this.PermitERC20UniswapV3Paymaster = TruffleContract({
      contractName: 'PermitERC20UniswapV3Paymaster',
      abi: PermitERC20UniswapV3Paymaster
    })
    this.ChainlinkOracle = TruffleContract({
      contractName: 'IChainlinkOracle',
      abi: IChainlinkOracle
    })
    this.ChainlinkOracle.setProvider(this.provider, undefined)
    this.ERC20Instance.setProvider(this.provider, undefined)
    this.PermitERC20UniswapV3Paymaster.setProvider(this.provider, undefined)
  }

  async init (): Promise<this> {
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
    const actualQuote = await this.paymaster.toActualQuote(quote.toString(), tokenSwapData.priceDivisor.toString())
    const amountInWei = await this.paymaster.tokenToWei(tokenAmount.toString(), actualQuote.toString(), tokenSwapData.reverseQuote)
    return { actualQuote, amountInWei }
  }
}
