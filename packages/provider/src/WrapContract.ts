import { Contract, providers } from 'ethers'
import { ExternalProvider, JsonRpcProvider } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'

import { RelayProvider } from './RelayProvider'
import { GSNConfig, GSNDependencies } from './GSNConfigurator'
import { GSNUnresolvedConstructorInput } from './RelayClient'

export async function wrapContract (
  contract: Contract,
  config: Partial<GSNConfig>,
  overrideDependencies?: Partial<GSNDependencies>
): Promise<Contract> {
  const signer = await wrapSigner(contract.signer, config, overrideDependencies)
  return contract.connect(signer)
}

export async function wrapSigner (
  signer: Signer,
  config: Partial<GSNConfig>,
  overrideDependencies?: Partial<GSNDependencies>): Promise<Signer> {
  const provider = signer.provider
  if (provider == null) {
    throw new Error('GSN requires a Signer instance with a provider to wrap it')
  }
  const input: GSNUnresolvedConstructorInput = {
    // TODO: we don't use anything JsonRpcProvider - specific, but 'getSigner' is not defined on base provider
    provider: provider as JsonRpcProvider,
    config,
    overrideDependencies
  }

  // types have a very small conflict about whether "jsonrpc" field is actually required so not worth wrapping again
  // @ts-ignore
  const gsnProvider = await RelayProvider.newProvider(input).init() as any as ExternalProvider
  const ethersProvider = new providers.Web3Provider(gsnProvider)
  const address = await signer.getAddress()
  return ethersProvider.getSigner(address)
}
