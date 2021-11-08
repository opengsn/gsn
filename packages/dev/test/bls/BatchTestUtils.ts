import { Address, ObjectMap } from '@opengsn/common/dist/types/Aliases'
import { GSNBatchingContractsDeployment } from '@opengsn/common'

const BLSBatchGateway = artifacts.require('BLSBatchGateway')
const GatewayForwarder = artifacts.require('GatewayForwarder')
const ERC20CacheDecoder = artifacts.require('ERC20CacheDecoder')
const BatchGatewayCacheDecoder = artifacts.require('BatchGatewayCacheDecoder')
const BLSAddressAuthorizationsRegistrar = artifacts.require('BLSAddressAuthorizationsRegistrar')

export async function deployBatchingContractsForHub (relayHub: Address, tokenAddress: Address): Promise<GSNBatchingContractsDeployment> {
  const authorizationsRegistrar = await BLSAddressAuthorizationsRegistrar.new()
  const gatewayForwarder = await GatewayForwarder.new(relayHub)
  const batchGatewayCacheDecoder = await BatchGatewayCacheDecoder.new(gatewayForwarder.address)
  const erc20CacheDecoder = await ERC20CacheDecoder.new()
  const batchGateway = await BLSBatchGateway.new(batchGatewayCacheDecoder.address, authorizationsRegistrar.address, relayHub)
  const calldataDecoders: ObjectMap<Address> = {}
  calldataDecoders[tokenAddress.toLowerCase()] = erc20CacheDecoder.address
  return {
    batchGateway: batchGateway.address,
    batchGatewayCacheDecoder: batchGatewayCacheDecoder.address,
    authorizationsRegistrar: authorizationsRegistrar.address,
    calldataDecoders
  }
}
