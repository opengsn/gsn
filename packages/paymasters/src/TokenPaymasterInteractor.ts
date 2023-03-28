import BN from 'bn.js'

import { JsonRpcProvider, ExternalProvider } from '@ethersproject/providers'

import { Address, Contract, TruffleContract, wrapWeb3JsProvider } from '@opengsn/common/dist'
import {
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance
} from '../types/truffle-contracts'
import PermitERC20UniswapV3Paymaster from './interfaces/PermitERC20UniswapV3Paymaster.json'
import PermitInterfaceDAI from './interfaces/PermitInterfaceDAI.json'
import PermitInterfaceEIP2612 from './interfaces/PermitInterfaceEIP2612.json'

export class TokenPaymasterInteractor {
  private readonly provider: JsonRpcProvider
  private readonly PermitInterfaceDAIToken: Contract<PermitInterfaceDAIInstance>
  private readonly PermitInterfaceEIP2612Token: Contract<PermitInterfaceEIP2612Instance>
  private readonly PermitERC20UniswapV3Paymaster: Contract<PermitERC20UniswapV3PaymasterInstance>
  private readonly paymasterAddress: Address
  private readonly tokenAddress: Address

  paymaster!: PermitERC20UniswapV3PaymasterInstance
  token!: PermitInterfaceDAIInstance

  constructor (
    provider: JsonRpcProvider | ExternalProvider,
    paymasterAddress: Address,
    tokenAddress: Address
  ) {
    this.paymasterAddress = paymasterAddress
    this.tokenAddress = tokenAddress
    this.provider = wrapWeb3JsProvider(provider)
    this.PermitInterfaceDAIToken = TruffleContract({
      contractName: 'PermitInterfaceDAIToken',
      abi: PermitInterfaceDAI
    })
    this.PermitInterfaceEIP2612Token = TruffleContract({
      contractName: 'PermitInterfaceEIP2612Token',
      abi: PermitInterfaceEIP2612
    })
    this.PermitERC20UniswapV3Paymaster = TruffleContract({
      contractName: 'PermitERC20UniswapV3Paymaster',
      abi: PermitERC20UniswapV3Paymaster
    })
    this.PermitInterfaceDAIToken.setProvider(this.provider, undefined)
    this.PermitInterfaceEIP2612Token.setProvider(this.provider, undefined)
    this.PermitERC20UniswapV3Paymaster.setProvider(this.provider, undefined)
  }

  async init () {
    this.paymaster = await this._createPermitERC20UniswapV3Paymaster(this.paymasterAddress)
    this.token = await this._createPermitInterfaceDAIToken(this.tokenAddress)
  }

  // TODO: when would it matter what kind of token do we have?
  async _createPermitInterfaceDAIToken (address: Address): Promise<PermitInterfaceDAIInstance> {
    return await this.PermitInterfaceDAIToken.at(address)
  }

  //
  // async _createPermitInterfaceEIP2612Token (address: Address): Promise<PermitInterfaceEIP2612Instance> {
  //   return await this.PermitInterfaceEIP2612Token.at(address)
  // }

  async _createPermitERC20UniswapV3Paymaster (address: Address): Promise<PermitERC20UniswapV3PaymasterInstance> {
    return await this.PermitERC20UniswapV3Paymaster.at(address)
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
}
