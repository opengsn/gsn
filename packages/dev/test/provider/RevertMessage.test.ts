/**
 * run this test against different networks (ganache/geth/parity) to see that revert message can properly be processed:
 *   truffle test --network rinkeby test/relayclient/RevertMessage.test.ts
 * currently passes with "--network rinkeby", "--network ropsten" (geth node)
 * it FAILS with "--network kovan":
 * we still can't parse correctly parity response, since the provider doesn't pass the error response correctly.
 */

import { expectRevert } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import Web3 from 'web3'

import { RelayProvider } from '@opengsn/provider/dist/RelayProvider'
import {
  TestRecipientInstance
} from '@opengsn/contracts/types/truffle-contracts'
import { Address } from '@opengsn/common'
import { GsnTestEnvironment } from '@opengsn/cli/dist/GsnTestEnvironment'
import { GSNConfig } from '@opengsn/provider/dist/GSNConfigurator'

// @ts-ignore
const currentProviderHost = web3.currentProvider.host
const ethersProvider = new StaticJsonRpcProvider(currentProviderHost)
const underlyingProvider = web3.currentProvider as HttpProvider

describe.skip('RevertMessage.test', function () {
  let web3: Web3
  let forwarderAddress: Address
  let paymasterAddress: Address
  let relayProvider: RelayProvider

  before(async function () {
    this.timeout(30000)
    web3 = new Web3(underlyingProvider)

    // Addresses copied from latest release: https://github.com/opengsn/gsn/releases/tag/v2.0.1
    const networks: any = {
      3: {
        hub: '0x29e41C2b329fF4921d8AC654CEc909a0B575df20',
        forwarder: '0x25CEd1955423BA34332Ec1B60154967750a0297D',
        paymaster: '0x8057c0fb7089BB646f824fF4A4f5a18A8d978ecC'
      },
      4: {
        hub: '0x53C88539C65E0350408a2294C4A85eB3d8ce8789',
        forwarder: '0x956868751Cc565507B3B58E53a6f9f41B56bed74',
        paymaster: '0x43d66E6Dce20264F6511A0e8EEa3f570980341a2'
      },
      42: {
        hub: '0xE9dcD2CccEcD77a92BA48933cb626e04214Edb92',
        forwarder: '0x0842Ad6B8cb64364761C7c170D0002CC56b1c498',
        paymaster: '0x083082b7Eada37dbD8f263050570B31448E61c94'
      }
    }
    const chain = await web3.eth.net.getId()
    if (chain > 1000) {
      // @ts-ignore
      const { contractsDeployment } = await GsnTestEnvironment.startGsn(web3.currentProvider?.host ?? 'localhost')
      forwarderAddress = contractsDeployment.forwarderAddress!
      paymasterAddress = contractsDeployment.paymasterAddress!
    } else {
      paymasterAddress = networks[chain].paymaster
      forwarderAddress = networks[chain].forwarder
    }
  })

  after('after all', async function () {
    await GsnTestEnvironment.stopGsn()
  })

  describe('Use Provider to relay request', () => {
    let testRecipient: TestRecipientInstance
    let gasLess: Address

    before(async function () {
      this.timeout(30000)
      const TestRecipient = artifacts.require('TestRecipient')
      testRecipient = await TestRecipient.new(forwarderAddress)
      const gsnConfig: Partial<GSNConfig> = {
        loggerConfiguration: { logLevel: 'error' },
        paymasterAddress
      }

      relayProvider = await RelayProvider.newWeb3Provider({ provider: ethersProvider, config: gsnConfig })
      // @ts-ignore
      TestRecipient.web3.setProvider(relayProvider)

      gasLess = relayProvider.newAccount().address
    })

    it('should show relayCall revert messages', async function () {
      this.timeout(20000)

      // explicitly request impossible gas limit, to cause a revert in relayCall()
      // (alternately, we could deploy a new paymaster with no balance and wait for "Paymaster balance too low"

      await expectRevert(testRecipient.emitMessage('hello again', {
        from: gasLess,
        gas: 20e6.toString()
      }), 'Not enough gas left for innerRelayCall')
    })
  })
})
