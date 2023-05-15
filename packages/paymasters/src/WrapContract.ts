import { Contract, providers } from 'ethers'
import { ExternalProvider, JsonRpcProvider } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'

import { TokenPaymasterProvider } from './TokenPaymasterProvider'
import { GSNConfig, GSNDependencies, GSNUnresolvedConstructorInput } from '@opengsn/provider'

async function wrapContract (
  contract: Contract,
  config: Partial<GSNConfig>,
  overrideDependencies?: Partial<GSNDependencies>
): Promise<Contract> {
  const signer = await wrapSigner(contract.signer, config, overrideDependencies)
  return contract.connect(signer)
}

async function wrapSigner (
  signer: Signer,
  config: Partial<GSNConfig>,
  overrideDependencies?: Partial<GSNDependencies>): Promise<Signer> {
  const provider = signer.provider
  if (provider == null) {
    throw new Error('GSN requires a Signer instance with a provider to wrap it')
  }
  const input: GSNUnresolvedConstructorInput = {
    provider: provider as JsonRpcProvider,
    config,
    overrideDependencies
  }

  // types have a very small conflict about whether "jsonrpc" field is actually required so not worth wrapping again
  const gsnProvider = await TokenPaymasterProvider.newWeb3Provider(input) as any as ExternalProvider
  const ethersProvider = new providers.Web3Provider(gsnProvider)
  const address = await signer.getAddress()
  return ethersProvider.getSigner(address)
}

export const TokenPaymasterEthersWrapper = {
  wrapContract,
  wrapSigner
}
