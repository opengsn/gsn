import { Contract, providers } from 'ethers'
import { Eip1193Bridge } from '@ethersproject/experimental'
import { ExternalProvider } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'
import { JsonRpcPayload, JsonRpcResponse } from 'web3-core-helpers'

import { Web3ProviderBaseInterface } from '@opengsn/common'

import { RelayProvider } from './RelayProvider'
import { GSNConfig, GSNDependencies } from './GSNConfigurator'

// taken from @ethersproject/providers/src.ts/json-rpc-provider.ts
const allowedTransactionKeys: { [key: string]: boolean } = {
  chainId: true,
  data: true,
  gasLimit: true,
  gasPrice: true,
  nonce: true,
  to: true,
  value: true,
  type: true,
  accessList: true,
  maxFeePerGas: true,
  maxPriorityFeePerGas: true,
  // added by GSN
  from: true
}

// ethers.js throws if transaction details contain illegal keys, even if value is 'undefined'
function preprocessPayload (object: any): any {
  const clear: any = {}
  Object.keys(object).forEach(key => {
    const objectElement = object[key]
    // the reverse gasLimit->gas swap will be done in ethers.js provider, i.e. JsonRpcProvider
    if (key === 'gas') {
      key = 'gasLimit'
    }
    if (objectElement !== undefined && allowedTransactionKeys[key]) {
      clear[key] = objectElement
    }
  })
  return clear
}

export class WrapBridge implements Web3ProviderBaseInterface {
  constructor (readonly bridge: Eip1193Bridge) {}

  send (payload: JsonRpcPayload, callback: (error: Error | null, result?: JsonRpcResponse) => void): void {
    let origProviderPromise: Promise<any>
    // eth_call in ethers.js does not support passing fake "from" address, but we rely on this feature for dry-run
    if (payload.method === 'eth_call' && payload.params != null) {
      const preprocessed = preprocessPayload(payload.params[0])
      const req = providers.JsonRpcProvider.hexlifyTransaction(preprocessed, { from: true })
      origProviderPromise = this.bridge.provider.call(req, payload.params[1])
    } else {
      origProviderPromise = this.bridge.send(payload.method, payload.params)
    }
    origProviderPromise
      .then(result => {
        const jsonRpcResponse = {
          jsonrpc: '2.0',
          id: payload.id ?? '',
          result
        }
        callback(null, jsonRpcResponse)
      })
      .catch(error => {
        callback(error)
      })
  }
}

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
  const bridge = new WrapBridge(new Eip1193Bridge(signer, signer.provider))
  const input = {
    provider: bridge,
    config,
    overrideDependencies
  }

  // types have a very small conflict about whether "jsonrpc" field is actually required so not worth wrapping again
  const gsnProvider = await RelayProvider.newProvider(input).init() as any as ExternalProvider
  const ethersProvider = new providers.Web3Provider(gsnProvider)
  const address = await signer.getAddress()
  return ethersProvider.getSigner(address)
}
