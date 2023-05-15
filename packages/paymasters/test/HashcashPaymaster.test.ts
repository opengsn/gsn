import { StaticJsonRpcProvider } from '@ethersproject/providers'
import {
  createHashcashAsyncApproval, calculateHashcashApproval, calculateHashcash
} from '../src/HashCashApproval'
import { HashcashPaymasterInstance, SampleRecipientInstance } from '../types/truffle-contracts'
import { GSNConfig, RelayProvider } from '@opengsn/provider'
import { RelayRequest } from '@opengsn/common'

import { GsnTestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { expectRevert } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'
import { GSNUnresolvedConstructorInput } from '@opengsn/provider/dist/RelayClient'
import { disableTruffleAutoEstimateGas } from '@opengsn/dev/dist/test/TestUtils'

const HashcashPaymaster = artifacts.require('HashcashPaymaster')
const SampleRecipient = artifacts.require('SampleRecipient')
const IRelayHub = artifacts.require('IRelayHub')

contract('HashcashPaymaster', ([from]) => {
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const provider = new StaticJsonRpcProvider(currentProviderHost)

  let pm: HashcashPaymasterInstance
  let s: SampleRecipientInstance
  let gsnConfig: Partial<GSNConfig>
  let relayHubAddress: string | undefined
  let forwarderAddress: string | undefined

  before(async () => {
    const host = (web3.currentProvider as HttpProvider).host;
    ({
      contractsDeployment: {
        relayHubAddress,
        forwarderAddress
      }
    } = await GsnTestEnvironment.startGsn(host))

    disableTruffleAutoEstimateGas(SampleRecipient)
    s = await SampleRecipient.new()

    await s.setForwarder(forwarderAddress!)

    pm = await HashcashPaymaster.new(10)
    await pm.setRelayHub(relayHubAddress!)
    await pm.setTrustedForwarder(forwarderAddress!)

    const rhub = await IRelayHub.at(relayHubAddress!)
    await rhub.depositFor(pm.address, { value: (1e18).toString() })

    gsnConfig = {
      loggerConfiguration: {
        logLevel: 'error'
      },
      maxApprovalDataLength: 65,
      performDryRunViewRelayCall: false,
      paymasterAddress: pm.address
    }
  })

  after(async function () {
    await GsnTestEnvironment.stopGsn()
  })

  it('should fail to send without approvalData', async () => {
    const input: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig
    }
    const p = await RelayProvider.newWeb3Provider(input)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)
    await expectRevert(s.something(), 'approvalData: invalid length for hash and nonce')
  })

  it('should fail with no wrong hash', async () => {
    const input: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: async () => '0x'.padEnd(2 + 64 * 2, '0')
        }
    }
    const p = await RelayProvider.newWeb3Provider(input)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)

    await expectRevert(s.something(), 'wrong hash')
  })

  it('should fail low difficulty', async () => {
    const input: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: createHashcashAsyncApproval(1)
        }
    }
    const p = await RelayProvider.newWeb3Provider(input)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)

    return expectRevert(s.something(), 'difficulty not met')
  })

  it('should succeed with proper difficulty', async function () {
    this.timeout(60000)

    const input: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: createHashcashAsyncApproval(15)
        }
    }
    const p = await RelayProvider.newWeb3Provider(input)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)

    await s.something()
    await s.something()
    await s.something()
  })

  it('calculateHashCash should call periodically a callback', async () => {
    let counter = 0

    function cb (): boolean {
      counter++
      return true
    }

    // 15 bit difficulty 2^12 =~ 4096. avg counter 2000
    await calculateHashcash('0x'.padEnd(42, '1'), '1', 12, 1000, cb)
    assert.isAtLeast(counter, 3)
  })

  it('should calculate approval in advance', async () => {
    const approval = await calculateHashcashApproval(web3, from, s.address, forwarderAddress ?? '', pm.address)
    console.log('approval=', approval)
    const input: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig,
      overrideDependencies: {
        asyncApprovalData: async (req: RelayRequest) => {
          // console.log('req=', req)
          return approval!
        }
      }
    }
    const p = await RelayProvider.newWeb3Provider(input)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)

    await s.something()
  })
  it('should refuse to reuse the same approvalData', async function () {
    this.timeout(35000)
    // read next valid hashash approval data, and always return it.
    const approvalfunc = createHashcashAsyncApproval(15)
    let saveret: string

    const input: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: async (request: RelayRequest) => {
            saveret = await approvalfunc(request) ?? ''
            return saveret
          }
        }
    }
    const p = await RelayProvider.newWeb3Provider(input)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)
    await s.something()

    const input1: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: async (req: RelayRequest) => saveret
        }
    }
    const p1 = await RelayProvider.newWeb3Provider(input1)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p1)
    return expectRevert(s.something(), 'wrong hash')
  })
})
