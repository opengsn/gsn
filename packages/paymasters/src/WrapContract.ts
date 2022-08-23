import { Contract, providers } from 'ethers'
import { Eip1193Bridge } from '@ethersproject/experimental'
import { ExternalProvider } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'

import { TokenPaymasterConfig, TokenPaymasterProvider } from './TokenPaymasterProvider'
import { GSNDependencies, WrapBridge } from '@opengsn/provider/dist'

export async function wrapContract (
  contract: Contract,
  config: Partial<TokenPaymasterConfig>,
  overrideDependencies?: Partial<GSNDependencies>
): Promise<Contract> {
  const signer = await wrapSigner(contract.signer, config, overrideDependencies)
  return contract.connect(signer)
}

export async function wrapSigner (
  signer: Signer,
  config: Partial<TokenPaymasterConfig>,
  overrideDependencies?: Partial<GSNDependencies>): Promise<Signer> {
  const bridge = new WrapBridge(new Eip1193Bridge(signer, signer.provider))
  const input = {
    provider: bridge,
    config,
    overrideDependencies
  }

  // types have a very small conflict about whether "jsonrpc" field is actually required so not worth wrapping again
  const gsnProvider = await TokenPaymasterProvider.newProvider(input).init() as any as ExternalProvider
  const ethersProvider = new providers.Web3Provider(gsnProvider)
  const address = await signer.getAddress()
  return ethersProvider.getSigner(address)
}
