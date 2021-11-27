import { Contract, TruffleContract } from '../LightTruffleContract'
import { BLSVerifierContractInstance } from '@opengsn/contracts'
import { Address, Web3ProviderBaseInterface } from '../types/Aliases'

import blsVerifierContractAbi from '../interfaces/IBLSVerifierContract.json'

export class BLSVerifierInteractor {
  private readonly BLSVerifierContract: Contract<BLSVerifierContractInstance>
  private readonly blsVerifierContractAddress: Address

  private blsVerifierContractInstanceInstance!: BLSVerifierContractInstance

  constructor (_: {
    provider: Web3ProviderBaseInterface
    blsVerifierContractAddress: Address
  }) {
    this.blsVerifierContractAddress = _.blsVerifierContractAddress
    this.BLSVerifierContract = TruffleContract({
      contractName: 'BLSVerifierContract',
      abi: blsVerifierContractAbi
    })
    this.BLSVerifierContract.setProvider(_.provider, undefined)
  }

  async init (): Promise<this> {
    this.blsVerifierContractInstanceInstance = await this.BLSVerifierContract.at(this.blsVerifierContractAddress)
    return this
  }

  async verifySingle (signature: BN[], pubkey: BN[], message: BN[]): Promise<boolean> {
    try {
      return await this.blsVerifierContractInstanceInstance.verifySingle(signature, pubkey, message)
    } catch (e) {
      console.log(e)
      return false
    }
  }

  async verifyMultiple (signature: BN[], pubkey: BN[][], message: BN[][]): Promise<boolean> {
    try {
      return await this.blsVerifierContractInstanceInstance.verifyMultiple(signature, pubkey, message)
    } catch (e) {
      console.log(e)
      return false
    }
  }
}
