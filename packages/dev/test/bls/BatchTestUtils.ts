import { Address } from '@opengsn/common/dist/types/Aliases'
import { GSNBatchingContractsDeployment } from '@opengsn/common'

const BLSBatchGateway = artifacts.require('BLSBatchGateway')
const GatewayForwarder = artifacts.require('GatewayForwarder')
const BatchGatewayCacheDecoder = artifacts.require('BatchGatewayCacheDecoder')
const BLSAddressAuthorizationsRegistrar = artifacts.require('BLSAddressAuthorizationsRegistrar')

export async function deployBatchingContractsForHub (relayHub: Address): Promise<GSNBatchingContractsDeployment> {
  const authorizationsRegistrar = await BLSAddressAuthorizationsRegistrar.new()
  const gatewayForwarder = await GatewayForwarder.new(relayHub)
  const batchGatewayCacheDecoder = await BatchGatewayCacheDecoder.new(gatewayForwarder.address)
  const batchGateway = await BLSBatchGateway.new(batchGatewayCacheDecoder.address, authorizationsRegistrar.address, relayHub)
  return {
    batchGateway: batchGateway.address,
    batchGatewayCacheDecoder: batchGatewayCacheDecoder.address,
    authorizationsRegistrar: authorizationsRegistrar.address,
  }
}
