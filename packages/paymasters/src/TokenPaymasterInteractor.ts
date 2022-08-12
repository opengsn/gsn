import { Address, Contract, TruffleContract, Web3ProviderBaseInterface } from '@opengsn/common/dist'
import {
  PermitERC20UniswapV3PaymasterInstance,
  PermitInterfaceDAIInstance,
  PermitInterfaceEIP2612Instance
} from '../types/truffle-contracts'
import PermitERC20UniswapV3Paymaster from './interfaces/PermitERC20UniswapV3Paymaster.json'
import PermitInterfaceDAI from './interfaces/PermitInterfaceDAI.json'
import PermitInterfaceEIP2612 from './interfaces/PermitInterfaceEIP2612.json'

export class TokenPaymasterInteractor {
  private readonly provider: Web3ProviderBaseInterface
  private readonly PermitInterfaceDAIToken: Contract<PermitInterfaceDAIInstance>
  private readonly PermitInterfaceEIP2612Token: Contract<PermitInterfaceEIP2612Instance>
  private readonly PermitERC20UniswapV3Paymaster: Contract<PermitERC20UniswapV3PaymasterInstance>

  // daiPermittableToken!: PermitInterfaceDAIInstance
  // eip2612PermittableToken!: PermitInterfaceEIP2612Instance
  // permitPaymasterInstance!: PermitERC20UniswapV3PaymasterInstance

  constructor (provider: Web3ProviderBaseInterface) {
    this.provider = provider
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

  async _createPermitInterfaceDAIToken (address: Address): Promise<PermitInterfaceDAIInstance> {
    return await this.PermitInterfaceDAIToken.at(address)
  }

  async _createPermitInterfaceEIP2612Token (address: Address): Promise<PermitInterfaceEIP2612Instance> {
    return await this.PermitInterfaceEIP2612Token.at(address)
  }

  async _createPermitERC20UniswapV3Paymaster (address: Address): Promise<PermitERC20UniswapV3PaymasterInstance> {
    return await this.PermitERC20UniswapV3Paymaster.at(address)
  }
}
