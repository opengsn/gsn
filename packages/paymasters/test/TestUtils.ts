import { PrefixedHexString } from 'ethereumjs-util'
import { constants } from '@openzeppelin/test-helpers'
import { toWei } from 'web3-utils'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { ForwardRequest } from '@opengsn/common/dist/EIP712/ForwardRequest'
import { IStakeManagerInstance, TokenGasCalculatorInstance } from '@opengsn/paymasters/types/truffle-contracts'
import { RelayData } from '@opengsn/common/dist/EIP712/RelayData'
import { RelayHubInstance } from '@opengsn/contracts/types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { defaultEnvironment } from '@opengsn/common'

import { GasUsed } from '../types/truffle-contracts/TokenGasCalculator'

const TestHub = artifacts.require('TestHub')
const TokenGasCalculator = artifacts.require('TokenGasCalculator')

export async function revertReason (func: Promise<any>): Promise<string> {
  try {
    await func
    return 'ok' // no revert
  } catch (e) {
    return e.message.replace(/.*reverted with reason string /, '')
  }
}

export async function registerAsRelayServer (stakeManager: IStakeManagerInstance, relay: string, relayOwner: string, hub: RelayHubInstance): Promise<void> {
  await stakeManager.setRelayManagerOwner(relayOwner, { from: relay })
  await stakeManager.stakeForRelayManager(relay, 7 * 24 * 3600, {
    from: relayOwner,
    value: (2e18).toString()
  })
  await stakeManager.authorizeHubByOwner(relay, hub.address, { from: relayOwner })
  await hub.addRelayWorkers([relay], { from: relay })
  await hub.registerRelayServer(2e16.toString(), '10', 'url', { from: relay })
}

export async function deployTestHub (calculator: boolean = false): Promise<Truffle.ContractInstance> {
  const contract = calculator ? TokenGasCalculator : TestHub
  return await contract.new(
    constants.ZERO_ADDRESS,
    constants.ZERO_ADDRESS,
    defaultEnvironment.relayHubConfiguration.maxWorkerCount,
    defaultEnvironment.relayHubConfiguration.gasReserve,
    defaultEnvironment.relayHubConfiguration.postOverhead,
    defaultEnvironment.relayHubConfiguration.gasOverhead,
    defaultEnvironment.relayHubConfiguration.maximumRecipientDeposit,
    defaultEnvironment.relayHubConfiguration.minimumUnstakeDelay,
    defaultEnvironment.relayHubConfiguration.minimumStake,
    defaultEnvironment.relayHubConfiguration.dataGasCostPerByte,
    defaultEnvironment.relayHubConfiguration.externalCallDataCostOverhead,
    { gas: 10000000 })
}

export function mergeRelayRequest (req: RelayRequest, overrideData: Partial<RelayData>, overrideRequest: Partial<ForwardRequest> = {}): RelayRequest {
  return {
    relayData: { ...req.relayData, ...overrideData },
    request: { ...req.request, ...overrideRequest }
  }
}

export async function calculatePostGas (
  token: any,
  paymaster: any,
  account: Address,
  context: PrefixedHexString
): Promise<BN> {
  const calc = await deployTestHub(true) as TokenGasCalculatorInstance
  await paymaster.setRelayHub(calc.address)
  await token.transfer(paymaster.address, toWei('1', 'ether'), { from: account })
  // TODO: I cannot explain what causes the transaction to revert in a view mode, but this happens consistently;
  //   switching to use the emitted event instead
  const res = await calc.calculatePostGas(paymaster.address, context)
  const event: GasUsed = res.logs.find(it => it.event === 'GasUsed') as unknown as GasUsed
  return event.args.gasUsedByPost
}
