import { AbiCoder, Interface } from '@ethersproject/abi'
import { HttpProvider } from 'web3-core'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { expectRevert } from '@openzeppelin/test-helpers'

import { GsnTestEnvironment } from '@opengsn/cli'
import { GSNConfig, GSNUnresolvedConstructorInput, RelayProvider, toBN } from '@opengsn/provider'

import { SampleRecipientInstance, SingletonWhitelistPaymasterInstance } from '../types/truffle-contracts'

const SingletonWhitelistPaymaster = artifacts.require('SingletonWhitelistPaymaster')
const SampleRecipient = artifacts.require('SampleRecipient')
const RelayHub = artifacts.require('RelayHub')

contract.only('SingletonWhitelistPaymaster',
  function (
    [owner1, owner2, from, from2, another]) {
    // @ts-ignore
    const currentProviderHost = web3.currentProvider.host
    const provider = new StaticJsonRpcProvider(currentProviderHost)

    let pm: SingletonWhitelistPaymasterInstance
    let sr1: SampleRecipientInstance
    let sr2: SampleRecipientInstance

    let _relayHubAddress: string

    before(async function () {
      const host = (web3.currentProvider as HttpProvider).host
      const {
        contractsDeployment: {
          relayHubAddress,
          forwarderAddress
        }
      } = await GsnTestEnvironment.startGsn(host)
      _relayHubAddress = relayHubAddress!

      sr1 = await SampleRecipient.new()
      sr2 = await SampleRecipient.new()
      await sr1.setForwarder(forwarderAddress!)
      await sr2.setForwarder(forwarderAddress!)
      pm = await SingletonWhitelistPaymaster.new()
      await pm.setRelayHub(relayHubAddress!)
      await pm.setTrustedForwarder(forwarderAddress!)

      const gsnConfig: Partial<GSNConfig> = {
        loggerConfiguration: {
          logLevel: 'error'
        },
        paymasterAddress: pm.address,
        performDryRunViewRelayCall: false,
        maxPaymasterDataLength: 32
      }
      const input: GSNUnresolvedConstructorInput = {
        provider,
        config: gsnConfig,
        overrideDependencies: {
          asyncPaymasterData: async () => { return new AbiCoder().encode(['address'], [owner1])}
        }
      }
      const gsnProvider = RelayProvider.newProvider(input)
      await gsnProvider.init()
      // @ts-ignore
      SampleRecipient.web3.setProvider(gsnProvider)
    })

    describe('balance accounting', function () {
      it('should reject if dapp owner has insufficient deposit', async function () {
        const hub = await RelayHub.at(_relayHubAddress)

        // deposit to hub so the balance error is raised by the paymaster and not the relay hub
        await hub.depositFor(pm.address, { value: 1e18 })

        // adding configuration to pass the initial check
        await pm.whitelistSenders([from, from2], true, { from: owner1 })
        await pm.setConfiguration(true, false, false, { from: owner1 })
        // TODO: this is lazy. Build the call to 'preRelayedCall' manually to control the inputs!
        await expectRevert(sr1.something({ from }), 'insufficient balance for charge')
      })

      it.only('should attribute incoming ether to the sender', async function () {
        const res = await web3.eth.sendTransaction({ from: owner1, to: pm.address, value: 1e18 })
        const hub = await RelayHub.at(_relayHubAddress)
        const ifacePm = new Interface(pm.abi as any)
        const ifaceRh = new Interface(hub.abi as any)
        const deposited = ifaceRh.decodeEventLog('Deposited', res.logs[0].data, res.logs[0].topics)
        const received = ifacePm.decodeEventLog('Received', res.logs[1].data, res.logs[1].topics)
        assert.equal(deposited.amount.toString(), received.amount.toString())
        assert.equal(deposited.paymaster.toLowerCase(), pm.address.toLowerCase())
        assert.equal(received.sender.toLowerCase(), owner1.toLowerCase())
      })

      it.only('should allow dapp owner to withdraw from the remaining deposit', async function () {
        const dappDetails = await pm.relayingTargets(owner1)
        assert.equal(dappDetails.balance, 1e18.toString()) // depends on previous test
        const ownerBalanceBefore = await web3.eth.getBalance(owner1)
        const { receipt } = await pm.withdrawBalance(dappDetails.balance.toString(), { from: owner1 })
        const txCost = toBN(receipt.gasUsed * receipt.effectiveGasPrice)
        const ownerBalanceAfter = await web3.eth.getBalance(owner1)
        const expectedBalance = toBN(ownerBalanceBefore).add(dappDetails.balance).sub(txCost)
        assert.equal(ownerBalanceAfter, expectedBalance.toString())
      })

      it('should not allow dapp owner to withdraw more than available')
      it('should not allow dapp owner to withdraw during the relaying', async function () {
        // TODO ReentrancyGuard: reentrant call
      })
    })

    describe('configuration', function () {
      it('should allow paymaster owner to change shared configuration')

      it('should reject without dapp configuration', function () {

      })

      it('should reject setting dapp configuration with all kinds of whitelists turned off', function () {

      })
    }) // revert
    describe('with invalid paymasterData', function () {}) // revert

    describe('with whitelisted enabled', () => {
      before(async () => {
        await web3.eth.sendTransaction({ from: owner1, to: pm.address, value: 1e19 })
        await pm.whitelistSenders([from, from2], true, { from: owner1 })
        await pm.setConfiguration(true, false, false, { from: owner1 })
      })

      it('should allow whitelisted sender, charge the dapp owner for gas and a paymaster fee', async () => {
        await sr1.something({ from: from })
        // await sr1.something({ from: from2 })
        // TODO: check we make profit as dev fee
      })

      // it('should prevent non-whitelisted sender', async () => {
      //   await expectRevert(sr1.something({ from: another }), 'sender not whitelisted')
      // })

      it('should prevent using different dapp owner deposit if configurations differ', async function () {
        const gsnConfig: Partial<GSNConfig> = {
          loggerConfiguration: {
            logLevel: 'error'
          },
          paymasterAddress: pm.address,
          performDryRunViewRelayCall: false,
          maxPaymasterDataLength: 32
        }
        const input: GSNUnresolvedConstructorInput = {
          provider,
          config: gsnConfig,
          overrideDependencies: {
            asyncPaymasterData: async () => { return new AbiCoder().encode(['address'], [owner1])}
          }
        }
        const differentOwnerProvider = RelayProvider.newProvider(input)
        // @ts-ignore
        SampleRecipient.web3.setProvider(differentOwnerProvider)
        await expectRevert(sr1.something({ from: another }), 'sender not whitelisted')
      })
    })
  }
)
