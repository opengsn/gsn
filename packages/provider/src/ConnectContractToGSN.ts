import { type Contract as ContractV6, type BaseContract as BaseContractV6 } from 'ethers'

import { RelayProvider } from './RelayProvider'
import { type GSNConfig, type GSNDependencies } from './GSNConfigurator'

/**
 * @experimental support for Ethers.js v6 in GSN is highly experimental!
 * Creates a new instance of the GSN Signer and connects the given contract to it.
 * @returns a new contract instance
 */
export async function connectContractV6ToGSN (
  contract: ContractV6,
  config: Partial<GSNConfig>,
  overrideDependencies?: Partial<GSNDependencies>
): Promise<BaseContractV6> {
  const signer = contract.runner as any
  if (signer == null) {
    throw new Error('contract not connected!')
  }
  const { gsnSigner } = await RelayProvider.newEthersV6Provider({
    provider: signer, config, overrideDependencies
  })
  return contract.connect(gsnSigner)
}
