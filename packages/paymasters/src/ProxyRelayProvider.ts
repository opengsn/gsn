/* eslint-disable no-void */
import { RelayClient, JsonRpcCallback, RelayProvider, GSNUnresolvedConstructorInput } from '@opengsn/provider'

import { Address, GsnTransactionDetails } from '@opengsn/common'

import { JsonRpcPayload } from 'web3-core-helpers'
import Contract from 'web3-eth-contract'

import ProxyIdentityArtifact from '@opengsn/paymasters/build/contracts/ProxyIdentity.json'
import ProxyFactoryArtifact from '@opengsn/paymasters/build/contracts/ProxyFactory.json'

export default class ProxyRelayProvider extends RelayProvider {
  private readonly proxyFactoryAddress: Address

  constructor (
    proxyFactoryAddress: Address,
    relayClient: RelayClient) {
    super(
      relayClient)
    this.proxyFactoryAddress = proxyFactoryAddress
  }

  static newProvider (
    input: GSNUnresolvedConstructorInput
  ): RelayProvider {
    throw new Error('Use newProxyRelayProvider() instead')
  }

  static newProxyRelayProvider (
    proxyFactoryAddress: Address,
    input: GSNUnresolvedConstructorInput
  ): ProxyRelayProvider {
    return new ProxyRelayProvider(proxyFactoryAddress, new RelayClient(input))
  }

  async _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): Promise<void> {
    // @ts-ignore
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    this.calculateProxyAddress(gsnTransactionDetails.from).then(proxyAddress => {
      // @ts-ignore
      const proxy = new Contract(ProxyIdentityArtifact.abi, proxyAddress)
      const value = gsnTransactionDetails.value ?? '0'
      // @ts-ignore
      payload.params[0].data = proxy.methods.execute(0, gsnTransactionDetails.to, value, gsnTransactionDetails.data).encodeABI()
      // @ts-ignore
      payload.params[0].to = proxyAddress
      void super._ethSendTransaction(payload, callback)
    })
      .catch(reason => {
        console.log('Failed to calculate proxy address', reason)
      })
  }

  async calculateProxyAddress (owner: Address): Promise<Address> {
    // @ts-ignore
    const proxyFactory = new Contract(ProxyFactoryArtifact.abi, this.proxyFactoryAddress)
    proxyFactory.setProvider(this.origProvider)
    // eslint-disable-next-line @typescript-eslint/return-await
    return await proxyFactory.methods.calculateAddress(owner).call()
  }
}
