import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { SampleRecipientInstance, WhitelistPaymasterInstance } from '../types/truffle-contracts'

import { GSNUnresolvedConstructorInput, RelayProvider, GSNConfig } from '@opengsn/provider'
import { GsnTestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { expectRevert } from '@openzeppelin/test-helpers'

import { HttpProvider } from 'web3-core'

const WhitelistPaymaster = artifacts.require('WhitelistPaymaster')
const SampleRecipient = artifacts.require('SampleRecipient')

contract('WhitelistPaymaster', ([from, another]) => {
  // @ts-ignore
  const currentProviderHost = web3.currentProvider.host
  const provider = new StaticJsonRpcProvider(currentProviderHost)

  let pm: WhitelistPaymasterInstance
  let s: SampleRecipientInstance
  let s1: SampleRecipientInstance
  let gsnConfig: Partial<GSNConfig>
  before(async function () {
    const host = (web3.currentProvider as HttpProvider).host
    const {
      contractsDeployment: {
        relayHubAddress,
        forwarderAddress
      }
    } = await GsnTestEnvironment.startGsn(host)

    s = await SampleRecipient.new()
    s1 = await SampleRecipient.new()
    await s.setForwarder(forwarderAddress!)
    await s1.setForwarder(forwarderAddress!)

    pm = await WhitelistPaymaster.new()
    await pm.setRelayHub(relayHubAddress!)
    await pm.setTrustedForwarder(forwarderAddress!)
    await web3.eth.sendTransaction({ from, to: pm.address, value: 1e18 })

    console.log('pm', pm.address)
    console.log('s', s.address)
    console.log('s1', s1.address)
    gsnConfig = {
      loggerConfiguration: {
        logLevel: 'error'
      },
      paymasterAddress: pm.address
    }

    const input: GSNUnresolvedConstructorInput = {
      provider,
      config: gsnConfig
    }
    const p = await RelayProvider.newWeb3Provider(input)
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)
  })

  it('should allow a call without any whitelist', async function () {
    await s.something()
  })

  describe('with whitelisted sender', () => {
    before(async () => {
      await pm.whitelistSender(from, true)
      await pm.setConfiguration(true, false, false, true)
    })
    it('should allow whitelisted sender', async () => {
      await s.something()
    })
    it('should prevent non-whitelisted sender', async () => {
      await expectRevert(s.something({ from: another }), 'sender not whitelisted')
    })
  })
  describe('with whitelisted target', () => {
    before(async () => {
      await pm.whitelistTarget(s1.address, true)
      await pm.setConfiguration(false, true, false, true)
    })
    it('should allow whitelisted target', async () => {
      await s1.something()
    })
    it('should prevent non-whitelisted target', async () => {
      await expectRevert(s.something(), 'target not whitelisted')
    })
  })

  describe('with whitelisted method', () => {
    before(async () => {
      const somethingEncoded = s.contract.methods.something().encodeABI()
      const methodId = somethingEncoded.substr(0, 10)
      await pm.whitelistMethod(s.address, methodId, true)
      await pm.setConfiguration(false, false, true, true)
    })
    it('should allow whitelisted target and method', async () => {
      await s.something()
    })
    it('should prevent non-whitelisted method', async () => {
      await expectRevert(s.nothing(), 'method not whitelisted')
    })
    it('should prevent whitelisted method on wrong target', async () => {
      await expectRevert(s1.something(), 'method not whitelisted')
    })
  })
})
