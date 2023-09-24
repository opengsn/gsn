import { type Contract, providers } from 'ethers'
import { type ExternalProvider, type JsonRpcProvider } from '@ethersproject/providers'
import { type Signer } from '@ethersproject/abstract-signer'

import { TokenPaymasterProvider } from './TokenPaymasterProvider'
import {
  type Address,
  type GSNConfig,
  type GSNDependencies,
  type GSNUnresolvedConstructorInput,
  type SupportedTokenSymbols
} from '@opengsn/provider'

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
  overrideDependencies?: Partial<GSNDependencies>,
  permitERC20TokenForGas?: Address | SupportedTokenSymbols): Promise<Signer> {
  const provider = signer.provider
  if (provider == null) {
    throw new Error('GSN requires a Signer instance with a provider to wrap it')
  }
  const input: GSNUnresolvedConstructorInput = {
    provider: provider as JsonRpcProvider,
    config,
    overrideDependencies
  }

  const gsnProvider = await TokenPaymasterProvider.newProvider(input).init(permitERC20TokenForGas)
  const gsnExternalProvider = gsnProvider as any as ExternalProvider
  const ethersProvider = new providers.Web3Provider(gsnExternalProvider)
  const address = await signer.getAddress()
  return ethersProvider.getSigner(address)
}

export const TokenPaymasterEthersWrapper = {
  wrapContract,
  wrapSigner
}
