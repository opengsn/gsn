import { SampleRecipientInstance, WhitelistPaymasterInstance } from '@opengsn/paymasters/types/truffle-contracts'

import { GSNUnresolvedConstructorInput, RelayProvider, GSNConfig } from '@opengsn/provider'
import { GsnTestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { expectRevert } from '@openzeppelin/test-helpers'

import { HttpProvider } from 'web3-core'

const WhitelistPaymaster = artifacts.require('WhitelistPaymaster')
const SampleRecipient = artifacts.require('SampleRecipient')

contract('WhitelistPaymaster', ([from, another]) => {
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
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig
    }
    const p = RelayProvider.newProvider(input)
    await p.init()
    // @ts-ignore
    SampleRecipient.web3.setProvider(p)
  })

  it('should allow a call without any whitelist', async function () {
    await s.something()
  })

  describe('with whitelisted sender', () => {
    before(async () => {
      await pm.whitelistSender(from)
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
      await pm.whitelistTarget(s1.address)
    })
    it('should allow whitelisted target', async () => {
      await s1.something()
    })
    it('should prevent non-whitelisted target', async () => {
      await expectRevert(s.something(), 'target not whitelisted')
    })
  })
})
