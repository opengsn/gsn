import { PrefixedHexString } from 'ethereumjs-util'
import { constants, ether } from '@openzeppelin/test-helpers'
import { toWei } from 'web3-utils'

import { Address } from '@opengsn/common/dist/types/Aliases'
import { ForwardRequest } from '@opengsn/common/dist/EIP712/ForwardRequest'
import { StakeManagerInstance, TokenGasCalculatorInstance } from '@opengsn/paymasters/types/truffle-contracts'
import { RelayData } from '@opengsn/common/dist/EIP712/RelayData'
import { RelayHubInstance, TestTokenInstance } from '@opengsn/contracts/types/truffle-contracts'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { defaultEnvironment } from '@opengsn/common'

import { GasUsed } from '../types/truffle-contracts/TokenGasCalculator'

const TestHub = artifacts.require('TestHub')
const TokenGasCalculator = artifacts.require('TokenGasCalculator')
const RelayRegistrar = artifacts.require('RelayRegistrar')

export async function revertReason (func: Promise<any>): Promise<string> {
  try {
    await func
    return 'ok' // no revert
  } catch (e) {
    return e.message.replace(/.*reverted with reason string /, '')
  }
}

export async function registerAsRelayServer (testToken: TestTokenInstance, stakeManager: StakeManagerInstance, relay: string, relayOwner: string, hub: RelayHubInstance): Promise<void> {
  const stake = ether('2')
  await testToken.mint(stake, { from: relayOwner })
  await testToken.approve(stakeManager.address, stake, { from: relayOwner })
  await stakeManager.setRelayManagerOwner(relayOwner, { from: relay })
  await stakeManager.stakeForRelayManager(testToken.address, relay, 7 * 24 * 3600, stake.toString(), {
    from: relayOwner
  })
  await stakeManager.authorizeHubByOwner(relay, hub.address, { from: relayOwner })
  await hub.setMinimumStakes([testToken.address], [stake])
  await hub.addRelayWorkers([relay], { from: relay })
  const relayRegistrar = await RelayRegistrar.at(await hub.getRelayRegistrar())
  await relayRegistrar.registerRelayServer(2e16.toString(), '10', 'url', { from: relay })
}

export async function deployTestHub (calculator: boolean = false): Promise<Truffle.ContractInstance> {
  const contract = calculator ? TokenGasCalculator : TestHub
  return await contract.new(
    constants.ZERO_ADDRESS,
    constants.ZERO_ADDRESS,
    constants.ZERO_ADDRESS,
    defaultEnvironment.relayHubConfiguration,
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
