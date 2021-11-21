import { Contract, TruffleContract } from '../LightTruffleContract'
import { BLSAddressAuthorizationsRegistrarInstance } from '@opengsn/contracts'
import { Address, Web3ProviderBaseInterface } from '../types/Aliases'

import blsAddressAuthorizationsRegistrarAbi from '../interfaces/IBLSAddressAuthorizationsRegistrar.json'

export class BLSAddressAuthorizationsRegistrarInteractor {
  private readonly BLSAddressAuthorizationsRegistrar: Contract<BLSAddressAuthorizationsRegistrarInstance>
  private readonly addressAuthorizationsRegistrarAddress: Address

  private blsAddressAuthorizationsRegistrarInstance!: BLSAddressAuthorizationsRegistrarInstance

  constructor (_: {
    provider: Web3ProviderBaseInterface
    addressAuthorizationsRegistrarAddress: Address
  }) {
    this.addressAuthorizationsRegistrarAddress = _.addressAuthorizationsRegistrarAddress
    this.BLSAddressAuthorizationsRegistrar = TruffleContract({
      contractName: 'BLSAddressAuthorizationsRegistrar',
      abi: blsAddressAuthorizationsRegistrarAbi
    })
    this.BLSAddressAuthorizationsRegistrar.setProvider(_.provider, undefined)
  }

  async init (): Promise<this> {
    this.blsAddressAuthorizationsRegistrarInstance = await this.BLSAddressAuthorizationsRegistrar.at(this.addressAuthorizationsRegistrarAddress)
    return this
  }

  async getAuthorizedBLSPublicKey (address: Address): Promise<BN[] | null> {
    const publicKey = await this.blsAddressAuthorizationsRegistrarInstance.getAuthorizedPublicKey(address)
    if (publicKey[0].toString() === '0') {
      return null
    }
    return publicKey
  }
}
